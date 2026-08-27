import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// SAFETY: this test suite mocks lib/call-log-store and lib/calle completely.
// No real network call, no real Edge Config access, and - critically - no
// real call to CALL-E's placeCall is ever reachable from these tests. The
// `mockPlaceCall` spy below stands in for it; asserting it was/wasn't called
// is how we prove the safety logic without ever placing a real phone call.
// ---------------------------------------------------------------------------

const mockReadLog = vi.fn();
const mockWriteLog = vi.fn();
const mockClaimCallSlot = vi.fn();
const mockPlaceCall = vi.fn();
const mockGetCall = vi.fn();

vi.mock("@/lib/call-log-store", () => ({
  readLog: (...args: unknown[]) => mockReadLog(...args),
  writeLog: (...args: unknown[]) => mockWriteLog(...args),
  claimCallSlot: (...args: unknown[]) => mockClaimCallSlot(...args),
  // Public projection deliberately exposes operational status only.
  redactLogForClient: (entries: Array<Record<string, unknown>>) =>
    entries.map((e) => ({
      item_id: e.item_id,
      item_name: e.item_name,
      status: e.status,
      task_completed: e.task_completed,
      created_at: e.created_at,
      updated_at: e.updated_at,
      trigger: e.trigger,
    })),
}));

vi.mock("@/lib/calle", () => ({
  placeCall: (...args: unknown[]) => mockPlaceCall(...args),
  getCall: (...args: unknown[]) => mockGetCall(...args),
  CALLE_TERMINAL_STATUSES: new Set(["completed", "failed"]),
}));

// Tracked items now live in Supabase (lib/tracked-items-store.ts) instead of
// the old static data/tracked_items.json fixture. Mocked here the same way
// the JSON import used to be -- a fixed fixture, since these tests exercise
// the call-safety logic in runCheck(), not the items data source itself
// (that has its own dedicated tests in lib/tracked-items-store.test.ts).
vi.mock("@/lib/tracked-items-store", () => ({
  loadTrackedItems: async () => ({
    ok: true,
    items: [
      {
        id: "actionable-item",
        name: "Actionable Test Item",
        category: "test",
        cooldown_hours: 1,
        last_action_at: "2020-01-01T00:00:00Z", // long past -> always actionable "now"
        source: "test",
        call_task: "say hi, this is a test",
      },
    ],
  }),
}));

// TARGET_PHONE is read once at module load (route.ts has no hardcoded
// fallback -- see the fail-closed guard added after the 2026-08-26 public
// PII exposure fix), so it must be set before the dynamic import below.
process.env.TARGET_PHONE = "REDACTED_DESTINATION";
const { runCheck } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

function fakeCallTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "call_test123",
    status: "queued",
    task_completed: null,
    summary: null,
    recipients: [{ attempts: [] }],
    ...overrides,
  };
}

describe("runCheck - Edge Config read failure fails CLOSED (no call placed)", () => {
  it("places NO call and claims NO slot when readLog reports ok:false", async () => {
    mockReadLog.mockResolvedValue({ ok: false, error: "Edge Config rate limited (429)" });

    const result = await runCheck("cron");

    expect(mockPlaceCall).not.toHaveBeenCalled();
    expect(mockClaimCallSlot).not.toHaveBeenCalled();
    expect(mockWriteLog).not.toHaveBeenCalled();
    expect(result.new_calls_placed).toEqual([]);
    expect(result.warning).toContain("Supabase read failed");
  });
});

describe("runCheck - happy path places exactly one call and writes exactly once", () => {
  it("claims the slot, places the call, and persists it", async () => {
    mockReadLog.mockResolvedValue({ ok: true, entries: [] });
    mockClaimCallSlot.mockResolvedValue({ claimed: true });
    mockPlaceCall.mockResolvedValue(fakeCallTask());
    mockWriteLog.mockResolvedValue(undefined);

    const result = await runCheck("manual");

    expect(mockClaimCallSlot).toHaveBeenCalledTimes(1);
    expect(mockClaimCallSlot).toHaveBeenCalledWith("actionable-item", "2020-01-01T00:00:00Z");
    expect(mockPlaceCall).toHaveBeenCalledTimes(1);
    expect(result.new_calls_placed).toEqual(["actionable-item"]);
    expect(mockWriteLog).toHaveBeenCalledTimes(1);
  });
});

describe("runCheck - lost the claim race (concurrent trigger) => no call placed", () => {
  it("does not call placeCall when claimCallSlot reports claimed:false", async () => {
    mockReadLog.mockResolvedValue({ ok: true, entries: [] });
    mockClaimCallSlot.mockResolvedValue({ claimed: false, reason: "already claimed by a concurrent trigger" });

    const result = await runCheck("cron");

    expect(mockPlaceCall).not.toHaveBeenCalled();
    expect(result.new_calls_placed).toEqual([]);
    expect(mockWriteLog).not.toHaveBeenCalled();
  });
});

