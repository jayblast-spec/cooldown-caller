export default function FinalCta() {
  return (
    <section
      aria-labelledby="final-cta-heading"
      className="instrument-card glow-primary mt-14 flex flex-col items-center gap-3 border border-[color:var(--color-primary)]/40 p-8 text-center"
    >
      <p className="mono-label text-[color:var(--color-primary)]">this is just the beginning</p>
      <h2 id="final-cta-heading" className="mono-data text-xl font-bold text-[color:var(--color-foreground)]">
        See the code. Fork it. Make it yours.
      </h2>
      <p className="max-w-lg text-sm text-[color:var(--color-muted-foreground)]">
        The demo is live and the pattern is proven - what you build with it next is up to you.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <a
          href="https://github.com/jayblast-spec/cooldown-caller"
          target="_blank"
          rel="noreferrer"
          className="mono-label rounded-sm bg-[color:var(--color-primary)] px-5 py-2.5 text-[color:var(--color-primary-foreground)] transition-opacity hover:opacity-90"
        >
          clone the repo
        </a>
        <a
          href="https://github.com/jayblast-spec/cooldown-caller#readme"
          target="_blank"
          rel="noreferrer"
          className="mono-label rounded-sm border border-[color:var(--color-border-strong)] px-5 py-2.5 text-[color:var(--color-muted-foreground)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
        >
          read the README
        </a>
      </div>
    </section>
  );
}
