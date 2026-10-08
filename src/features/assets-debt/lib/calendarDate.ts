/** Financial dates use the user's local calendar; audit timestamps remain UTC instants. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
/** Clamp Feb 29 when moving into a non-leap year. */
export function previousYear(iso: string): string {
  const year = Number(iso.slice(0, 4)) - 1;
  const month = Number(iso.slice(5, 7));
  const day = Math.min(Number(iso.slice(8, 10)), new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
