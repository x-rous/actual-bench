/**
 * Pure, shared logic for the unattended-sync status shown on the flow list and
 * in the flow editor (RD-058 follow-up). Answers two operator questions: is this
 * flow actually armed to run unattended, and when is its next run? Kept pure so
 * both surfaces render identical decisions and it is trivially testable.
 */

import { MIN_INTERVAL_MINUTES } from "@/lib/automation/schedule";

/**
 * Interval floor. The automation engine's own, not a copy: an unattended flow
 * is run by an automation, so a different floor here would only mean predicting
 * a next-run time the engine will not honour.
 */
export const MIN_UNATTENDED_INTERVAL_MINUTES = MIN_INTERVAL_MINUTES;

/**
 * A health pause the automation engine has applied to the automation running
 * this flow, or null when it has not paused it.
 *
 * This is read, never mirrored into the flow. The engine owns server-side
 * pausing; a flow-level copy would be a second source of truth that the "resume"
 * button on either page would then have to keep in step.
 */
export type EnginePause = {
  reason: string | null;
};

export type UnattendedStatusInput = {
  reviewPolicy: string;
  flowEnabled: boolean;
  autoPaused: boolean;
  /** The server vault can open stored credentials (not locked). */
  vaultReady: boolean;
  /** Both budgets' credentials are stored in the server vault. */
  bothEnrolled: boolean;
  /**
   * Set when the engine has health-paused this flow's automation. Without it
   * the Sync page read a health-paused flow as armed and healthy, quietly
   * showing a next-run time for a run that was never going to happen.
   */
  enginePause?: EnginePause | null;
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
  const paused = i.autoPaused || !i.flowEnabled || Boolean(i.enginePause);
  let reason: string | null = null;
  // An engine pause is reported first, and in the engine's own words: it is the
  // only kind of pause the Sync page cannot undo, so "re-enable the flow" would
  // be the wrong instruction as well as the wrong explanation.
  if (i.enginePause && i.flowEnabled && !i.autoPaused) {
    reason = i.enginePause.reason
      ? `Paused by automation: ${i.enginePause.reason}`
      : "Paused by automation - resume it on the Automations page";
  } else if (paused) reason = "Paused - re-enable the flow to resume";
  else if (!i.vaultReady) reason = "Stored credentials are locked - see App Health";
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

/**
 * Which budgets are enrolled, by connection and by budget (PR-071c). A budget's
 * sync ID is Actual's own identity for it, so a budget enrolled through HTTP
 * API counts as enrolled for a flow saved on its Direct connection, and the
 * other way round: a server run uses whichever enrolment exists.
 */
export type EnrolledIndex = {
  fingerprints: Set<string>;
  /** Each budget's enrolled connections, by sync ID - the flow's own or the other mode's. */
  byBudget: Map<string, string[]>;
};

export const NO_ENROLMENTS: EnrolledIndex = { fingerprints: new Set(), byBudget: new Map() };

export function enrolledIndex(credentials: ReadonlyArray<{ connectionFingerprint: string; budgetSyncId?: string }>): EnrolledIndex {
  const byBudget = new Map<string, string[]>();
  for (const { connectionFingerprint, budgetSyncId } of credentials) {
    if (budgetSyncId) byBudget.set(budgetSyncId, [...(byBudget.get(budgetSyncId) ?? []), connectionFingerprint]);
  }
  return { fingerprints: new Set(credentials.map((credential) => credential.connectionFingerprint)), byBudget };
}

export function isEnrolled(index: EnrolledIndex, fingerprint: string, budgetSyncId?: string): boolean {
  return index.fingerprints.has(fingerprint) || (!!budgetSyncId && index.byBudget.has(budgetSyncId));
}

/**
 * The enrolments that serve an endpoint: its own connection's, and any other
 * enrolment of the same budget (PR-071c), so withdrawing removes the one a run
 * would actually use.
 */
export function enrolmentsFor(index: EnrolledIndex, fingerprints: Array<string | undefined>, budgetSyncId?: string): string[] {
  const own = fingerprints.filter((fingerprint): fingerprint is string => !!fingerprint && index.fingerprints.has(fingerprint));
  return [...new Set([...own, ...(budgetSyncId ? (index.byBudget.get(budgetSyncId) ?? []) : [])])];
}
