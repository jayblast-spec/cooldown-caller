import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { computeAllStatuses, type TrackedItemsFile } from "@/lib/cooldown";
import { placeCall, getCall, CALLE_TERMINAL_STATUSES } from "@/lib/calle";
import { readLog, writeLog, claimCallSlot, redactLogForClient, type CallLogEntry } from "@/lib/call-log-store";
import { loadTrackedItems } from "@/lib/tracked-items-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// No hardcoded fallback: a real destination number must never live in
// source. If TARGET_PHONE is unset, fail loudly at request time rather than
// silently dialing a baked-in default.
const TARGET_PHONE = process.env.TARGET_PHONE;
const APP_ORIGIN = process.env.APP_ORIGIN ?? "https://cooldown-caller.vercel.app";

function bearerToken(req: NextRequest): string {
  const value = req.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return bearerToken(req) === secret;
  // Compatibility path for existing Vercel Cron deployments. Configure
  // CRON_SECRET to replace this provider-header check with real auth.
  return req.headers.get("x-vercel-cron") !== null;
}

function manualAuthorized(req?: NextRequest): boolean {
  // Optional request keeps direct unit calls to POST() backward compatible.
  if (!req) return process.env.NODE_ENV === "test";
  const secret = process.env.MANUAL_TRIGGER_TOKEN;
  if (secret && req.headers.get("x-manual-trigger-token") === secret) return true;
  return req.headers.get("origin") === APP_ORIGIN;
}

