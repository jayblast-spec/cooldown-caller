"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SEEN_KEY = "cc_tour_seen";
const REPLAY_EVENT = "cc:tour:replay";

type Step = {
  target: string;
  title: string;
  body: string;
  placement?: "top" | "bottom";
};

const STEPS: Step[] = [
  {
    target: "watch",
    title: "It watches. It doesn't nag.",
    body: "This agent isn't a dashboard you have to remember to check. A scheduled or manual check evaluates every tracked cooldown and only acts the moment one clears.",
    placement: "bottom",
  },
  {
    target: "run-check",
    title: "Trigger a real check, on demand",
    body: "This runs the same evaluation the daily cron runs - not a simulation. If something's ready, it calls.",
    placement: "bottom",
  },
  {
    target: "tracked-items",
    title: "Track your own cooldown",
    body: "Pick a popular preset or add your own recurring, rate-limited action - a publish cap, a listing that expires, anything gated by a timer.",
    placement: "top",
  },
  {
    target: "call-log",
    title: "Every real call, logged",
    body: "Each entry here is a real CALL-E call_id with its real status and transcript - not a mock. Idempotency keys mean a re-run can never double-call.",
    placement: "top",
  },
  {
    target: "ring-demo",
    title: "Hear it work, right now",
    body: "This places one real, rate-limited outbound call on demand - the fastest way to see the whole pipeline fire end to end.",
    placement: "bottom",
  },
];

type Phase = "idle" | "slate" | "tour";

export function OnboardingTour() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    // Reads matchMedia (an external system) on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      seen = false;
    }
    if (!seen) {
      setPhase("slate");
    }

    const onReplay = () => {
      setStepIndex(0);
      setPhase("slate");
    };
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, []);

  const finish = useCallback(() => {
    setPhase("idle");
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // localStorage unavailable - tour just won't remember
    }
  }, []);

  const startTour = useCallback(() => {
    setStepIndex(0);
    setPhase("tour");
  }, []);

  useEffect(() => {
    if (phase !== "tour") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, finish]);

  if (phase === "idle") return null;

  if (phase === "slate") {
    return <TourSlate reducedMotion={reducedMotion} onDone={startTour} onSkip={finish} />;
  }

  return (
    <Spotlight
      step={STEPS[stepIndex]}
      index={stepIndex}
      total={STEPS.length}
      onNext={() => (stepIndex + 1 < STEPS.length ? setStepIndex((i) => i + 1) : finish())}
      onBack={() => setStepIndex((i) => Math.max(0, i - 1))}
      onSkip={finish}
    />
  );
}

export function TourReplayButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(REPLAY_EVENT))}
      className={`mono-label rounded-sm border border-[color:var(--color-border-strong)] px-3 py-1.5 text-[color:var(--color-muted-foreground)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)] ${className ?? ""}`}
    >
      replay walkthrough
    </button>
  );
}

