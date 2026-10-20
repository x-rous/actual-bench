import {
  applyChangeSet,
  CreditCardConflictError,
  CreditCardRuleError,
  type ChangeSet,
} from "@/lib/credit-cards/changes";
import { EMPTY_WORKSPACE, type Workspace } from "../models";

/** Where credit-card metadata is kept. The browser uses the app-DB API; tests use memory. */
export type CreditCardPersistence = {
  /** The budget's metadata. Rejects when storage is unavailable, never returns an empty stand-in. */
  read: (budgetSyncId: string) => Workspace | Promise<Workspace>;
  /** Applies one guarded change set and returns the committed workspace. */
  commit: (budgetSyncId: string, changes: ChangeSet) => Workspace | Promise<Workspace>;
};

/** Storage is locked, unwritable or unreachable (HTTP 503 or a network failure). */
export class CreditCardUnavailableError extends Error {
  constructor(message = "Credit-card data unavailable. Retry when the app database is available.") {
    super(message);
    this.name = "CreditCardUnavailableError";
  }
}

/** In-memory persistence with the server's rules: tests and offline previews. Synchronous. */
export function memoryPersistence(initial: Record<string, Workspace> = {}): CreditCardPersistence {
  const budgets = new Map(Object.entries(initial));
  return {
    read: (budgetSyncId) => budgets.get(budgetSyncId) ?? EMPTY_WORKSPACE,
    commit: (budgetSyncId, changes) => {
      const next = applyChangeSet(budgets.get(budgetSyncId) ?? EMPTY_WORKSPACE, changes, budgetSyncId);
      budgets.set(budgetSyncId, next);
      return next;
    },
  };
}

type ErrorBody = { error?: string; code?: string };

async function failure(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as ErrorBody;
  if (response.status === 409) throw new CreditCardConflictError(body.error);
  if (response.status === 400) throw new CreditCardRuleError(body.error ?? "These values could not be saved");
  if (response.status === 503) throw new CreditCardUnavailableError();
  // Other failures are not fixed by retrying later: keep the server's message.
  throw new Error(body.error ?? `The app database returned an error (${response.status})`);
}

async function request(input: string, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch {
    throw new CreditCardUnavailableError();
  }
}

/** The app-DB API (`/api/credit-cards`). Bodies carry Actual ids and opaque hashes only. */
export const httpPersistence: CreditCardPersistence = {
  async read(budgetSyncId) {
    const response = await request(`/api/credit-cards?budgetSyncId=${encodeURIComponent(budgetSyncId)}`, { cache: "no-store" });
    if (!response.ok) return failure(response);
    return ((await response.json()) as { workspace: Workspace }).workspace;
  },
  async commit(budgetSyncId, changes) {
    const response = await request("/api/credit-cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ budgetSyncId, changes }),
    });
    if (!response.ok) return failure(response);
    return ((await response.json()) as { workspace: Workspace }).workspace;
  },
};
