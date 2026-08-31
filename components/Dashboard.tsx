"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ItemStatus } from "@/lib/cooldown";
import type { CallDecision } from "@/lib/call-decision";
import type { PublicCallLogEntry } from "@/lib/call-log-store";
import AgentPattern from "@/components/AgentPattern";
import FinalCta from "@/components/FinalCta";

interface CheckResponse {
  checked_at: string;
  statuses: ItemStatus[];
  decision_trace?: CallDecision[];
  log: PublicCallLogEntry[];
  new_calls_placed?: string[];
  error?: string;
}

const DECISION_AGENT_LABEL: Record<CallDecision["agents"][number]["agent"], string> = {
  watcher: "Watcher",
  permission: "Permission Gate",
  briefing: "Briefing",
};

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "00:00:00";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

/**
 * CALL-E's live/in-flight call status is reported as "queued" -- meaning
 * the agent has dialed and the conversation may be actively happening.
 * We surface that truthfully as CALLING rather than a passive "queued",
 * since that in-progress moment is this product's whole differentiator.
 */
type CallPhase = "calling" | "completed" | "failed";

function callPhaseOf(status: string): CallPhase {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "calling";
}

const CALL_PHASE_LABEL: Record<CallPhase, string> = {
  calling: "calling now",
  completed: "completed",
  failed: "failed",
};

function CallPhaseChip({ status }: { status: string }) {
  const phase = callPhaseOf(status);
  if (phase === "calling") {
    return (
      <span className="scanning-sweep mono-label inline-flex items-center gap-1.5 rounded-sm border border-[color:var(--color-primary)] px-2 py-0.5 text-[color:var(--color-primary)]">
        <PhoneIcon className="h-3 w-3 pulse-live" />
        {CALL_PHASE_LABEL.calling}
      </span>
    );
  }
  if (phase === "completed") {
    return (
      <span className="mono-label inline-flex items-center gap-1.5 rounded-sm bg-[color:var(--color-primary)] px-2 py-0.5 text-[color:var(--color-primary-foreground)]">
        completed
      </span>
    );
  }
  return (
    <span className="mono-label inline-flex items-center gap-1.5 rounded-sm border border-[#ffb4ab] px-2 py-0.5 text-[#ffb4ab]">
      failed
    </span>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Broadcast/signal icon -- content-publishing (a post going out). */
function BroadcastIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} style={style}>
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <path
        d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Price-tag icon -- marketplace-listing (a listing you resell/repost). */
function TagIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} style={style}>
      <path
        d="M11.6 3.4h5c.6 0 1 .4 1 1v5c0 .3-.1.5-.3.7l-8.6 8.6a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1 0-1.4l8.6-8.6c.2-.2.4-.3.7-.3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="15.1" cy="7.9" r="1.3" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** Clipboard-check icon -- back-office (an audit/review task). */
function ClipboardIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} style={style}>
      <rect x="5.5" y="4.5" width="13" height="16" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5V6H9V4.5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.5 13.5 10.8 15.8 15.5 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Four-point spark icon -- fallback for any category outside the three
 *  above (custom items, QA/test rows). */
function SparkIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} style={style}>
      <path
        d="M12 3v4.2M12 16.8V21M3 12h4.2M16.8 12H21M6 6l2.6 2.6M15.4 15.4 18 18M18 6l-2.6 2.6M8.6 15.4 6 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Maps a tracked item's category string to a distinct icon + accent color
 * so the grid reads by category at a glance instead of every card looking
 * identical. Falls back to the neutral "other" theme for any category text
 * that isn't one of the three named ones (custom items, QA/test rows) --
 * this never blocks a category value, it just can't give it a bespoke icon.
 */
function categoryTheme(category: string): { color: string; Icon: React.FC<{ className?: string; style?: React.CSSProperties }> } {
  const key = category.toLowerCase();
  if (key.includes("publish") || key.includes("content")) {
    return { color: "var(--category-content)", Icon: BroadcastIcon };
  }
  if (key.includes("market") || key.includes("listing")) {
    return { color: "var(--category-marketplace)", Icon: TagIcon };
  }
  if (key.includes("office") || key.includes("audit") || key.includes("compliance")) {
    return { color: "var(--category-backoffice)", Icon: ClipboardIcon };
  }
  return { color: "var(--category-other)", Icon: SparkIcon };
}

