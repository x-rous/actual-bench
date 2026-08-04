import type { SpendingBar, SpendingTier } from "../../lib/spendingBar";

/** Tailwind classes for the green/amber base fill by tier (RD-065). */
const BAR_FILL_CLASS: Record<Exclude<SpendingTier, "none">, string> = {
  under: "bg-emerald-500/70 dark:bg-emerald-400/60",
  near: "bg-amber-500/80",
  over: "bg-amber-500/80",
  // Distinct from `over` (amber + red overflow): a solid muted red means money
  // left an envelope/group that was never funded.
  unbudgeted: "bg-red-500/45",
};

/**
 * The spent-vs-budget bar (RD-065), shared by category cells and group-total
 * cells. Renders a 3px track pinned to the host cell's bottom edge; the host
 * must be `relative`. Decorative only — the text signal lives in the host's
 * aria-label / tooltip, so nothing is conveyed by colour alone.
 */
export function SpendingBarView({ bar }: { bar: SpendingBar }) {
  if (bar.tier === "none") return null;
  return (
    <span
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-foreground/5"
      aria-hidden="true"
    >
      <span
        className={`absolute bottom-0 left-0 h-full ${BAR_FILL_CLASS[bar.tier]}`}
        style={{ width: `${bar.fill * 100}%` }}
      />
      {bar.overflow > 0 && (
        <span
          className="absolute bottom-0 right-0 h-full bg-red-500"
          style={{ width: `${bar.overflow * 100}%` }}
        />
      )}
    </span>
  );
}
