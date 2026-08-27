import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// SAFETY: @supabase/supabase-js is fully mocked below, following the exact
// pattern established in lib/tracked-items-store.test.ts. No real network
// call and no real Supabase project is ever reachable from these tests.
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

/**
 * A minimal chainable mock of the subset of the supabase-js query builder
 * this module uses: .from().select().order().limit() (readLog),
 * .from().select().eq().maybeSingle() (claimCallSlot/incrementDemoCallCount
 * reads), .from().upsert() (writeLog / all writes). `result` is whatever
 * the *last* awaited call in a chain should resolve to.
 */
function createMockSupabaseClient(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const calls: { upsert?: unknown; eqCol?: string; eqVal?: unknown } = {};
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve(result)),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqCol = col;
      calls.eqVal = val;
      return builder;
    }),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    upsert: vi.fn((row: unknown) => {
      calls.upsert = row;
      return Promise.resolve(result);
    }),
  };
  const from = vi.fn(() => builder);
  return { client: { from }, calls, from };
}

beforeEach(() => {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.doUnmock("@supabase/supabase-js");
});

describe("readLog - tri-state result (the core of the fail-closed fix)", () => {
  it("returns ok:true with entries on a normal successful read", async () => {
    const entries = [{ log_id: "1", item_id: "x" }];
    const { client } = createMockSupabaseClient({ data: entries, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { readLog } = await import("./call-log-store");
    const result = await readLog();
    expect(result).toEqual({ ok: true, entries });
  });

  it("returns ok:true entries:[] when the table is genuinely empty", async () => {
    const { client } = createMockSupabaseClient({ data: [], error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { readLog } = await import("./call-log-store");
    const result = await readLog();
    expect(result).toEqual({ ok: true, entries: [] });
  });

  it("fails closed (ok:false) on a Supabase error, never silently returning an empty array", async () => {
    const { client } = createMockSupabaseClient({ data: null, error: { message: "connection refused" } });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { readLog } = await import("./call-log-store");
    const result = await readLog();
    expect(result.ok).toBe(false);
  });

  it("fails closed when Supabase isn't configured at all", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    const { readLog } = await import("./call-log-store");
    const result = await readLog();
    expect(result.ok).toBe(false);
  });
});

describe("writeLog", () => {
  it("upserts the pruned entries array by log_id", async () => {
    const { client, calls } = createMockSupabaseClient({ data: null, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { writeLog } = await import("./call-log-store");
    const entries = [{ log_id: "1" }, { log_id: "2" }] as never;
    await writeLog(entries);
    expect(calls.upsert).toEqual(entries);
  });

  it("throws if the write fails, so callers know a real state transition was NOT persisted", async () => {
    const { client } = createMockSupabaseClient({ data: null, error: { message: "boom" } });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { writeLog } = await import("./call-log-store");
    await expect(writeLog([{ log_id: "1" }] as never)).rejects.toThrow();
  });

  it("no-ops on an empty array rather than issuing a pointless write", async () => {
    const { client, from } = createMockSupabaseClient({ data: null, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { writeLog } = await import("./call-log-store");
    await writeLog([]);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("claimCallSlot - best-effort race guard", () => {
  it("claims successfully when no existing lock row is present", async () => {
    const { client } = createMockSupabaseClient({ data: null, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { claimCallSlot } = await import("./call-log-store");
    const result = await claimCallSlot("item-1", "2026-01-01T00:00:00Z");
    expect(result.claimed).toBe(true);
  });

  it("refuses to claim when a fresh lock for the same cycle already exists", async () => {
    const existing = { cycleKey: "2026-01-01T00:00:00Z", claimedAt: new Date().toISOString() };
    const { client } = createMockSupabaseClient({ data: { value: existing }, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { claimCallSlot } = await import("./call-log-store");
    const result = await claimCallSlot("item-1", "2026-01-01T00:00:00Z");
    expect(result.claimed).toBe(false);
  });

  it("claims again once the existing lock for that cycle has aged past its TTL", async () => {
    const existing = { cycleKey: "2026-01-01T00:00:00Z", claimedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() };
    const { client } = createMockSupabaseClient({ data: { value: existing }, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { claimCallSlot } = await import("./call-log-store");
    const result = await claimCallSlot("item-1", "2026-01-01T00:00:00Z", 5 * 60 * 1000);
    expect(result.claimed).toBe(true);
  });

  it("claims again for a genuinely new cycle even if an old lock row exists", async () => {
    const existing = { cycleKey: "OLD_CYCLE", claimedAt: new Date().toISOString() };
    const { client } = createMockSupabaseClient({ data: { value: existing }, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { claimCallSlot } = await import("./call-log-store");
    const result = await claimCallSlot("item-1", "NEW_CYCLE");
    expect(result.claimed).toBe(true);
  });

  it("fails closed (does not claim) when the lock read errors", async () => {
    const { client } = createMockSupabaseClient({ data: null, error: { message: "boom" } });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { claimCallSlot } = await import("./call-log-store");
    const result = await claimCallSlot("item-1", "2026-01-01T00:00:00Z");
    expect(result.claimed).toBe(false);
  });

  it("fails closed when Supabase isn't configured at all", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    const { claimCallSlot } = await import("./call-log-store");
    const result = await claimCallSlot("item-1", "2026-01-01T00:00:00Z");
    expect(result.claimed).toBe(false);
  });
});

describe("incrementDemoCallCount - hard lifetime cap on the public demo-call button", () => {
  it("increments from zero and reports capReached:false while under the cap", async () => {
    const { client } = createMockSupabaseClient({ data: null, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { incrementDemoCallCount } = await import("./call-log-store");
    const result = await incrementDemoCallCount(5);
    expect(result).toEqual({ ok: true, capReached: false, count: 1 });
  });

  it("refuses (capReached:true) once the count has reached the cap, without writing again", async () => {
    const { client, from } = createMockSupabaseClient({ data: { value: 5 }, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { incrementDemoCallCount } = await import("./call-log-store");
    const result = await incrementDemoCallCount(5);
    expect(result).toEqual({ ok: true, capReached: true, count: 5 });
    expect(from).toHaveBeenCalledTimes(1); // read only, no write once capped
  });

  it("fails closed when the count read errors, rather than allowing an unbounded demo call", async () => {
    const { client } = createMockSupabaseClient({ data: null, error: { message: "boom" } });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { incrementDemoCallCount } = await import("./call-log-store");
    const result = await incrementDemoCallCount(5);
    expect(result.ok).toBe(false);
  });
});

describe("redactLogForClient - privacy-by-construction public projection", () => {
  it("allowlists operational status and omits every sensitive provider field", async () => {
    const { redactLogForClient } = await import("./call-log-store");
    const real = [
      {
        log_id: "1",
        item_id: "x",
        item_name: "Test item",
        call_id: "call_abc",
        phone_e164: "REDACTED_DESTINATION",
        task: "say hi",
        status: "completed",
        task_completed: true,
        summary: "done",
        transcript_turns: [],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        trigger: "manual" as const,
      },
    ];
    const redacted = redactLogForClient(real);
    expect(redacted).toHaveLength(1);
    expect(redacted[0]).toEqual({
      item_id: "x",
      item_name: "Test item",
      status: "completed",
      task_completed: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      trigger: "manual",
    });
    expect(redacted[0]).not.toHaveProperty("call_id");
    expect(redacted[0]).not.toHaveProperty("phone_e164");
    expect(redacted[0]).not.toHaveProperty("task");
    expect(redacted[0]).not.toHaveProperty("summary");
    expect(redacted[0]).not.toHaveProperty("transcript_turns");
  });

  it("does not mutate the original entries array (writeLog still needs the real value)", async () => {
    const { redactLogForClient } = await import("./call-log-store");
    const real = [{
      log_id: "1", item_id: "x", item_name: "x", call_id: "internal", phone_e164: "PRIVATE",
      task: "private", status: "queued", task_completed: null, summary: null,
      transcript_turns: [] as Array<{ offset_seconds: number; speaker: string; text: string }>,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", trigger: "cron" as const,
    }];
    redactLogForClient(real);
    expect(real[0].phone_e164).toBe("PRIVATE");
  });

  it("handles an empty log without error", async () => {
    const { redactLogForClient } = await import("./call-log-store");
    expect(redactLogForClient([])).toEqual([]);
  });
});
