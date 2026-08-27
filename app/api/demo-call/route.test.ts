import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// SAFETY: exactly like app/api/check/route.test.ts, this suite mocks
// lib/call-log-store and lib/calle completely -- no real network call, no
// real Edge Config access, no real CALL-E call is ever reachable here. The
// mockPlaceCall spy stands in for it.
// ---------------------------------------------------------------------------

const mockClaimCallSlot = vi.fn();
const mockIncrementDemoCallCount = vi.fn();
const mockPlaceCall = vi.fn();

vi.mock("@/lib/call-log-store", () => ({
  claimCallSlot: (...args: unknown[]) => mockClaimCallSlot(...args),
  incrementDemoCallCount: (...args: unknown[]) => mockIncrementDemoCallCount(...args),
}));

vi.mock("@/lib/calle", () => ({
  placeCall: (...args: unknown[]) => mockPlaceCall(...args),
}));

process.env.TARGET_PHONE = "REDACTED_DESTINATION";
const { POST } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  mockIncrementDemoCallCount.mockResolvedValue({ ok: true, capReached: false, count: 1 });
  mockClaimCallSlot.mockResolvedValue({ claimed: true });
  mockPlaceCall.mockResolvedValue({ id: "call_demo_1", status: "queued" });
});

describe("POST /api/demo-call - lifetime cap checked after the cheap rate-limit claim", () => {
  it("refuses with 429 once the lifetime cap is reached and never calls placeCall", async () => {
    mockIncrementDemoCallCount.mockResolvedValue({ ok: true, capReached: true, count: 5 });
    const res = await POST();
    expect(res.status).toBe(429);
    expect(mockClaimCallSlot).toHaveBeenCalledTimes(1);
    expect(mockPlaceCall).not.toHaveBeenCalled();
  });

  it("fails closed (503) if the lifetime-cap counter itself can't be read/written", async () => {
    mockIncrementDemoCallCount.mockResolvedValue({ ok: false, reason: "Edge Config unreachable" });
    const res = await POST();
    expect(res.status).toBe(503);
    expect(mockClaimCallSlot).toHaveBeenCalledTimes(1);
    expect(mockPlaceCall).not.toHaveBeenCalled();
  });
});

describe("POST /api/demo-call - rate limit", () => {
  it("places a real call to TARGET_PHONE when under both the cap and the rate limit", async () => {
    const res = await POST();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.placed).toBe(true);
    expect(json).not.toHaveProperty("call_id");
    expect(mockPlaceCall).toHaveBeenCalledTimes(1);
    expect(mockPlaceCall).toHaveBeenCalledWith(expect.objectContaining({ phone: "REDACTED_DESTINATION" }));
  });

  it("refuses with 429 when the rate-limit slot is already claimed for this window", async () => {
    mockClaimCallSlot.mockResolvedValue({ claimed: false, reason: "already claimed" });
    const res = await POST();
    expect(res.status).toBe(429);
    expect(mockPlaceCall).not.toHaveBeenCalled();
  });
});

describe("POST /api/demo-call - never dials a request-supplied number", () => {
  it("always passes the fixed TARGET_PHONE to placeCall, with no way for a caller to override it", async () => {
    await POST();
    const callArgs = mockPlaceCall.mock.calls[0][0];
    expect(callArgs.phone).toBe(process.env.TARGET_PHONE);
  });

  it("the route module source never reads a phone-shaped field from a request body", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.join(__dirname, "route.ts"), "utf-8");
    // This route takes no request body at all (POST() has no arguments) --
    // this is a static guard against a future edit accidentally adding one.
    expect(src).not.toMatch(/req\.json\(\)|request\.json\(\)/);
  });
});
