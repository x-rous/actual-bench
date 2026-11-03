import { percentChange } from "@/lib/financial-insights/compare";
import { percent } from "../format";

const GREEN = "text-green-700 dark:text-green-400";
const RED = "text-red-700 dark:text-red-400";

/**
 * How a figure moved against the same figure for the stretch before the period: an arrow, the change and what it was set against.
 * `good` says which way is the better one (more money received is, more spent is not), so the colour is a judgement only where
 * there is one; nothing is shown when there was nothing to compare with.
 */
export function Delta({ now, before, label, good, points = false }: { now: number; before: number; label: string; good: "up" | "down"; /** Both figures are percentages: show the difference in points. */ points?: boolean }) {
  const change = points ? Math.round((now - before) * 10) / 10 : percentChange(now, before);
  if (change === null) return null;
  if (change === 0) return <span className="block text-muted-foreground">No change vs {label}</span>;
  const better = (change > 0) === (good === "up");
  const text = points ? `${Math.abs(change).toFixed(1)} pts` : percent(Math.abs(change));
  return <span className={`block ${better ? GREEN : RED}`}>{change > 0 ? "▲" : "▼"} {text} <span className="text-muted-foreground">vs {label}</span></span>;
}
