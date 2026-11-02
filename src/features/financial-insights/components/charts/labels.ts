/** A month label that fits its slot: "Nov 2025" when there is room, otherwise "Nov", with the year kept on the first bar and on each January. */
export function tickLabel(label: string, index: number, slot: number): string {
  if (slot >= 66) return label;
  const [month, year] = label.split(" ");
  if (!year) return label;
  return index === 0 || month === "Jan" ? `${month} ${year.slice(-2)}` : month;
}