/** Circular cooldown-progress instrument. Pure CSS conic-gradient ring --
 *  no canvas/SVG animation cost, respects reduced-motion by default since
 *  only the underlying value changes, never a spin. */
function CooldownRing({ percent, ready, category }: { percent: number; ready: boolean; category: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const { color: categoryColor, Icon: CategoryIcon } = categoryTheme(category);
  // Ready always reads as the universal cyan "it's calling" signal -- that
  // consistency is the product's core cue and shouldn't compete with
  // per-category color. While cooling, the ring's own progress arc and
  // icon take on the category's color, so the grid is readable by category
  // at a glance instead of every card looking identical.
  const ringColor = ready ? "var(--color-primary)" : categoryColor;
  return (
    <div
      className="dial-bezel relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full transition-shadow duration-500 ease-out"
      style={{
        background: `conic-gradient(${ringColor} ${clamped * 3.6}deg, var(--color-border) 0deg)`,
      }}
      role="img"
      aria-label={ready ? "Cooldown cleared" : `${Math.round(clamped)} percent through cooldown`}
    >
      <div className="dial-face flex h-[52px] w-[52px] flex-col items-center justify-center gap-0.5 rounded-full bg-[color:var(--color-card)] transition-shadow duration-500 ease-out">
        {ready ? (
          <PhoneIcon className="h-5 w-5 pulse-live text-[color:var(--color-primary)]" />
        ) : (
          <>
            <CategoryIcon className="h-4 w-4" style={{ color: categoryColor }} />
            <span className="mono-data text-[10px] font-medium text-[color:var(--color-muted-foreground)]">
              {Math.round(clamped)}%
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** Read-only rendering of the fail-closed decision mesh (Watcher -> Permission
 *  Gate -> Briefing) that /api/check runs before CALL-E dials. Sourced from
 *  /api/status's decision_trace, itself the same pure buildCallDecision()
 *  function -- this never triggers a call, it only shows the same reasoning
 *  that would gate one. */
function DecisionTrace({ decision }: { decision: CallDecision }) {
  return (
    <div className="mt-3 flex flex-col gap-1.5 border-t border-[color:var(--color-border)] pt-3">
      {decision.agents.map((step) => (
        <div key={step.agent} className="flex items-start gap-2 text-xs">
          <span className="mono-label shrink-0 text-[color:var(--color-primary)]">
            {DECISION_AGENT_LABEL[step.agent]}
          </span>
          <span className="text-[color:var(--color-muted-foreground)]">{step.finding}</span>
        </div>
      ))}
    </div>
  );
}

function ItemCard({
  status,
  decision,
  index,
  onMarkDone,
}: {
  status: ItemStatus;
  decision?: CallDecision;
  index: number;
  onMarkDone: (id: string) => Promise<void>;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [markingDone, setMarkingDone] = useState(false);
  // Mount-entrance animation only plays once; the class is dropped the
  // moment it finishes so it never fights the later one-shot alert
  // animation over the shared `animation` property.
  const [mounting, setMounting] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const readyAtMs = new Date(status.ready_at).getTime();
  const remaining = Math.max(0, Math.round((readyAtMs - now) / 1000));
  const isActionable = remaining <= 0;

  // One-shot "went ready" alert: fires only on the transition into
  // actionable while this card is mounted (a real cooldown clearing),
  // never on initial load of an already-ready item.
  const wasActionable = useRef(isActionable);
  const [justWentReady, setJustWentReady] = useState(false);
  useEffect(() => {
    if (isActionable && !wasActionable.current) {
      setJustWentReady(true);
    }
    wasActionable.current = isActionable;
  }, [isActionable]);

  const handleMarkDone = async () => {
    setMarkingDone(true);
    try {
      await onMarkDone(status.id);
    } finally {
      setMarkingDone(false);
    }
  };

  return (
    <div
      className={`instrument-card instrument-card-hover flex flex-col gap-4 p-4 ${
        mounting ? "card-deploy" : ""
      } ${isActionable ? "glow-primary" : ""} ${justWentReady ? "alert-flash" : ""}`}
      style={mounting ? { animationDelay: `${Math.min(index, 8) * 60}ms` } : undefined}
      onAnimationEnd={(e) => {
        if (e.animationName === "card-deploy") setMounting(false);
        if (e.animationName === "alert-flash") setJustWentReady(false);
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <CooldownRing percent={status.percent_elapsed} ready={isActionable} category={status.category} />
          <div>
            <div className="mono-label mb-1">{status.category}</div>
            <h3 className="text-[15px] font-semibold leading-tight text-[color:var(--color-foreground)]">
              {status.name}
            </h3>
          </div>
        </div>
        <span
          className={`mono-label shrink-0 rounded-sm border px-2 py-0.5 transition-colors duration-500 ease-out ${
            isActionable
              ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)]"
              : "border-[color:var(--color-border-strong)] text-[color:var(--color-muted-foreground)]"
          }`}
        >
          {isActionable ? "ready" : "cooling"}
        </span>
      </div>

      <div className="flex items-end justify-between border-t border-[color:var(--color-border)] pt-3">
        <div>
          <div className="mono-label mb-1">{isActionable ? "call placed / pending" : "time remaining"}</div>
          <div className="mono-data tick-in text-xl font-medium" key={isActionable ? "ready" : remaining}>
            {isActionable ? "READY" : formatDuration(remaining)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="mono-data text-right text-xs text-[color:var(--color-muted-foreground)]">
            last action
            <br />
            {new Date(status.last_action_at).toISOString().replace("T", " ").slice(0, 16)} UTC
          </div>
          <button
            onClick={handleMarkDone}
            disabled={markingDone}
            className="mono-label rounded-sm border border-[color:var(--color-border-strong)] px-2.5 py-1 text-[color:var(--color-muted-foreground)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary)] disabled:opacity-50"
          >
            {markingDone ? "marking…" : "mark just done"}
          </button>
        </div>
      </div>
      {decision && <DecisionTrace decision={decision} />}
    </div>
  );
}

/** Decorative status pulse. It is derived only from public state and does
 * not encode transcript length, speakers, or any other conversation data. */
function StatusPulse({ status }: { status: string }) {
  const phase = callPhaseOf(status);
  return (
    <div className="flex h-8 items-end gap-[3px]" aria-hidden="true">
      {Array.from({ length: 18 }).map((_, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full ${phase === "calling" ? "pulse-live" : ""}`}
          style={{
            height: `${20 + ((i * 11) % 65)}%`,
            backgroundColor: phase === "completed" ? "var(--color-primary)" : "var(--color-border-strong)",
            animationDelay: `${i * 60}ms`,
          }}
        />
      ))}
    </div>
  );
}

function LogEntryCard({ entry, index }: { entry: PublicCallLogEntry; index: number }) {
  const [mounting, setMounting] = useState(true);
  const phase = callPhaseOf(entry.status);

  return (
    <li
      className={`instrument-card instrument-card-hover overflow-hidden ${mounting ? "card-deploy" : ""} ${
        phase === "calling" ? "glow-primary" : ""
      }`}
      style={mounting ? { animationDelay: `${Math.min(index, 8) * 60}ms` } : undefined}
      onAnimationEnd={(e) => {
        if (e.animationName === "card-deploy") setMounting(false);
      }}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <StatusPulse status={entry.status} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-[color:var(--color-foreground)]">
                {entry.item_name}
              </h3>
              <CallPhaseChip status={entry.status} />
            </div>
            <div className="mono-data mt-1 truncate text-xs text-[color:var(--color-muted-foreground)]">
              {new Date(entry.created_at).toISOString().replace("T", " ").slice(0, 19)} UTC
              {" · "}
              {entry.trigger === "cron" ? "autonomous" : "manual trigger"}
            </div>
          </div>
        </div>
        <span className="mono-label shrink-0 text-[color:var(--color-muted-foreground)]">public status only</span>
      </div>
    </li>
  );
}

/**
 * Add-tracked-item form.
 *
 * SAFETY: this form has exactly four fields -- name, category, cooldown
 * hours, and an optional "last done" timestamp -- and deliberately NO
 * phone number field of any kind. The destination phone number that gets
 * called is fixed at the infrastructure level (TARGET_PHONE, an env var
 * read server-side in app/api/check/route.ts); a tracked item only ever
 * describes WHAT a reminder call is about, never WHO gets called. There is
 * no UI control anywhere in this app that can set or influence that number.
 */
export interface AddItemFormHandle {
  /** Used by the "Popular Cooldowns" template buttons to prefill and open
   * this same form -- templates never bypass its normal validation/create
   * path, they just save the user from typing sensible starting defaults. */
  prefillAndOpen: (values: { name: string; category: string; cooldownHours: string }) => void;
}

const AddItemForm = forwardRef<AddItemFormHandle, { onCreated: () => Promise<void> }>(function AddItemForm(
  { onCreated },
  ref
) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [cooldownHours, setCooldownHours] = useState("24");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const formElRef = useRef<HTMLFormElement>(null);

  useImperativeHandle(ref, () => ({
    prefillAndOpen: (values) => {
      setName(values.name);
      setCategory(values.category);
      setCooldownHours(values.cooldownHours);
      setOpen(true);
    },
  }));

  // The form renders as the last card in the tracked-items grid, which can
  // sit well below the fold once a few items exist -- opening it with no
  // scroll cue looked completely inert from a "Popular Cooldowns" click
  // above the grid (the prefill genuinely worked, there was just no visible
  // feedback near the button that anything had happened). Scroll it into
  // view whenever it transitions from closed to open, from either trigger.
  useEffect(() => {
    if (open) {
      formElRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          cooldown_hours: Number(cooldownHours),
        }),
      });
      const json = (await res.json()) as { item?: unknown; error?: string };
      if (!res.ok) throw new Error(json.error ?? "failed to add item");
      setName("");
      setCategory("");
      setCooldownHours("24");
      setOpen(false);
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mono-label w-full rounded-sm border border-dashed border-[color:var(--color-border-strong)] p-4 text-center text-[color:var(--color-muted-foreground)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary)]"
      >
        + add tracked item
      </button>
    );
  }

  return (
    <form ref={formElRef} onSubmit={handleSubmit} className="instrument-card panel-deploy flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="mono-label text-[color:var(--color-foreground)]">new tracked item</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="mono-label text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-primary)]"
        >
          cancel
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="mono-label text-[color:var(--color-muted-foreground)]">name</span>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Publish next track"
          className="rounded-sm border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-3 py-2 text-sm text-[color:var(--color-foreground)] outline-none focus-visible:border-[color:var(--color-primary)]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="mono-label text-[color:var(--color-muted-foreground)]">category</span>
        <input
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. content-publishing"
          className="rounded-sm border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-3 py-2 text-sm text-[color:var(--color-foreground)] outline-none focus-visible:border-[color:var(--color-primary)]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="mono-label text-[color:var(--color-muted-foreground)]">cooldown hours (min 1)</span>
        <input
          required
          type="number"
          min={1}
          step="0.1"
          value={cooldownHours}
          onChange={(e) => setCooldownHours(e.target.value)}
          className="mono-data rounded-sm border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-3 py-2 text-sm text-[color:var(--color-foreground)] outline-none focus-visible:border-[color:var(--color-primary)]"
        />
      </label>

      {error && (
        <p role="alert" className="text-xs text-[#ffb4ab]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mono-label rounded-sm bg-[color:var(--color-primary)] px-4 py-2 text-[color:var(--color-primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "adding…" : "add item"}
      </button>
    </form>
  );
});

/**
 * "Ring the demo line" -- places one real CALL-E call so a visitor can
 * experience the product's core action without adding a tracked item
 * first. Always dials the app's one fixed, pre-authorized number
 * (app/api/demo-call/route.ts never accepts a phone number from the
 * client) and is rate-limited plus lifetime-capped server-side; this
 * component only surfaces whatever the server decided.
 */
function DemoCallButton() {
  const [state, setState] = useState<"idle" | "calling" | "placed" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const ring = useCallback(async () => {
    setState("calling");
    setMessage(null);
    try {
      const res = await fetch("/api/demo-call", { method: "POST" });
      const json = (await res.json()) as { placed?: boolean; error?: string; retry_after_seconds?: number };
      if (!res.ok || !json.placed) {
        setState("error");
        setMessage(
          json.retry_after_seconds
            ? `${json.error ?? "Try again shortly."} (~${Math.ceil(json.retry_after_seconds / 60)}m)`
            : (json.error ?? "The demo call could not be placed.")
        );
        return;
      }
      setState("placed");
      setMessage("Demo call placed - it's ringing now.");
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={ring}
        disabled={state === "calling"}
        className="mono-label glow-primary rounded-sm border-2 border-[color:var(--color-primary)] bg-[color:var(--color-card)] px-5 py-2.5 text-[color:var(--color-primary)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary)] disabled:opacity-50"
      >
        {state === "calling" ? "ringing…" : "ring the demo line →"}
      </button>
      {message && (
        <p role="status" className="mono-label text-xs text-[color:var(--color-muted-foreground)]">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * "Popular Cooldowns" -- one-click starting defaults for common
 * rate-limited actions. These do not bypass AddItemForm's normal
 * POST /api/items create path or validation; they only prefill the form
 * (via the ref above) so a judge/visitor doesn't have to guess sensible
 * numbers. Every duration here is a generic starting point, not a claim
 * about any specific platform's actual current policy -- the user can
 * (and is expected to) adjust before submitting.
 */
const COOLDOWN_TEMPLATES = [
  // Category corrected to marketplace-listing (was content-publishing) --
  // relisting an expired listing is the same shape of action as Craigslist's
  // repost, not a content-publishing cadence.
  { label: "eBay relisting cap", name: "eBay: relist expired listings", category: "marketplace-listing", cooldownHours: "720" },
  { label: "Craigslist repost", name: "Craigslist: repost listing", category: "marketplace-listing", cooldownHours: "48" },
  { label: "Reddit/HN post throttle", name: "Reddit: next post window", category: "content-publishing", cooldownHours: "24" },
  { label: "Google Business post cadence", name: "Google Business Profile: post update", category: "content-publishing", cooldownHours: "168" },
] as const;

function PopularCooldowns({ onPick }: { onPick: (t: (typeof COOLDOWN_TEMPLATES)[number]) => void }) {
  return (
    <div className="instrument-card p-4">
      <h3 className="mono-label mb-3 text-[color:var(--color-muted-foreground)]">popular cooldowns</h3>
      <div className="flex flex-wrap gap-2">
        {COOLDOWN_TEMPLATES.map((t) => {
          const { color, Icon } = categoryTheme(t.category);
          return (
            <button
              key={t.label}
              type="button"
              onClick={() => onPick(t)}
              className="mono-label inline-flex items-center gap-1.5 rounded-sm border border-[color:var(--color-border-strong)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:border-[color:var(--color-border-strong)]"
              style={{ borderColor: "var(--color-border-strong)" }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = color)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--color-border-strong)")}
            >
              <Icon className="h-3.5 w-3.5" style={{ color }} />+ {t.label}
            </button>
          );
        })}
      </div>
      <p className="mono-label mt-3 text-[10px] text-[color:var(--color-muted-foreground)]">
        starting defaults - adjust the cooldown before saving to match your own situation
      </p>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<CheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addItemFormRef = useRef<AddItemFormHandle>(null);

  // Passive viewing/auto-poll reads from /api/status, which is read-only and
  // can never place a real call -- see app/api/status/route.ts. Only the
  // explicit "Run check now" button below (runCheckNow) hits the real
  // POST /api/check.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const json = (await res.json()) as CheckResponse;
      if (!res.ok) throw new Error(json.error ?? "status check failed");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const runCheckNow = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/check", { method: "POST" });
      const json = (await res.json()) as CheckResponse;
      if (!res.ok) throw new Error(json.error ?? "check failed");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const id = setInterval(refresh, 30000);
    return () => {
      window.clearTimeout(initial);
      clearInterval(id);
    };
  }, [refresh]);

  const markDone = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/items/${encodeURIComponent(id)}/mark-done`, { method: "POST" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "failed to mark item done");
      await refresh();
    },
    [refresh]
  );

  const watching = data?.statuses.length ?? 0;
  const readyCount = data?.statuses.filter((s) => s.state === "actionable").length ?? 0;
  const callsPlaced = data?.log.length ?? 0;
  const isWatching = readyCount === 0;

  return (
    <main id="dashboard" className="mx-auto max-w-5xl px-5 pb-16 sm:px-8">
      {/* Hero -- the agency of a real outbound call is the whole story. */}
      <header className="instrument-grid-bg relative -mx-5 mb-10 flex flex-col items-center gap-6 overflow-hidden border-b border-[color:var(--color-border)] px-5 pb-12 pt-14 text-center sm:-mx-8 sm:px-8">
        <div className="relative flex h-20 w-20 items-center justify-center" aria-hidden="true">
          <span className="watch-rings" />
          <span className="watch-rings" style={{ animationDelay: "0.9s" }} />
          <span className="watch-rings" style={{ animationDelay: "1.8s" }} />
          <span
            className={`relative flex h-14 w-14 items-center justify-center rounded-full border ${
              isWatching
                ? "border-[color:var(--color-border-strong)] text-[color:var(--color-muted-foreground)]"
                : "glow-primary border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
            } bg-[color:var(--color-card)]`}
          >
            <PhoneIcon className={`h-6 w-6 ${!isWatching ? "pulse-live" : ""}`} />
          </span>
        </div>

        <div className="max-w-2xl">
          <p className="mono-label mb-2 text-[color:var(--color-muted-foreground)]">
            cooldown caller - rate-limit escalation
          </p>
          <h1 className="mono-data text-3xl font-bold tracking-tight text-[color:var(--color-foreground)] sm:text-4xl">
            You set the cooldown.
            <br />
            We make the call.
          </h1>
          <p className="mt-3 text-sm text-[color:var(--color-muted-foreground)] sm:text-base">
            Track rate-limited actions across any platform. When a scheduled or manual check discovers a cooldown has
            cleared,{" "}
            <a
              href="https://www.heycall-e.com"
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--color-primary)] underline decoration-dotted underline-offset-4"
            >
              CALL-E
            </a>{" "}
            places a real outbound phone call - no chat, no question asked, no dashboard-checking required.
          </p>
        </div>

        <ul className="mono-label flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[color:var(--color-muted-foreground)]">
          <li>eBay relisting caps</li>
          <li aria-hidden="true">·</li>
          <li>Craigslist repost windows</li>
          <li aria-hidden="true">·</li>
          <li>compliance deadlines</li>
        </ul>

        <DemoCallButton />

        <div
          className="flex flex-wrap items-center justify-center gap-3"
          role="status"
          aria-live="polite"
        >
          <span className="mono-label inline-flex items-center gap-2 rounded-sm border border-[color:var(--color-border-strong)] bg-[color:var(--color-card)] px-3 py-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${readyCount > 0 ? "pulse-live bg-[color:var(--color-primary)]" : "bg-[color:var(--color-muted-foreground)]"}`}
            />
            watching {watching} item{watching === 1 ? "" : "s"}
            {readyCount > 0 ? ` · ${readyCount} ready` : ""}
          </span>
          <span className="mono-label inline-flex items-center gap-2 rounded-sm border border-[color:var(--color-border-strong)] bg-[color:var(--color-card)] px-3 py-1.5">
            {callsPlaced} call event{callsPlaced === 1 ? "" : "s"}
          </span>
          <button
            onClick={runCheckNow}
            disabled={loading}
            className="mono-label rounded-sm bg-[color:var(--color-primary)] px-4 py-2 text-[color:var(--color-primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary)] disabled:opacity-50"
          >
            {loading ? "checking…" : "run check now"}
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="mb-6 rounded-sm border border-[#ffb4ab] bg-[color:var(--color-surface)] px-4 py-3 text-sm text-[#ffb4ab]">
          {error}
        </div>
      )}

      <section aria-labelledby="tracked-items-heading" className="mb-10">
        <h2 id="tracked-items-heading" className="mono-label mb-3">
          tracked items
        </h2>
        <div className="mb-4">
          <PopularCooldowns
            onPick={(t) => addItemFormRef.current?.prefillAndOpen({ name: t.name, category: t.category, cooldownHours: t.cooldownHours })}
          />
        </div>
        <div className="instrument-bay grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.statuses.map((s, i) => (
            <ItemCard
              key={s.id}
              status={s}
              decision={data.decision_trace?.find((d) => d.item_id === s.id)}
              index={i}
              onMarkDone={markDone}
            />
          ))}
          {!data && (
            <div className="instrument-card p-4 text-sm text-[color:var(--color-muted-foreground)]">
              Loading…
            </div>
          )}
          <AddItemForm ref={addItemFormRef} onCreated={refresh} />
        </div>
      </section>

      <section aria-labelledby="call-log-heading">
        <h2 id="call-log-heading" className="mono-label mb-3">
          call activity - public operational status only
        </h2>
        <ul className="instrument-bay flex flex-col gap-3">
          {data?.log.map((entry, i) => <LogEntryCard key={`${entry.item_id}-${entry.created_at}`} entry={entry} index={i} />)}
        </ul>
        {data && data.log.length === 0 && (
          <div className="instrument-card p-6 text-center text-sm text-[color:var(--color-muted-foreground)]">
            No calls placed yet. Click &quot;run check now&quot; once an item is ready, or wait for the daily
            autonomous check.
          </div>
        )}
      </section>

      <section aria-labelledby="why-a-call-heading" className="mt-14 border-t border-[color:var(--color-border)] pt-10">
        <h2 id="why-a-call-heading" className="mono-data mb-6 text-center text-xl font-bold text-[color:var(--color-foreground)]">
          Why a phone call?
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div>
            <h3 className="mono-label mb-1 text-[color:var(--color-primary)]">notifications get swiped</h3>
            <p className="text-sm text-[color:var(--color-muted-foreground)]">
              You&apos;ve trained yourself to ignore them. A call is different - it interrupts, it demands, it gets
              answered.
            </p>
          </div>
          <div>
            <h3 className="mono-label mb-1 text-[color:var(--color-primary)]">timing is everything</h3>
            <p className="text-sm text-[color:var(--color-muted-foreground)]">
              When a scheduled or manual check finds a cleared rate limit, a call can surface the next action without
              waiting for another dashboard visit.
            </p>
          </div>
          <div>
            <h3 className="mono-label mb-1 text-[color:var(--color-primary)]">act when the check finds it</h3>
            <p className="text-sm text-[color:var(--color-muted-foreground)]">
              The call tells you exactly what cleared and what&apos;s next, so you can act when you hear it
              instead of digging through a dashboard first.
            </p>
          </div>
        </div>
      </section>

      <AgentPattern />

      <section aria-labelledby="faq-heading" className="mt-14 border-t border-[color:var(--color-border)] pt-10">
        <h2 id="faq-heading" className="mono-data mb-6 text-center text-xl font-bold text-[color:var(--color-foreground)]">
          FAQ
        </h2>
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          <div>
            <h3 className="mono-label mb-1 text-[color:var(--color-foreground)]">is this just a timer?</h3>
            <p className="text-sm text-[color:var(--color-muted-foreground)]">
              No. A timer tells you when time&apos;s up if you&apos;re looking at it. Cooldown Caller calls you when
              a check finds the window open, so you act even if you&apos;re away from your screen.
            </p>
          </div>
          <div>
            <h3 className="mono-label mb-1 text-[color:var(--color-foreground)]">does it work with any platform?</h3>
            <p className="text-sm text-[color:var(--color-muted-foreground)]">
              Yes. The &quot;popular cooldowns&quot; above ship starting defaults for a few common cases, but any
              rate-limited action can be tracked - compliance deadlines, content reviews, audit prep, anything with
              a recurring cooldown.
            </p>
          </div>
          <div>
            <h3 className="mono-label mb-1 text-[color:var(--color-foreground)]">can I try it without signing up?</h3>
            <p className="text-sm text-[color:var(--color-muted-foreground)]">
              Yes. Click &quot;ring the demo line&quot; to request a demo call to the project&apos;s fixed authorized
              destination, or add a tracked item and run a manual check once it is ready. No account is required.
            </p>
          </div>
        </div>
      </section>

      <FinalCta />

      <footer className="mt-10 border-t border-[color:var(--color-border)] pt-6 text-xs text-[color:var(--color-muted-foreground)]">
        <p className="mono-label mb-2 text-[color:var(--color-foreground)]">
          Cooldown Caller - you set the cooldown. We make the call.
        </p>
        <p className="mb-3">Built for people who juggle rate limits, repost windows, and recurring deadlines across platforms.</p>
        Tracked items are database-backed rows you can add or update above. Seed items are labeled examples and are
        not synchronized with third-party APIs. The public activity view exposes operational status only; destination,
        provider identifiers, prompts, summaries, and conversation content remain server-side. Calls can only target
        the project&apos;s fixed authorized destination.
        Built for the{" "}
        <a
          href="https://call-e.devpost.com/"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted underline-offset-4"
        >
          CALL-E: Your Code Is Calling
        </a>{" "}
        hackathon.
      </footer>
    </main>
  );
}
