import { NextResponse } from "next/server";
import { computeAllStatuses, type TrackedItemsFile } from "@/lib/cooldown";
import { loadTrackedItems } from "@/lib/tracked-items-store";

export const dynamic = "force-dynamic";

/**
 * Agent-mesh inbox. Read-only by design: reports this agent's real current
 * cooldown status back to whatever mesh control-plane messaged it. It never
 * calls claimCallSlot/placeCall, so receiving a mesh message can never
 * trigger a real outbound phone call — that stays gated behind the
 * ring-2 approval flow enforced by the mesh itself before /api/check runs.
 */
export async function POST(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // no body is fine, treat as a bare ping
  }

  const itemsResult = await loadTrackedItems();
  const file: TrackedItemsFile = {
    _note: "Supabase-backed tracked_items table.",
    items: itemsResult.ok ? itemsResult.items : [],
  };
  const statuses = computeAllStatuses(file, new Date());

  return NextResponse.json({
    agent: "cooldown-caller",
    received: true,
    received_payload: body,
    acknowledged_at: new Date().toISOString(),
    real_status: {
      tracked_items: statuses.length,
      actionable_now: statuses.filter((s) => s.state === "actionable").length,
    },
  });
}
