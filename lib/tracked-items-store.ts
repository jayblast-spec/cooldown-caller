/**
 * Tracked-items persistence -- Supabase-backed.
 *
 * Replaces the old static `data/tracked_items.json` demo fixture with real
 * database-backed rows so tracked items can genuinely be added/updated
 * through the UI. The `tracked_items` table has NO phone/destination
 * column of any kind (see the migration in docs/supabase/ and the table
 * comment applied alongside it) -- the call destination is a single fixed
 * constant (`TARGET_PHONE` in app/api/check/route.ts), read from an env
 * var, never from this table, never from a request body. Nothing in this
 * file accepts, stores, or forwards a phone number.
 *
 * The cooldown-floor safety invariant (MIN_COOLDOWN_HOURS, see
 * lib/cooldown.ts) is enforced in three independent layers, defense in
 * depth:
 *   1. Here, in `createTrackedItem`, before any insert is attempted.
 *   2. At the database layer, via a CHECK constraint on the column.
 *   3. Downstream, in `validateTrackedItems` (lib/cooldown.ts), which
 *      still re-validates every row this module returns before it is ever
 *      evaluated for a call -- so even a row that somehow bypassed 1 and 2
 *      (e.g. inserted directly in the Supabase dashboard) is still caught.
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { MIN_COOLDOWN_HOURS, type TrackedItem } from "@/lib/cooldown";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// This table lives in the shared "daily-resilience-system" Supabase project
// (also used by sibling projects Publish Window Keeper and Grant Scout),
// which already has its own generic "tracked_items" table. Named distinctly
// here to avoid any collision with that or with Grant Scout's
// "grant_scout_searches" table.
const TABLE = "cooldown_caller_tracked_items";

function getClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}

/**
 * Builds this project's call script for a tracked item. ALWAYS generated
 * server-side from a fixed template plus the item's own name/category
 * text. There is no free-text "call_task" field anywhere in the CRUD
 * surface (unlike the old JSON demo data, which hand-authored one per
 * item) -- every user-added item gets this same safe, consistent script.
 * This function's signature has no phone parameter and cannot influence
 * which number gets dialed.
 */
export function buildCallTask(item: Pick<TrackedItem, "name" | "category">): string {
  return (
    `Deliver a short reminder call. Say: Hi, this is Cooldown Caller. Your ${item.category} item ` +
    `"${item.name}" has cleared its cooldown and is ready for action. This is an automated reminder, ` +
    `no action needed on this call. Goodbye. Then end the call politely. Do not ask questions.`
  );
}

interface TrackedItemRow {
  id: string;
  name: string;
  category: string;
  cooldown_hours: number;
  last_action_at: string;
  source: string;
}

function rowToItem(row: TrackedItemRow): TrackedItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    cooldown_hours: row.cooldown_hours,
    last_action_at: row.last_action_at,
    source: row.source,
    call_task: buildCallTask(row),
  };
}

export type ItemsReadResult = { ok: true; items: TrackedItem[] } | { ok: false; error: string };

/**
 * Reads all tracked items. Mirrors the tri-state safety pattern used by
 * lib/call-log-store.ts's readLog(): callers get an explicit `ok: false`
 * on any failure rather than a silently-empty list, though note the
 * consequence here is the inverse of the call-log case and inherently
 * fail-safe rather than fail-closed -- an empty/failed items read simply
 * means zero items get evaluated this cycle, which can never itself cause
 * a call to be placed.
 */
export async function loadTrackedItems(): Promise<ItemsReadResult> {
  const client = getClient();
  if (!client) {
    return { ok: false, error: "Supabase not configured (missing SUPABASE_URL/SUPABASE_ANON_KEY)" };
  }
  const { data, error } = await client
    .from(TABLE)
    .select("id, name, category, cooldown_hours, last_action_at, source")
    .order("created_at", { ascending: true });
  if (error) {
    return { ok: false, error: `Supabase read failed: ${error.message}` };
  }
  return { ok: true, items: ((data ?? []) as TrackedItemRow[]).map(rowToItem) };
}

export interface NewTrackedItemInput {
  name: string;
  category: string;
  cooldown_hours: number;
  /** ISO 8601. Defaults to "now" if omitted. */
  last_action_at?: string;
}

export type CreateItemResult = { ok: true; item: TrackedItem } | { ok: false; error: string; status: number };

/**
 * Creates a new tracked item.
 *
 * SAFETY: `NewTrackedItemInput` has no phone/destination field, and the
 * row inserted below is built property-by-property from named, typed
 * locals -- never spread from the caller's input object. That means no
 * caller, however malicious the request body, can smuggle a phone number
 * (or any other column) into this table through this function; extra
 * fields on the input are simply never read. See
 * lib/tracked-items-store.test.ts for a test that proves this directly by
 * asserting on the exact shape of the row passed to the database client.
 */
export async function createTrackedItem(input: NewTrackedItemInput): Promise<CreateItemResult> {
  const client = getClient();
  if (!client) return { ok: false, error: "Supabase not configured", status: 503 };

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const category = typeof input.category === "string" ? input.category.trim() : "";
  const cooldownHours = Number(input.cooldown_hours);
  const lastActionAt = input.last_action_at ? new Date(input.last_action_at) : new Date();

  if (!name) return { ok: false, error: "name is required", status: 400 };
  if (!category) return { ok: false, error: "category is required", status: 400 };
  if (!Number.isFinite(cooldownHours) || cooldownHours < MIN_COOLDOWN_HOURS) {
    return {
      ok: false,
      error: `cooldown_hours must be a finite number >= ${MIN_COOLDOWN_HOURS} (the safety floor)`,
      status: 400,
    };
  }
  if (Number.isNaN(lastActionAt.getTime())) {
    return { ok: false, error: "last_action_at must be a valid date", status: 400 };
  }

  const row: TrackedItemRow & { source: string } = {
    id: randomUUID(),
    name,
    category,
    cooldown_hours: cooldownHours,
    last_action_at: lastActionAt.toISOString(),
    source: "user-added",
  };

  const { data, error } = await client.from(TABLE).insert(row).select().single();
  if (error) return { ok: false, error: `Supabase insert failed: ${error.message}`, status: 500 };
  return { ok: true, item: rowToItem(data as TrackedItemRow) };
}

export type MarkDoneResult = { ok: true; item: TrackedItem } | { ok: false; error: string; status: number };

/**
 * Marks a tracked item as "just done" by setting `last_action_at` to now.
 * This is the ONLY field this function ever writes. It takes just an id
 * string -- there is no way to pass a phone number, or anything else,
 * through this call path.
 */
export async function markItemDone(id: string): Promise<MarkDoneResult> {
  const client = getClient();
  if (!client) return { ok: false, error: "Supabase not configured", status: 503 };
  if (typeof id !== "string" || !id.trim()) return { ok: false, error: "id is required", status: 400 };

  const { data, error } = await client
    .from(TABLE)
    .update({ last_action_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, error: `Supabase update failed: ${error.message}`, status: 500 };
  if (!data) return { ok: false, error: "item not found", status: 404 };
  return { ok: true, item: rowToItem(data as TrackedItemRow) };
}
