import Image from "next/image";

/**
 * Marketing hero, added above the live Dashboard. Sourced from a Wix Aria
 * design concept generated for this product (radar / flight-recorder
 * aesthetic) - the exact colors already matched this codebase's existing
 * "Obsidian Mission Control" tokens almost exactly (Wix independently
 * converged on #00FFFF vs. this app's #00f0ff), so nothing was ported;
 * only the real photo asset and the "system logic" readout concept were
 * worth taking. See proven_path_wix_ai_frontend_mirror.md.
 */

const READOUTS = [
  { label: "AGENT_STATE", value: "DISCOVERY" },
  { label: "COMMS_PROTOCOL", value: "SINGLE DESTINATION" },
  { label: "SECURITY", value: "FAIL-CLOSED VERIFICATION" },
  { label: "SENSITIVE_DATA", value: "NEVER LEAVES SERVER" },
] as const;

function WaveformMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="2" y="9" width="2" height="6" rx="1" fill="currentColor" />
      <rect x="6" y="5" width="2" height="14" rx="1" fill="currentColor" />
      <rect x="10" y="2" width="2" height="20" rx="1" fill="currentColor" />
      <rect x="14" y="6" width="2" height="12" rx="1" fill="currentColor" />
      <rect x="18" y="9" width="2" height="6" rx="1" fill="currentColor" />
      <rect x="21" y="10" width="1.5" height="4" rx="0.75" fill="currentColor" />
    </svg>
  );
}

export default function MarketingHero() {
  return (
    <section className="relative overflow-hidden border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]">
      <div className="absolute inset-0" aria-hidden="true">
        <Image
          src="/hero-control-room.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-45"
        />
        <div className="absolute inset-0 bg-[color:var(--color-background)]/70" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, color-mix(in oklab, var(--color-background) 20%, transparent) 0%, var(--color-background) 92%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-5xl px-5 sm:px-8">
        <nav className="flex h-16 items-center justify-between">
          <span className="inline-flex items-center gap-2">
            <WaveformMark className="h-5 w-5 text-[color:var(--color-primary)]" />
            <span className="mono-label text-[color:var(--color-foreground)]">Cooldown Caller</span>
          </span>
          <a
            href="#dashboard"
            className="mono-label rounded-sm border border-[color:var(--color-border-strong)] px-3 py-1.5 text-[color:var(--color-muted-foreground)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
          >
            open dashboard
          </a>
        </nav>

        <div className="flex flex-col items-center gap-6 py-16 text-center sm:py-24">
          <p className="mono-label inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border-strong)] px-3 py-1 text-[color:var(--color-primary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-primary)] pulse-live" />
            discovery-based, not continuous monitoring
          </p>

          <h1 className="max-w-2xl font-sans text-4xl font-bold leading-[1.05] tracking-tight text-[color:var(--color-foreground)] sm:text-5xl">
            Stop refreshing the page. Let it phone you instead.
          </h1>

          <p className="max-w-xl text-sm leading-relaxed text-[color:var(--color-muted-foreground)] sm:text-base">
            An agent that watches recurring-action cooldowns and phones one pre-authorized number the
            instant an authorized check discovers one has cleared. Nothing sensitive leaves the
            server, and the whole system fails closed if anything can&apos;t be verified.
          </p>

          <a
            href="#dashboard"
            className="mono-label rounded-sm bg-[color:var(--color-primary)] px-6 py-3 text-[color:var(--color-primary-foreground)] transition-opacity hover:opacity-90"
          >
            see it watching now
          </a>
        </div>

        <div className="grid gap-px overflow-hidden rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-border)] pb-8 sm:grid-cols-2 sm:pb-16 lg:grid-cols-4">
          {READOUTS.map(({ label, value }) => (
            <div key={label} className="instrument-card border-0 bg-[color:var(--color-card)] p-5">
              <p className="mono-label text-[color:var(--color-muted-foreground)]">{label}</p>
              <p className="mono-data mt-1.5 text-sm font-semibold text-[color:var(--color-primary)]">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
