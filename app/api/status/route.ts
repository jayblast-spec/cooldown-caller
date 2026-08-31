import { NextResponse } from "next/server";
import { computeAllStatuses, type TrackedItemsFile } from "@/lib/cooldown";
import { buildCallDecision } from "@/lib/call-decision";
import { readLog, redactLogForClient } from "@/lib/call-log-store";
import { loadTrackedItems } from "@/lib/tracked-items-store";

export const dynamic = "force-dynamic";

// Same env check app/api/check/route.ts uses to gate real calls -- reading
// process.env has no side effect, so mirroring it here for display is safe.
const TARGET_PHONE = process.env.TARGET_PHONE;

/**
 * Read-only dashboard endpoint: computes the same `statuses`/`log` shape
 * app/api/check/route.ts's runCheck() returns, but ONLY the read side --
 * `loadTrackedItems`, `computeAllStatuses`, `readLog`. It never calls
 * `claimCallSlot`, `placeCall`, or `writeLog`, so viewing/polling the
 * dashboard can never place or claim a real CALL-E call.
 *
 * This exists because runCheck() places real calls on its GET path too
 * (Vercel Cron and passive dashboard polling both hit the same code path
 * that can dial out for any item that happens to be actionable during that
 * check). components/Dashboard.tsx's auto-poll now reads from here instead;
 * the explicit "Run check now" button is the only UI action left that still
 * calls the real POST /api/check.
 */
export async function GET() {
  const now = new Date();
  const itemsResult = await loadTrackedItems();
  const file: TrackedItemsFile = {
    _note: "Supabase-backed tracked_items table (see lib/tracked-items-store.ts).",
    items: itemsResult.ok ? itemsResult.items : [],
  };
  const statuses = computeAllStatuses(file, now);
  const decisionTrace = statuses.map((status) => buildCallDecision(status, Boolean(TARGET_PHONE)));

  const logResult = await readLog();
  if (!logResult.ok) {
    return NextResponse.json({
      checked_at: now.toISOString(),
      statuses,
      decision_trace: decisionTrace,
      log: [],
      new_calls_placed: [],
      warning: `Call log unavailable: ${logResult.error}`,
    });
  }

  return NextResponse.json({
    checked_at: now.toISOString(),
    statuses,
    decision_trace: decisionTrace,
    log: redactLogForClient(logResult.entries),
    new_calls_placed: [],
  });
}
