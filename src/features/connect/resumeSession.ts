import { useConnectionStore } from "@/store/connection";
import { buildInstanceFromRevealed, ensureConnectionReady } from "./reconnectFromVault";
import type { SessionBudget, SessionRecord } from "./sessionRecord";
import { revealServerSecret } from "./vaultApi";

async function rebuild(budget: SessionBudget) {
  const revealed = await revealServerSecret(budget.fingerprint, budget.budgetSyncId);
  return buildInstanceFromRevealed(revealed, budget.budgetSyncId, budget.label);
}

/**
 * Bring back a tab's budgets after a refresh or a new sign-in, from the
 * saved-connections vault. The active one is reopened and checked first, and
 * becomes active; this throws if it can't be (not saved, server down), and the
 * caller falls back to the connect page. The others then rejoin the switcher
 * in the background without being opened: a Direct budget opens when it is
 * next used, and one that can no longer be revealed is left out.
 */
export async function resumeSession(record: SessionRecord): Promise<void> {
  const active = await rebuild(record.active);
  await ensureConnectionReady(active);
  const store = useConnectionStore.getState();
  store.addInstance(active);
  store.setActiveInstance(active.id);

  void Promise.allSettled(
    record.others.map(async (budget) => useConnectionStore.getState().addInstance(await rebuild(budget)))
  );
}
