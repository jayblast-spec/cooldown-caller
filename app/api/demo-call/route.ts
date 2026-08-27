import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { claimCallSlot, incrementDemoCallCount } from "@/lib/call-log-store";
import { placeCall } from "@/lib/calle";

export const dynamic = "force-dynamic";

const TARGET_PHONE = process.env.TARGET_PHONE;

/**
 * "Ring the demo line" -- a public, unauthenticated button that places one
 * real CALL-E call so a visitor can experience the product's core action
 * without adding a real tracked item. This is deliberately NOT the same as
 * the "Ring my phone now, enter your number" feature a reviewer proposed
 * and which was explicitly rejected: this endpoint always dials the same
 * fixed, pre-authorized TARGET_PHONE (never a request-supplied number) --
 * identical safety invariant to every other call-placing path in this app.
 *
 * Two independent safeguards, both fail-closed:
 *  1. A global rate limit (1 per RATE_LIMIT_WINDOW_MS) via the same
 *     claimCallSlot lock this app already uses for real cooldown calls --
 *     reused rather than reinventing a new lock mechanism.
 *  2. A hard lifetime cap (DEMO_CALL_LIFETIME_CAP) on top of the rate
 *     limit. CALL-E's free tier grants a fixed number of calls at signup,
 *     not a recurring quota -- an uncapped public demo button could
 *     exhaust the same account budget the real product depends on for its
 *     actual judged functionality. Once the cap is hit, this endpoint
 *     refuses permanently rather than degrade the real feature.
 */
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 1 demo call per 15 minutes, globally
const DEMO_CALL_LIFETIME_CAP = 5;
const DEMO_TASK =
  "Deliver a short demo message. Say exactly: Hi, this is Cooldown Caller. This is a demo call. " +
  "When a real rate-limit cooldown clears, this is the call you will get. This is an automated demo, no action needed. Goodbye. " +
  "Then end the call politely. Do not ask questions.";

export async function POST() {
  if (!TARGET_PHONE) {
    return NextResponse.json({ error: "Demo call is not configured on this deployment." }, { status: 503 });
  }

  // Time-bucketed cycle key: every request within the same window maps to
  // the same key, so claimCallSlot's existing lock semantics (one claim per
  // cycleKey per TTL) give us "at most one demo call per window" for free.
  const windowStart = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS;
  const cycleKey = String(windowStart);
  const claim = await claimCallSlot("demo-line", cycleKey, RATE_LIMIT_WINDOW_MS);
  if (!claim.claimed) {
    const retryAfterMs = windowStart + RATE_LIMIT_WINDOW_MS - Date.now();
    return NextResponse.json(
      {
        error: "A demo call was placed recently. Try again shortly.",
        retry_after_seconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      },
      { status: 429 }
    );
  }

  // Only reserve scarce lifetime budget after the cheaper window lock is
  // acquired. Rejected bursts must not burn the permanent demo allowance.
  const countResult = await incrementDemoCallCount(DEMO_CALL_LIFETIME_CAP);
  if (!countResult.ok) {
    return NextResponse.json({ error: countResult.reason }, { status: 503 });
  }
  if (countResult.capReached) {
    return NextResponse.json(
      { error: "The demo call budget for this hackathon submission has been used up. The real product isn't affected - try adding a tracked item and running a real check instead." },
      { status: 429 }
    );
  }

  try {
    const call = await placeCall({
      task: DEMO_TASK,
      phone: TARGET_PHONE,
      idempotencyKey: `cooldown-caller-demo-${cycleKey}-${randomUUID()}`,
      metadata: { project: "cooldown-caller", kind: "public-demo-call" },
    });
    return NextResponse.json({ placed: true, status: call.status });
  } catch (err) {
    console.error("[cooldown-caller] demo call failed", err);
    return NextResponse.json({ error: "The demo call could not be placed. Please try again later." }, { status: 502 });
  }
}
