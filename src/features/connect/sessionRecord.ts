import type { ConnectionInstance } from "@/store/connection";
import { serverFingerprint } from "@/lib/sync/connectionRef";

/**
 * Which budgets this tab had connected, and which one was active, so a
 * refresh can bring them back from the saved-connections vault instead of
 * starting over (the connection store itself is memory-only). Never holds a
 * secret: a server fingerprint, a sync id and a name per budget.
 */

export type SessionBudget = { fingerprint: string; budgetSyncId: string; label: string };
export type SessionRecord = { active: SessionBudget; others: SessionBudget[] };

const STORAGE_KEY = "actual-admin-last-active-ref";

function isBudget(value: unknown): value is SessionBudget {
  const v = value as Partial<SessionBudget> | null;
  return !!v && typeof v.fingerprint === "string" && typeof v.budgetSyncId === "string" && typeof v.label === "string";
}

function toBudget(instance: ConnectionInstance): SessionBudget {
  return { fingerprint: serverFingerprint(instance), budgetSyncId: instance.budgetSyncId, label: instance.label };
}

export function recordOf(active: ConnectionInstance, instances: ConnectionInstance[]): SessionRecord {
  return { active: toBudget(active), others: instances.filter((i) => i.id !== active.id).map(toBudget) };
}

export function getSessionRecord(): SessionRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    // A tab from before other budgets were kept holds just the active one.
    if (isBudget(parsed)) return { active: parsed, others: [] };
    const record = parsed as Partial<SessionRecord> | null;
    if (!record || !isBudget(record.active)) return null;
    return { active: record.active, others: Array.isArray(record.others) ? record.others.filter(isBudget) : [] };
  } catch {
    return null;
  }
}

export function setSessionRecord(record: SessionRecord): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable (private mode, quota): a refresh just won't resume.
  }
}

/** After a disconnect or sign-out, so a later refresh doesn't bring budgets back. */
export function clearSessionRecord(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: at worst a stale record fails to resolve next time.
  }
}
