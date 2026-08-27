/**
 * Minimal client for CALL-E's Developer API (https://docs.heycall-e.com/#/api-reference).
 * CALL-E is a goal-driven outbound-calling agent: you give it a task and a
 * phone number, it plans, dials, holds a live conversation, and returns a
 * structured result + transcript.
 *
 * Auth: Authorization: Bearer <CALLE_API_KEY>, obtained from
 * https://dashboard.heycall-e.com/account/api-keys after signing in with
 * Google at https://www.heycall-e.com - sign-in grants 20 free calls, no
 * card required.
 */

const CALLE_BASE_URL = process.env.CALLE_BASE_URL ?? "https://api.heycall-e.com";
const CALLE_API_KEY = process.env.CALLE_API_KEY;

export interface CalleRecipient {
  phones: string[];
  region: string;
  locale: string;
}

export interface CalleTranscriptTurn {
  offset_seconds: number;
  speaker: "bot" | "user";
  text: string;
}

export interface CalleAttempt {
  id: string;
  phone: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  summary: string | null;
  transcript_turns: CalleTranscriptTurn[];
  provider_call_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
}

export interface CalleCallTask {
  id: string;
  object: "call_task";
  status: "queued" | "completed" | "failed" | string;
  task: string;
  recipients: Array<{
    id: string;
    phones: string[];
    locale: string;
    region: string;
    status: string;
    structured_result: unknown;
    summary: string | null;
    attempts: CalleAttempt[];
  }>;
  structured_result: unknown;
  summary: string | null;
  task_completed: boolean | null;
  completion_confidence: { score: number; label: string } | null;
  evidence: string[];
  metadata: Record<string, unknown>;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function assertConfigured() {
  if (!CALLE_API_KEY) {
    throw new Error(
      "CALLE_API_KEY is not set. Sign in at https://www.heycall-e.com and create a key at " +
        "https://dashboard.heycall-e.com/account/api-keys, then set CALLE_API_KEY."
    );
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2; // one initial attempt + one retry
const RETRY_BACKOFF_MS = 500;

/**
 * fetch() wrapped with a per-attempt timeout and one retry with backoff.
 *
 * Safe to retry `placeCall` specifically because every call already carries
 * an `Idempotency-Key` header derived from the tracked item + its current
 * cooldown cycle (see app/api/check/route.ts) - CALL-E is expected to
 * dedupe on that key, so a retry after a timed-out-but-possibly-succeeded
 * request cannot itself cause a second real phone call.
 */
async function fetchWithTimeoutAndRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function placeCall(params: {
  task: string;
  phone: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<CalleCallTask> {
  assertConfigured();
  const res = await fetchWithTimeoutAndRetry(`${CALLE_BASE_URL}/v1/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CALLE_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify({
      task: params.task,
      recipients: [{ phones: [params.phone], region: "US", locale: "en-US" }] satisfies CalleRecipient[],
      metadata: params.metadata ?? {},
    }),
  });

  const body = (await res.json()) as CalleCallTask | { message?: string };
  if (!res.ok) {
    throw new Error(`CALL-E create call failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body as CalleCallTask;
}

export async function getCall(callId: string): Promise<CalleCallTask> {
  assertConfigured();
  const res = await fetchWithTimeoutAndRetry(`${CALLE_BASE_URL}/v1/calls/${callId}`, {
    headers: { Authorization: `Bearer ${CALLE_API_KEY}` },
  });
  const body = (await res.json()) as CalleCallTask | { message?: string };
  if (!res.ok) {
    throw new Error(`CALL-E get call failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body as CalleCallTask;
}

export const CALLE_TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
]);
