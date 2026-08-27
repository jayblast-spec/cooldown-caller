import { NextRequest, NextResponse } from "next/server";
import { loadTrackedItems, createTrackedItem } from "@/lib/tracked-items-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await loadTrackedItems();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ items: result.items });
}

/**
 * Creates a new tracked item.
 *
 * SAFETY: the request body is never spread into the write path. Only
 * `name`, `category`, `cooldown_hours`, and `last_action_at` are ever read
 * off it below, each coerced to its expected primitive type -- any other
 * field on the body (including any phone/destination-shaped field) is
 * silently ignored here and never reaches lib/tracked-items-store.ts, the
 * database, or the call pipeline. There is intentionally no phone number
 * field anywhere on this route or its request/response shape.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const result = await createTrackedItem({
    name: typeof b.name === "string" ? b.name : "",
    category: typeof b.category === "string" ? b.category : "",
    cooldown_hours: typeof b.cooldown_hours === "number" ? b.cooldown_hours : Number(b.cooldown_hours),
    last_action_at: typeof b.last_action_at === "string" ? b.last_action_at : undefined,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ item: result.item }, { status: 201 });
}
