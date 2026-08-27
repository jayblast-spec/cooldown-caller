const USE_CASES = [
  {
    useCase: "Compliance deadlines",
    pattern: "Watch regulatory filing dates - verify the requirement still applies - call when 48 hours remain.",
    payoff: "No dashboard checking. No missed filings.",
  },
  {
    useCase: "Content publishing windows",
    pattern: "Watch a platform's own posting-cadence limits - verify the window is real - call when it opens.",
    payoff: "Posts go out when the window is actually open, not when you remember.",
  },
  {
    useCase: "API rate-limit recovery",
    pattern: "Watch for a 429 - verify the quota has actually reset - call the moment a retry is safe.",
    payoff: "You find out the integration can retry without polling for it.",
  },
  {
    useCase: "Position/margin thresholds",
    pattern: "Watch a ratio or price feed - verify against a second source - call before a threshold is crossed.",
    payoff: "You hear about it before it becomes urgent, not after.",
  },
  {
    useCase: "Rolling application deadlines",
    pattern: "Watch a rolling-admissions or first-come slot - verify a new one opened - call with the window.",
    payoff: "You don't have to keep the tab open to catch it.",
  },
] as const;

const UPGRADE_LAYER = [
  { current: "You set the cooldown manually.", next: "An LLM reads the platform's own docs and suggests a cooldown." },
  { current: "One fixed phone number.", next: "Dynamic routing - call you, then escalate to a team." },
  { current: "A simple ready/not-ready check.", next: "A reasoning step reviews the opportunity and briefs you on the call." },
  { current: "You track a handful of items by hand.", next: "The agent proposes new trackable items from a calendar or inbox." },
  { current: "Fail-closed on error - no call.", next: "Fail-closed, plus retry-with-backoff and a diagnostic left for you." },
] as const;

export default function AgentPattern() {
  return (
    <>
      <section aria-labelledby="pattern-heading" className="mt-14 border-t border-[color:var(--color-border)] pt-10">
        <p className="mono-label mb-2 text-center text-[color:var(--color-primary)]">beyond the demo</p>
        <h2 id="pattern-heading" className="mono-data mb-3 text-center text-xl font-bold text-[color:var(--color-foreground)]">
          The agent pattern, not just this product
        </h2>
        <p className="mx-auto mb-8 max-w-2xl text-center text-sm text-[color:var(--color-muted-foreground)]">
          What&apos;s running here is the simplest, most focused version of this idea - one cooldown, one call, one
          purpose. The underlying shape - watch, verify, alert, fail closed - covers more ground than a cooldown
          timer.
        </p>
        <div className="instrument-bay grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {USE_CASES.map(({ useCase, pattern, payoff }) => (
            <div key={useCase} className="instrument-card instrument-card-hover p-5">
              <h3 className="mono-label mb-2 text-[color:var(--color-primary)]">{useCase}</h3>
              <p className="text-sm text-[color:var(--color-muted-foreground)]">{pattern}</p>
              <p className="mono-label mt-3 text-[color:var(--color-foreground)]">{payoff}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="upgrade-heading" className="mt-14 border-t border-[color:var(--color-border)] pt-10">
        <p className="mono-label mb-2 text-center text-[color:var(--color-primary)]">not yet built</p>
        <h2 id="upgrade-heading" className="mono-data mb-3 text-center text-xl font-bold text-[color:var(--color-foreground)]">
          The AI-augmented version of this same pattern
        </h2>
        <p className="mx-auto mb-8 max-w-2xl text-center text-sm text-[color:var(--color-muted-foreground)]">
          This demo runs on manual checks and fixed cooldowns, on purpose - it&apos;s deliberately narrow. Here&apos;s
          the direction the same watch/verify/alert/fail-closed shape could grow in, none of it shipped yet.
        </p>
        <div className="overflow-hidden rounded-md border border-[color:var(--color-border)]">
          {UPGRADE_LAYER.map(({ current, next }, i) => (
            <div
              key={current}
              className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 ${i > 0 ? "border-t border-[color:var(--color-border)]" : ""}`}
            >
              <p className="text-sm text-[color:var(--color-muted-foreground)]">
                <span className="mono-label mr-2 text-[color:var(--color-muted-foreground)]">now</span>
                {current}
              </p>
              <p className="text-sm text-[color:var(--color-foreground)]">
                <span className="mono-label mr-2 text-[color:var(--color-primary)]">next</span>
                {next}
              </p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
