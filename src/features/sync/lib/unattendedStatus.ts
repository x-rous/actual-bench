/**
 * Pure, shared logic for the unattended-sync status shown on the flow list and
 * in the flow editor (RD-058 follow-up). Answers two operator questions: is this
 * flow actually armed to run unattended, and when is its next run? Kept pure so
 * both surfaces render identical decisions and it is trivially testable.
 */

/** Interval floor - mirrors the scheduler's MIN_UNATTENDED_INTERVAL_MINUTES. */
export const MIN_UNATTENDED_INTERVAL_MINUTES = 15;

export type UnattendedStatusInput = {
  reviewPolicy: string;
  flowEnabled: boolean;
  autoPaused: boolean;
  vaultEnabled: boolean;
  /** Both source and target are HTTP API connections. */
  bothHttp: boolean;
  /** Both budgets' credentials are stored in the server vault. */
  bothEnrolled: boolean;
  lastRunAtMs: number | null;
  intervalMinutes: number;
  nowMs: number;
};

export type UnattendedStatus = {
  /** True only for `auto_sync_unattended` flows; false hides the status UI. */
  isUnattended: boolean;
  paused: boolean;
  armed: boolean;
  /** Why it will not run, or null when armed / not unattended. */
  reason: string | null;
  /** Next run time (ms), or null meaning "on the next check" (never run/overdue). */
  nextRunAtMs: number | null;
};

function nextRunAt(lastRunAtMs: number | null, intervalMinutes: number, nowMs: number): number | null {
  if (lastRunAtMs == null) return null; // never run → runs on the next check
  const intervalMs = Math.max(MIN_UNATTENDED_INTERVAL_MINUTES, intervalMinutes) * 60_000;
  const at = lastRunAtMs + intervalMs;
  return at <= nowMs ? null : at; // overdue → runs on the next check
}

export function computeUnattendedStatus(i: UnattendedStatusInput): UnattendedStatus {
  if (i.reviewPolicy !== "auto_sync_unattended") {
    return { isUnattended: false, paused: false, armed: false, reason: null, nextRunAtMs: null };
  }
  const paused = i.autoPaused || !i.flowEnabled;
  let reason: string | null = null;
  if (paused) reason = "Paused — re-enable the flow to resume";
  else if (!i.vaultEnabled) reason = "Server vault not configured (set SYNC_VAULT_KEY)";
  else if (!i.bothHttp) reason = "Both source and target must be HTTP API connections";
  else if (!i.bothEnrolled) reason = "Store credentials to arm unattended sync";

  const armed = reason === null;
  return {
    isUnattended: true,
    paused,
    armed,
    reason,
    nextRunAtMs: armed ? nextRunAt(i.lastRunAtMs, i.intervalMinutes, i.nowMs) : null,
  };
}

/** Short relative phrase for the next run: null atMs → "the next check". */
export function nextRunPhrase(status: UnattendedStatus, nowMs: number): string {
  if (!status.armed) return status.reason ?? "";
  if (status.nextRunAtMs == null) return "Runs on the next check (~1 min)";
  const mins = Math.max(1, Math.round((status.nextRunAtMs - nowMs) / 60_000));
  return mins < 60 ? `Next run in ~${mins} min` : `Next run in ~${Math.round(mins / 60)} h`;
}
