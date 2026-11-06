/**
 * A thin outline in the card's colour behind a label's letters, so a figure stays readable where it sits over a bar or a line.
 * `paint-order: stroke` draws the outline first, under the fill.
 */
export const LABEL_HALO = { paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3, strokeLinejoin: "round" } as const;

/**
 * Vertical positions for labels that sit beside points which may be close together: sorted top to bottom, each pushed down
 * until it is `gap` clear of the one above, then back up if the last would pass `max`. Returns them in the order given.
 */
export function spreadLabels(ys: readonly number[], gap: number, min: number, max: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  let previous = min - gap;
  const placed = order.map((o) => (previous = Math.max(o.y, previous + gap)));
  let next = max + gap;
  for (let k = placed.length - 1; k >= 0; k--) placed[k] = next = Math.min(placed[k], next - gap);
  const result: number[] = [];
  order.forEach((o, k) => { result[o.i] = placed[k]; });
  return result;
}

/** A month label that fits its slot: "Nov 2025" when there is room, otherwise "Nov", with the year kept on the first bar and on each January. */
export function tickLabel(label: string, index: number, slot: number): string {
  if (slot >= 66) return label;
  const [month, year] = label.split(" ");
  if (!year) return label;
  return index === 0 || month === "Jan" || month === "Q1" ? `${month} ${year.slice(-2)}` : month;
}
