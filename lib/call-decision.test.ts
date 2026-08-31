import { describe, expect, it } from "vitest";
import { buildCallDecision } from "./call-decision";
import type { ItemStatus } from "./cooldown";

const base: ItemStatus = {
  id: "x", name: "Listing", category: "marketplace", cooldown_hours: 24,
  last_action_at: "2026-08-01T00:00:00Z", source: "demo", call_task: "Repost listing",
  state: "actionable", ready_at: "2026-08-02T00:00:00Z", seconds_remaining: 0, percent_elapsed: 100,
};

describe("call decision mesh", () => {
  it("fails closed without an authorized destination", () => {
    expect(buildCallDecision(base, false).decision).toBe("BLOCK");
  });
  it("requires all three specialists before CALL", () => {
    const result = buildCallDecision(base, true);
    expect(result.decision).toBe("CALL");
    expect(result.agents.map((a) => a.agent)).toEqual(["watcher", "permission", "briefing"]);
  });
});
