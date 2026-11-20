/**
 * "Rent (copy)", then "Rent (copy 2)" and so on: the first name no other
 * schedule uses, ignoring case. Actual rejects two schedules with one name.
 */
export function uniqueCopyName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  const base = `${name.trim()} (copy`;
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base})` : `${base} ${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