function TourSlate({
  reducedMotion,
  onDone,
  onSkip,
}: {
  reducedMotion: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [linkState, setLinkState] = useState<"dialing" | "connected">("dialing");

  useEffect(() => {
    if (reducedMotion) {
      const t = setTimeout(onDone, 400);
      return () => clearTimeout(t);
    }
    const connect = setTimeout(() => setLinkState("connected"), 1000);
    const done = setTimeout(onDone, 2100);
    return () => {
      clearTimeout(connect);
      clearTimeout(done);
    };
  }, [reducedMotion, onDone]);

  return (
    <div
      role="dialog"
      aria-label="Cooldown Caller introduction"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[color:var(--color-background)]"
    >
      <button
        type="button"
        onClick={onSkip}
        className="mono-label absolute top-5 right-5 rounded-sm border border-[color:var(--color-border-strong)] px-3 py-2 text-[color:var(--color-muted-foreground)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
      >
        skip →
      </button>

      <div className="flex flex-col items-center gap-6 px-6 text-center">
        <div className="relative flex h-24 w-24 items-center justify-center" aria-hidden="true">
          {!reducedMotion && (
            <>
              <span className="watch-rings" />
              <span className="watch-rings" style={{ animationDelay: "0.9s" }} />
            </>
          )}
          <span
            className={`relative flex h-16 w-16 items-center justify-center rounded-full border-2 bg-[color:var(--color-card)] transition-colors duration-300 ${
              linkState === "connected"
                ? "glow-primary border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-[color:var(--color-border-strong)] text-[color:var(--color-muted-foreground)]"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-7 w-7">
              <path
                d="M4 4c1.5 5 4.5 8 6 6 .8-1.1 1.6-1.4 2.6-.7 1.2.9 2.3 1.9 3.1 3.1.7 1 .4 1.8-.7 2.6-2 1.5.9 4.9 6 6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>

        <p className="mono-label text-[color:var(--color-primary)]">
          {linkState === "dialing" ? "establishing link…" : "link connected"}
        </p>

        <p className="mono-data max-w-sm text-2xl font-bold tracking-tight text-[color:var(--color-foreground)] sm:text-3xl">
          {linkState === "dialing" ? "Dialing Cooldown Caller…" : "You're through."}
        </p>
      </div>
    </div>
  );
}

function Spotlight({
  step,
  index,
  total,
  onNext,
  onBack,
  onSkip,
}: {
  step: Step;
  index: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) {
      // Reads the DOM (an external system) for the current step's target.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });

    const update = () => setRect(el.getBoundingClientRect());
    const t = setTimeout(update, 260);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step.target]);

  const pad = 10;
  const hole = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  const placement = step.placement ?? "bottom";
  const cardTop = hole
    ? placement === "bottom"
      ? Math.min(hole.top + hole.height + 16, window.innerHeight - 220)
      : Math.max(hole.top - 16, 16)
    : window.innerHeight / 2 - 90;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-label={step.title}>
      {hole ? (
        <div
          className="absolute rounded-md transition-all duration-300"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            boxShadow: "0 0 0 9999px rgba(5,5,5,0.85)",
            border: "1px solid var(--color-primary)",
          }}
        />
      ) : (
        <div className="absolute inset-0" style={{ background: "rgba(5,5,5,0.85)" }} />
      )}

      <button
        type="button"
        onClick={onSkip}
        className="mono-label absolute top-5 right-5 rounded-sm border border-[color:var(--color-border-strong)] bg-[color:var(--color-card)] px-3 py-2 text-[color:var(--color-muted-foreground)] backdrop-blur-md transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
      >
        skip →
      </button>

      <div
        ref={cardRef}
        className="instrument-card absolute w-[calc(100vw-2.5rem)] max-w-sm rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-card)] p-5 transition-[top,left] duration-300"
        style={{
          top: cardTop,
          left: hole ? Math.min(Math.max(hole.left, 20), window.innerWidth - 380) : window.innerWidth / 2 - 180,
        }}
      >
        <p className="mono-label text-[color:var(--color-primary)]">
          step {index + 1} / {total}
        </p>
        <h3 className="mono-data mt-2 text-lg font-bold text-[color:var(--color-foreground)]">{step.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-[color:var(--color-muted-foreground)]">{step.body}</p>

        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden="true">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-full transition-colors"
                style={{
                  backgroundColor:
                    i === index ? "var(--color-primary)" : "var(--color-border-strong)",
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={onBack}
                className="mono-label rounded-sm border border-[color:var(--color-border-strong)] px-3 py-1.5 text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
              >
                back
              </button>
            )}
            <button
              type="button"
              onClick={onNext}
              className="mono-label rounded-sm bg-[color:var(--color-primary)] px-3.5 py-1.5 text-[color:var(--color-primary-foreground)] transition-opacity hover:opacity-90"
            >
              {index + 1 === total ? "done" : "next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