export async function runCheck(trigger: "cron" | "manual") {
  const now = new Date();

  if (!TARGET_PHONE) {
    console.error("[cooldown-caller] TARGET_PHONE is not configured - skipping all call evaluation this cycle.");
    return {
      checked_at: now.toISOString(),
      trigger,
      statuses: [],
      new_calls_placed: [],
      log: [],
      warning: "TARGET_PHONE is not configured; all items skipped this cycle (fail-closed).",
    };
  }

  // Tracked items now live in Supabase instead of the old static
  // data/tracked_items.json fixture (see lib/tracked-items-store.ts). A
  // failed items read is inherently fail-safe rather than fail-closed: an
  // empty items list simply means nothing gets evaluated this cycle, which
  // can never itself cause a call to be placed. It is still logged loudly
  // because it means the dashboard will show stale/empty data.
  const itemsResult = await loadTrackedItems();
  if (!itemsResult.ok) {
    console.error(
      `[cooldown-caller] Supabase tracked-items read FAILED - treating as zero items this cycle: ${itemsResult.error}`
    );
  }
  const file: TrackedItemsFile = {
    _note: "Supabase-backed tracked_items table (see lib/tracked-items-store.ts).",
    items: itemsResult.ok ? itemsResult.items : [],
  };
  const statuses = computeAllStatuses(file, now);

  // SAFETY: the duplicate-call guard below depends entirely on being able to
  // read the existing call log. If that read fails or can't be trusted, we
  // MUST NOT proceed as if "no prior call" were a confirmed fact - that is
  // exactly the failure mode that caused an earlier unintended real call.
  // Fail closed: skip every item's evaluation this cycle and log loudly.
  const logResult = await readLog();
  if (!logResult.ok) {
    console.error(
      `[cooldown-caller] Supabase read FAILED - skipping ALL call evaluation this cycle to avoid an ` +
        `unguarded duplicate call. error: ${logResult.error}`
    );
    return {
      checked_at: now.toISOString(),
      trigger,
      statuses,
      new_calls_placed: [],
      log: [],
      warning: `Supabase read failed; all items skipped this cycle (fail-closed): ${logResult.error}`,
    };
  }

  const entries = logResult.entries;
  let mutated = false;
  const newlyPlaced: string[] = [];

  // 1. Refresh any non-terminal calls already in the log. Only a transition
  //    into a terminal status counts as a state change worth persisting -
  //    a poll that merely re-confirms "still in progress" must NOT write to
  //    Supabase. This is what was exhausting the previous Edge Config
  //    store's write quota (250 writes/30 days) before the migration:
  //    every poller tick was writing regardless of whether
  //    anything meaningfully changed.
  for (const entry of entries) {
    const wasTerminal = CALLE_TERMINAL_STATUSES.has(entry.status);
    if (wasTerminal) continue;
    try {
      const call = await getCall(entry.call_id);
      entry.status = call.status;
      entry.task_completed = call.task_completed;
      entry.summary = call.summary;
      entry.transcript_turns =
        call.recipients[0]?.attempts.flatMap((a) => a.transcript_turns) ?? entry.transcript_turns;
      entry.updated_at = now.toISOString();
      const becameTerminal = CALLE_TERMINAL_STATUSES.has(call.status);
      if (becameTerminal) {
        mutated = true;
      }
    } catch (err) {
      // Per-item isolation: one CALL-E failure must not abort evaluation of
      // the remaining log entries or tracked items.
      console.error(`[cooldown-caller] Failed to refresh call ${entry.call_id}`, err);
    }
  }

  // 2. Place a new real call for any item that just became actionable and
  //    has not already had a call placed for this cooldown cycle. Each
  //    item is evaluated in isolation so one item's failure (CALL-E error,
  //    lock contention, etc.) never skips evaluation of the rest.
  for (const status of statuses) {
    try {
      if (status.state !== "actionable") continue;

      const alreadyCalledThisCycle = entries.some(
        (e) => e.item_id === status.id && new Date(e.created_at) >= new Date(status.last_action_at)
      );
      if (alreadyCalledThisCycle) continue;

      // Close the cron/manual-trigger race window: claim this item's slot
      // for this cooldown cycle before placing the call. If a concurrent
      // trigger already claimed it, skip - do not dial. See
      // lib/call-log-store.ts claimCallSlot() for the documented limitation
      // (read-then-write, not a true atomic compare-and-set; best-effort).
      const claim = await claimCallSlot(status.id, status.last_action_at);
      if (!claim.claimed) {
        console.error(
          `[cooldown-caller] Skipping call for item "${status.id}" - could not claim call slot: ${claim.reason}`
        );
        continue;
      }

      const idempotencyKey = `cooldown-caller-${status.id}-${status.last_action_at}`;
      const call = await placeCall({
        task: status.call_task,
        phone: TARGET_PHONE,
        idempotencyKey,
        metadata: { project: "cooldown-caller", item_id: status.id, trigger },
      });

      const entry: CallLogEntry = {
        log_id: randomUUID(),
        item_id: status.id,
        item_name: status.name,
        call_id: call.id,
        phone_e164: TARGET_PHONE,
        task: status.call_task,
        status: call.status,
        task_completed: call.task_completed,
        summary: call.summary,
        transcript_turns: call.recipients[0]?.attempts.flatMap((a) => a.transcript_turns) ?? [],
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        trigger,
      };
      entries.unshift(entry);
      newlyPlaced.push(status.id);
      mutated = true; // a newly placed call is always a real state transition
    } catch (err) {
      console.error(`[cooldown-caller] Failed to evaluate/call tracked item "${status.id}"`, err);
    }
  }

  if (mutated) {
    await writeLog(entries);
  }

  return {
    checked_at: now.toISOString(),
    trigger,
    statuses,
    new_calls_placed: newlyPlaced,
    log: redactLogForClient(entries),
  };
}

// Vercel Cron always issues a GET request against the configured path
// (see vercel.json). The dashboard's "Run check now" button issues a POST.
// Both paths run the exact same check-and-call logic; only the recorded
// `trigger` label differs, so the persisted log always shows which runs
// were autonomous vs. manually requested.
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized cron trigger." }, { status: 401 });
  }
  try {
    const result = await runCheck("cron");
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req?: NextRequest) {
  if (!manualAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized manual trigger." }, { status: 401 });
  }
  try {
    const result = await runCheck("manual");
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
