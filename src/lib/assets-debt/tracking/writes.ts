/** A write still "applying" after this long was left by a closed page: its outcome is unknown. */
export const STALE_WRITE_MS = 10 * 60_000;

/** A write to Actual whose outcome nobody knows yet: it ended uncertain, or a closed page left it applying. */
export function isUnresolved(w: { status: string; startedAt: string }, now = Date.now()): boolean {
  return w.status === "uncertain" || (w.status === "applying" && now - Date.parse(w.startedAt) > STALE_WRITE_MS);
}
