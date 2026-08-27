import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeAllStatuses,
  validateTrackedItems,
  MIN_COOLDOWN_HOURS,
  type TrackedItem,
  type TrackedItemsFile,
} from "./cooldown";

function makeItem(overrides: Partial<TrackedItem> = {}): TrackedItem {
  return {
    id: "item-1",
    name: "Test item",
    category: "test",
    cooldown_hours: 24,
    last_action_at: "2020-01-01T00:00:00Z",
    source: "test",
    call_task: "say hi",
    ...overrides,
  };
}

describe("validateTrackedItems - cooldown safety floor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an item below the 1-hour floor (e.g. the old 5-minute demo trigger)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const items = [makeItem({ id: "demo-video-live-trigger", cooldown_hours: 0.0833 })];
    const valid = validateTrackedItems(items);
    expect(valid).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("demo-video-live-trigger");
    expect(errorSpy.mock.calls[0][0]).toContain("REJECTED");
  });

  it("rejects an item exactly at a fraction under the floor and keeps one exactly at the floor", () => {
    const items = [
      makeItem({ id: "just-under", cooldown_hours: MIN_COOLDOWN_HOURS - 0.001 }),
      makeItem({ id: "exactly-at-floor", cooldown_hours: MIN_COOLDOWN_HOURS }),
    ];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const valid = validateTrackedItems(items);
    expect(valid.map((i) => i.id)).toEqual(["exactly-at-floor"]);
  });

  it("rejects non-finite or negative cooldown_hours defensively", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const items = [
      makeItem({ id: "nan-item", cooldown_hours: NaN }),
      makeItem({ id: "negative-item", cooldown_hours: -5 }),
      makeItem({ id: "fine-item", cooldown_hours: 24 }),
    ];
    const valid = validateTrackedItems(items);
    expect(valid.map((i) => i.id)).toEqual(["fine-item"]);
  });

  it("keeps normal items untouched", () => {
    const items = [makeItem({ cooldown_hours: 24 }), makeItem({ id: "item-2", cooldown_hours: 1080 })];
    const valid = validateTrackedItems(items);
    expect(valid).toHaveLength(2);
  });
});

describe("computeAllStatuses - applies the safety floor before computing status", () => {
  it("excludes a sub-floor item from the returned statuses entirely, even if it would be 'actionable'", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const file: TrackedItemsFile = {
      _note: "test",
      items: [
        makeItem({
          id: "demo-video-live-trigger",
          cooldown_hours: 0.0833,
          last_action_at: "2020-01-01T00:00:00Z", // ancient -> would be actionable forever
        }),
        makeItem({ id: "normal-item", cooldown_hours: 24, last_action_at: "2020-01-01T00:00:00Z" }),
      ],
    };
    const statuses = computeAllStatuses(file, new Date("2026-08-25T00:00:00Z"));
    expect(statuses.map((s) => s.id)).toEqual(["normal-item"]);
    expect(statuses[0].state).toBe("actionable");
  });

  it("fails closed on a malformed persisted timestamp", () => {
    const file: TrackedItemsFile = {
      _note: "test",
      items: [makeItem({ last_action_at: "not-a-date" })],
    };
    expect(() => computeAllStatuses(file, new Date("2026-08-25T00:00:00Z"))).toThrow(
      'Invalid last_action_at for tracked item "item-1"'
    );
  });
});