describe("runCheck - already called this cycle => skips without even attempting a claim", () => {
  it("does not re-claim or re-call when a log entry already covers this cycle", async () => {
    mockReadLog.mockResolvedValue({
      ok: true,
      entries: [
        {
          log_id: "log-1",
          item_id: "actionable-item",
          item_name: "Actionable Test Item",
          call_id: "call_already",
          phone_e164: "REDACTED_DESTINATION",
          task: "x",
          status: "completed",
          task_completed: true,
          summary: "done",
          transcript_turns: [],
          created_at: "2026-08-25T00:00:00Z", // newer than last_action_at
          updated_at: "2026-08-25T00:00:00Z",
          trigger: "cron",
        },
      ],
    });

    const result = await runCheck("cron");

    expect(mockClaimCallSlot).not.toHaveBeenCalled();
    expect(mockPlaceCall).not.toHaveBeenCalled();
    expect(result.new_calls_placed).toEqual([]);
  });
});

describe("runCheck - write-only-on-transition for the in-flight-call poller", () => {
  it("does NOT write when polling shows the call is still in-progress", async () => {
    mockReadLog.mockResolvedValue({
      ok: true,
      entries: [
        {
          log_id: "log-1",
          item_id: "actionable-item",
          item_name: "Actionable Test Item",
          call_id: "call_inflight",
          phone_e164: "REDACTED_DESTINATION",
          task: "x",
          status: "queued", // non-terminal
          task_completed: null,
          summary: null,
          transcript_turns: [],
          created_at: "2026-08-25T00:00:00Z", // already-called-this-cycle guard active
          updated_at: "2026-08-25T00:00:00Z",
          trigger: "cron",
        },
      ],
    });
    mockGetCall.mockResolvedValue(fakeCallTask({ status: "in_progress" })); // still non-terminal

    const result = await runCheck("cron");

    expect(mockGetCall).toHaveBeenCalledTimes(1);
    expect(mockWriteLog).not.toHaveBeenCalled();
    expect(result.log[0].status).toBe("in_progress"); // in-memory refresh still happens
  });

  it("DOES write exactly once when polling shows the call just reached a terminal state", async () => {
    mockReadLog.mockResolvedValue({
      ok: true,
      entries: [
        {
          log_id: "log-1",
          item_id: "actionable-item",
          item_name: "Actionable Test Item",
          call_id: "call_finishing",
          phone_e164: "REDACTED_DESTINATION",
          task: "x",
          status: "queued", // non-terminal going in
          task_completed: null,
          summary: null,
          transcript_turns: [],
          created_at: "2026-08-25T00:00:00Z",
          updated_at: "2026-08-25T00:00:00Z",
          trigger: "cron",
        },
      ],
    });
    mockGetCall.mockResolvedValue(fakeCallTask({ status: "completed", task_completed: true, summary: "ok" }));
    mockWriteLog.mockResolvedValue(undefined);

    const result = await runCheck("cron");

    expect(mockWriteLog).toHaveBeenCalledTimes(1);
    expect(result.log[0].status).toBe("completed");
  });

  it("polling twice in a row (still in-progress both times) never writes", async () => {
    const entry = {
      log_id: "log-1",
      item_id: "actionable-item",
      item_name: "Actionable Test Item",
      call_id: "call_inflight",
      phone_e164: "REDACTED_DESTINATION",
      task: "x",
      status: "queued",
      task_completed: null,
      summary: null,
      transcript_turns: [],
      created_at: "2026-08-25T00:00:00Z",
      updated_at: "2026-08-25T00:00:00Z",
      trigger: "cron" as const,
    };
    mockGetCall.mockResolvedValue(fakeCallTask({ status: "in_progress" }));

    mockReadLog.mockResolvedValueOnce({ ok: true, entries: [{ ...entry }] });
    await runCheck("cron");
    expect(mockWriteLog).not.toHaveBeenCalled();

    mockReadLog.mockResolvedValueOnce({ ok: true, entries: [{ ...entry, status: "in_progress" }] });
    await runCheck("cron");
    expect(mockWriteLog).not.toHaveBeenCalled();
  });
});

describe("runCheck - per-item error isolation", () => {
  it("a CALL-E failure while refreshing one entry does not prevent placing a new call for an actionable item", async () => {
    mockReadLog.mockResolvedValue({
      ok: true,
      entries: [
        {
          log_id: "log-1",
          item_id: "some-other-item-not-in-fixture",
          item_name: "Stale",
          call_id: "call_broken",
          phone_e164: "REDACTED_DESTINATION",
          task: "x",
          status: "queued",
          task_completed: null,
          summary: null,
          transcript_turns: [],
          created_at: "2019-01-01T00:00:00Z",
          updated_at: "2019-01-01T00:00:00Z",
          trigger: "cron",
        },
      ],
    });
    mockGetCall.mockRejectedValue(new Error("CALL-E timed out"));
    mockClaimCallSlot.mockResolvedValue({ claimed: true });
    mockPlaceCall.mockResolvedValue(fakeCallTask());
    mockWriteLog.mockResolvedValue(undefined);

    const result = await runCheck("cron");

    expect(mockPlaceCall).toHaveBeenCalledTimes(1);
    expect(result.new_calls_placed).toEqual(["actionable-item"]);
  });
});
