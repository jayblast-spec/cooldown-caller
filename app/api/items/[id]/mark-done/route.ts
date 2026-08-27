import { NextRequest, NextResponse } from "next/server";
import { markItemDone } from "@/lib/tracked-items-store";

export const dynamic = "force-dynamic";

/**
 * Marks a tracked item "just done" (resets last_action_at to now). Takes
 * only the item id from the URL path -- no request body is read at all,
 * so there is no way for a caller to pass a phone number, or anything
 * else, through this route.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await markItemDone(id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ item: result.item });
}
