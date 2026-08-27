export interface TrackedItem {
  id: string;
  name: string;
  category: string;
  cooldown_hours: number;
  last_action_at: string; // ISO 8601
  source: string;
  call_task: string;
}

export interface TrackedItemsFile {
  _note: string;
  items: TrackedItem[];
}

export type CooldownState = "cooling_down" | "actionable";

/**
 * Hard safety floor: no tracked item may have a cooldown shorter than one
 * hour. This exists specifically to prevent a repeat of the
 * `demo-video-live-trigger` incident, where a 5-minute demo cooldown was
 * left in production data with nothing ever advancing its `last_action_at`,
 * so it stayed permanently actionable and could re-trigger a real call on
 * every cron tick indefinitely. Any item violating this floor is rejected
 * at load time, loudly, rather than silently allowed through.
 */
export const MIN_COOLDOWN_HOURS = 1;

/**
 * Filters a tracked-items file down to only the items that pass the
 * cooldown safety floor. Rejected items are logged clearly and excluded
 * from all downstream evaluation and calling logic - they are never
 * "actionable" because they are never evaluated at all.
 */
export function validateTrackedItems(items: TrackedItem[]): TrackedItem[] {
  const valid: TrackedItem[] = [];
  for (const item of items) {
    if (!Number.isFinite(item.cooldown_hours) || item.cooldown_hours < MIN_COOLDOWN_HOURS) {
      console.error(
        `[cooldown-caller] REJECTED tracked item "${item.id}" (cooldown_hours=${item.cooldown_hours}): ` +
          `below the ${MIN_COOLDOWN_HOURS}-hour safety floor. This item will NOT be evaluated or called. ` +
          `Fix data/tracked_items.json.`
      );
      continue;
    }
    valid.push(item);
  }
  return valid;
}

export interface ItemStatus extends TrackedItem {
  state: CooldownState;
  ready_at: string; // ISO 8601 - when the cooldown clears
  seconds_remaining: number; // 0 when actionable
  percent_elapsed: number; // 0-100
}

/**
 * Pure date-math cooldown computation. Reuses the exact model proven in
 * the sibling project "Publish Window Keeper": an item becomes
 * `actionable` once `last_action_at + cooldown_hours` is in the past,
 * and stays `actionable` until a new action resets `last_action_at`.
 */
export function computeItemStatus(item: TrackedItem, now: Date = new Date()): ItemStatus {
  const lastActionMs = new Date(item.last_action_at).getTime();
  if (!Number.isFinite(lastActionMs)) {
    throw new Error(`Invalid last_action_at for tracked item "${item.id}"`);
  }
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Invalid current time supplied to cooldown computation");
  }
  const cooldownMs = item.cooldown_hours * 60 * 60 * 1000;
  const readyAtMs = lastActionMs + cooldownMs;
  const remainingMs = readyAtMs - now.getTime();
  const state: CooldownState = remainingMs <= 0 ? "actionable" : "cooling_down";
  const percentElapsed = Math.min(
    100,
    Math.max(0, ((now.getTime() - lastActionMs) / cooldownMs) * 100)
  );

  return {
    ...item,
    state,
    ready_at: new Date(readyAtMs).toISOString(),
    seconds_remaining: Math.max(0, Math.round(remainingMs / 1000)),
    percent_elapsed: percentElapsed,
  };
}

export function computeAllStatuses(file: TrackedItemsFile, now: Date = new Date()): ItemStatus[] {
  const validItems = validateTrackedItems(file.items);
  return validItems.map((item) => computeItemStatus(item, now));
}
