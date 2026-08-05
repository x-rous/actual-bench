import type { SpendingBar, SpendingTier } from "../../lib/spendingBar";

// Fill classes by tier (RD-065). Kept deliberately low-opacity so a full column
// of bars reads as a soft glance rather than a wall of saturated colour.
//
// The red tiers use the semantic `destructive` token. There is no semantic
// success/warning token in the theme (only `destructive`), and raw emerald/amber
// is the established convention across the budget grid (staged/carryover
// indicators), so under/near stay on the raw palette here.
const BAR_FILL_CLASS: Record<SpendingTier, string> = {
  // `empty` has zero fill width, so its colour never actually paints — it just
  // shows the neutral gray track (below) for a consistent, calm grid.
  empty: "bg-transparent",
  under: "bg-emerald-500/40 dark:bg-emerald-400/35",
  near: "bg-amber-500/50 dark:bg-amber-500/45",
  over: "bg-amber-500/50 dark:bg-amber-500/45",
  // Distinct from `over` (amber + red overflow): a muted red means money left an
  // envelope/group that was never funded.
  unbudgeted: "bg-destructive/25",
};

/**
 * The spent-vs-budget bar (RD-065), shared by category cells and group-total
 * cells. Renders a 3px track pinned to the host cell's bottom edge; the host
 * must be `relative`. Decorative only — the text signal lives in the host's
 * aria-label / tooltip, so nothing is conveyed by colour alone.
 */
export function SpendingBarView({ bar }: { bar: SpendingBar }) {
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
          className="absolute bottom-0 right-0 h-full bg-destructive/55"
          style={{ width: `${bar.overflow * 100}%` }}
        />
      )}
    </span>
  );
}
