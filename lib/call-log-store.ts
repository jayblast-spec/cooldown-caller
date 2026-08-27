/**
 * Call log / lock persistence -- Supabase-backed.
 *
 * Originally lived in Vercel Edge Config (a small Vercel-native KV store),
 * chosen because Vercel serverless functions have no writable, shared
 * filesystem between invocations. Migrated to Supabase 2026-08-26 after
 * Edge Config's free-tier write quota (250 writes/30 days, shared across
 * the whole Vercel team, not per-key) was fully exhausted in production --
 * confirmed via a real 429 ("api-global-config-update-free") on the very
 * first attempt to use the new demo-call feature, which meant the CORE
 * call-logging path (writeLog/claimCallSlot, used by every real cooldown
 * call, cron or manual) was also blocked, not just the new feature. A
 * one-key-at-a-time KV store on a 250-writes/month free tier was never
 * going to survive real production traffic plus a public demo button.
 *
 * Reuses the same "daily-resilience-system" Supabase project already used
 * for cooldown_caller_tracked_items (see lib/tracked-items-store.ts) --
 * two new tables, cooldown_caller_call_log and cooldown_caller_locks (see
 * the migration applied 2026-08-26), both public-read/write via RLS on the
 * anon key, matching this app's existing no-auth demo posture. Every
 * exported function signature is unchanged from the Edge Config version so
 * no caller (app/api/check/route.ts, app/api/status/route.ts,
 * app/api/demo-call/route.ts) needed to change.
 */

import { createClient } from "@supabase/supabase-js";

export interface CallLogEntry {
  log_id: string; // stable id for this log row (uuid)
  item_id: string;
  item_name: string;
  call_id: string; // CALL-E call_task id
  phone_e164: string;
  task: string;
  status: string;
  task_completed: boolean | null;
  summary: string | null;
  transcript_turns: Array<{ offset_seconds: number; speaker: string; text: string }>;
  created_at: string; // when the call was placed
  updated_at: string; // last time we polled CALL-E for this call
  trigger: "cron" | "manual";
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const LOG_TABLE = "cooldown_caller_call_log";
const LOCKS_TABLE = "cooldown_caller_locks";
const LOCK_KEY_PREFIX = "call_lock__";
const DEMO_CALL_COUNT_KEY = "demo_call_lifetime_count";

/** Cap on how many most-recent call-log entries are persisted / returned. */
export const MAX_LOG_ENTRIES = 50;

function getClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}

/**
 * Tri-state read result. This distinction is safety-critical: the caller
 * (app/api/check/route.ts) MUST treat `ok: false` (the read could not be
 * evaluated at all - network error or Supabase not configured) completely
 * differently from `ok: true, entries: []` (we successfully talked to the
 * database and it genuinely has no log yet). Collapsing these two cases
 * into a single "empty array" return value was the root cause of an
 * earlier unintended real phone call: when the read failed, the
 * duplicate-call guard saw an empty list and proceeded as if no prior call
 * existed. Fail closed instead - a failed read must never be silently
 * treated as "safe to call." This invariant carries over unchanged from
 * the Edge Config implementation.
 */
export type LogReadResult = { ok: true; entries: CallLogEntry[] } | { ok: false; error: string };

