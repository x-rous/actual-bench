import { percentChange } from "@/lib/financial-insights/compare";
import { percent } from "../format";

const GREEN = "text-green-700 dark:text-green-400";
const RED = "text-red-700 dark:text-red-400";

/**
 * How a figure moved against the same figure for the stretch before the period: an arrow and the change, set at the right of the figure, over two lines.
 * What it was set against is on hover (and read out), so the same words are not repeated on every figure.
 * `good` says which way is the better one (more money received is, more spent is not), so the colour is a judgement only where
 * there is one; nothing is shown when there was nothing to compare with.
 */
export function Delta({ now, before, label, good, points = false }: { now: number; before: number; label: string; good: "up" | "down"; /** Both figures are percentages: show the difference in points. */ points?: boolean }) {
  const change = points ? Math.round((now - before) * 10) / 10 : percentChange(now, before);
  if (change === null) return null;
  const full = `vs ${label}`;
  if (change === 0) return <span className="block cursor-help whitespace-nowrap text-right text-xs font-normal leading-tight text-muted-foreground" title={full} aria-label={`No change ${full}`}>No change{" "}<span className="block">vs previous</span></span>;
  const better = (change > 0) === (good === "up");
  const text = points ? `${Math.abs(change).toFixed(1)} pts` : percent(Math.abs(change));
  return <span className={`block cursor-help whitespace-nowrap text-right text-xs font-normal leading-tight ${better ? GREEN : RED}`} title={full} aria-label={`${change > 0 ? "Up" : "Down"} ${text} ${full}`}>{change > 0 ? "▲" : "▼"} {text}{" "}<span className="block text-muted-foreground">vs previous</span></span>;
}
