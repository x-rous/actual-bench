import { normalizeName } from "@/lib/sync/normalize";
import { emptyFlowForm, type SyncEndpointForm, type SyncFlowFormState } from "./flowForm";

/**
 * The flows one foreign-currency budget needs: payees and categories from the
 * main budget to the foreign one, and each foreign account's transactions back
 * with conversion. All start manual, so the first run is always a preview.
 */

export type SetupBudget = { connectionId: string; budgetSyncId: string; budgetName: string };
export type SetupAccount = { id: string; name: string };
export type SetupAccountPair = { source: SetupAccount; target: SetupAccount };

/** Pair each open foreign account with the main-budget account of the same name. */
export function matchAccountsByName(sourceAccounts: SetupAccount[], targetAccounts: SetupAccount[]): Map<string, string> {
  const targetByName = new Map<string, string>();
  for (const account of targetAccounts) {
    const key = normalizeName(account.name);
    if (key && !targetByName.has(key)) targetByName.set(key, account.id);
  }
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const account of sourceAccounts) {
    const match = targetByName.get(normalizeName(account.name));
    if (match && !used.has(match)) {
      out.set(account.id, match);
      used.add(match);
    }
  }
  return out;
}

const endpoint = (budget: SetupBudget, account?: SetupAccount): SyncEndpointForm => ({
  connectionId: budget.connectionId,
  budgetSyncId: budget.budgetSyncId,
  budgetName: budget.budgetName,
  accountId: account?.id ?? "",
  accountName: account?.name ?? "",
});

export function buildCurrencySetupForms(input: {
  main: SetupBudget;
  foreign: SetupBudget;
  foreignCurrency: string;
  mainCurrency: string;
  pairs: SetupAccountPair[];
}): SyncFlowFormState[] {
  const foreignCurrency = input.foreignCurrency.trim().toUpperCase();
  const mainCurrency = input.mainCurrency.trim().toUpperCase();

  const payees = emptyFlowForm();
  payees.flowType = "payee_sync";
  payees.name = `${foreignCurrency} payees (${input.main.budgetName} → ${input.foreign.budgetName})`;
  payees.source = endpoint(input.main);
  payees.target = endpoint(input.foreign);

  const categories = emptyFlowForm();
  categories.flowType = "category_sync";
  categories.name = `${foreignCurrency} categories (${input.main.budgetName} → ${input.foreign.budgetName})`;
  categories.source = endpoint(input.main);
  categories.target = endpoint(input.foreign);
  categories.entity.createMissingGroup = true;

  const transactions = input.pairs.map(({ source, target }) => {
    const form = emptyFlowForm();
    form.name = `${source.name}: ${foreignCurrency} → ${mainCurrency}`;
    form.source = endpoint(input.foreign, source);
    form.target = endpoint(input.main, target);
    form.transform.amountDirection = "same";
    form.transform.fxEnabled = true;
    form.transform.fxSourceCurrency = foreignCurrency;
    form.transform.fxTargetCurrency = mainCurrency;
    form.automation.updateMappedTargets = true;
    form.automation.detectDeletedSource = true;
    form.automation.createTargetSplits = true;
    return form;
  });

  return [payees, categories, ...transactions];
}