export async function readLog(): Promise<LogReadResult> {
  const client = getClient();
  if (!client) {
    return { ok: false, error: "Supabase not configured (missing SUPABASE_URL/SUPABASE_ANON_KEY)" };
  }
  try {
    const { data, error } = await client
      .from(LOG_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(MAX_LOG_ENTRIES);
    if (error) {
      return { ok: false, error: `Supabase read failed: ${error.message}` };
    }
    return { ok: true, entries: (data ?? []) as CallLogEntry[] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Minimal public projection. Provider IDs, destination data, prompts,
 * summaries, and transcripts remain server-side and are never serialized
 * by a public route. An allowlist is safer than attempting to redact every
 * sensitive field that CALL-E may add in the future. */
export interface PublicCallLogEntry {
  item_id: string;
  item_name: string;
  status: string;
  task_completed: boolean | null;
  created_at: string;
  updated_at: string;
  trigger: "cron" | "manual";
}

export function redactLogForClient(entries: CallLogEntry[]): PublicCallLogEntry[] {
  return entries.map(({ item_id, item_name, status, task_completed, created_at, updated_at, trigger }) => ({
    item_id,
    item_name,
    status,
    task_completed,
    created_at,
    updated_at,
    trigger,
  }));
}

/**
 * Persists the call log. Callers pass the full in-memory entries array
 * (some entries newly added via `unshift`, others mutated in place after
 * polling CALL-E for status) -- upserting every row by its primary key
 * (log_id) correctly handles both cases without needing separate
 * insert/update call sites. Pruned to the MAX_LOG_ENTRIES most recent
 * entries, same as the Edge Config version.
 */
export async function writeLog(entries: CallLogEntry[]): Promise<void> {
  const client = getClient();
  if (!client) return;
  const pruned = entries.slice(0, MAX_LOG_ENTRIES);
  if (pruned.length === 0) return;
  const { error } = await client.from(LOG_TABLE).upsert(pruned, { onConflict: "log_id" });
  if (error) {
    throw new Error(`Supabase write failed: ${error.message}`);
  }
}

export interface ClaimResult {
  claimed: boolean;
  reason?: string;
}

/**
 * Best-effort claim ("lock") that a given tracked item's call for a given
 * cooldown cycle is being handled by this invocation, to close the race
 * window between two triggers (cron + a manual "Run check now" click, or
 * two overlapping cron ticks) that could otherwise both pass the
 * duplicate-call guard and both place a real call.
 *
 * LIMITATION: this reads then conditionally writes rather than using a
 * single atomic SQL statement, so it is NOT a true compare-and-set lock --
 * carried over unchanged from the Edge Config version, which had the same
 * limitation for the same reason (no CAS primitive was used there either).
 * It still meaningfully narrows the race (from "any two triggers within a
 * whole cooldown cycle" down to "two triggers within the same
 * few-hundred-millisecond read-then-write window"), and combined with
 * CALL-E's own Idempotency-Key header on placeCall, a duplicate real call
 * requires both races to be lost simultaneously.
 */
export async function claimCallSlot(itemId: string, cycleKey: string, ttlMs = 5 * 60 * 1000): Promise<ClaimResult> {
  const client = getClient();
  if (!client) {
    return { claimed: false, reason: "Supabase not configured, cannot safely claim a call slot" };
  }
  const key = `${LOCK_KEY_PREFIX}${itemId}`;
  try {
    const { data: existingRow, error: readError } = await client
      .from(LOCKS_TABLE)
      .select("value")
      .eq("lock_key", key)
      .maybeSingle();
    if (readError) {
      return { claimed: false, reason: `lock read failed: ${readError.message}` };
    }
    if (existingRow) {
      const existing = existingRow.value as { cycleKey: string; claimedAt: string } | null;
      if (existing && existing.cycleKey === cycleKey) {
        const ageMs = Date.now() - new Date(existing.claimedAt).getTime();
        if (ageMs < ttlMs) {
          return { claimed: false, reason: `call slot already claimed for this cycle ${ageMs}ms ago` };
        }
      }
    }

    const { error: writeError } = await client
      .from(LOCKS_TABLE)
      .upsert(
        { lock_key: key, value: { cycleKey, claimedAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "lock_key" }
      );
    if (writeError) {
      return { claimed: false, reason: `lock write failed: ${writeError.message}` };
    }
    return { claimed: true };
  } catch (err) {
    return { claimed: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Increments and returns the lifetime count of public "ring the demo line"
 * calls placed, refusing once `cap` is reached. Fails closed like every
 * other write in this module -- if the count can't be read or written
 * reliably, the caller must treat that as "cannot safely place a demo
 * call" rather than silently allowing an unbounded number of them against
 * the same shared CALL-E account budget the real product uses.
 */
export async function incrementDemoCallCount(
  cap: number
): Promise<{ ok: true; capReached: boolean; count: number } | { ok: false; reason: string }> {
  const client = getClient();
  if (!client) {
    return { ok: false, reason: "Supabase not configured, cannot safely track the demo-call budget" };
  }
  try {
    const { data: existingRow, error: readError } = await client
      .from(LOCKS_TABLE)
      .select("value")
      .eq("lock_key", DEMO_CALL_COUNT_KEY)
      .maybeSingle();
    if (readError) {
      return { ok: false, reason: `demo-call count read failed: ${readError.message}` };
    }
    const current = existingRow ? Number(existingRow.value) || 0 : 0;

    if (current >= cap) {
      return { ok: true, capReached: true, count: current };
    }

    const next = current + 1;
    const { error: writeError } = await client
      .from(LOCKS_TABLE)
      .upsert(
        { lock_key: DEMO_CALL_COUNT_KEY, value: next, updated_at: new Date().toISOString() },
        { onConflict: "lock_key" }
      );
    if (writeError) {
      return { ok: false, reason: `demo-call count write failed: ${writeError.message}` };
    }
    return { ok: true, capReached: false, count: next };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
