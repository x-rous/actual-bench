import { normalizeName } from "./normalize";
import type { SyncFlowPlanConfig } from "./flowConfig";
import type { SyncSourceItem } from "./sourceItems";
import type { SyncPlannerCategory, SyncPlannerPayee } from "./plannedChanges";

/**
 * Match source payees/categories to target entities by normalized name
 * (RD-053 / PR-019). Source ids are meaningless in the target budget, so
 * matching is always name-based; the source id is never carried across.
 */

export type PayeeResolution = {
  /** Existing target payee id when matched, else null. */
  payeeId: string | null;
  /** Name to create on apply when no match and policy allows; else null. */
  payeeName: string | null;
  willCreateOnApply: boolean;
  /** True when the source had a payee name but we intentionally left it empty. */
  leftEmpty: boolean;
};

export type CategoryResolution = {
  categoryId: string | null;
  /** True when the source had a category name with no target match. */
  leftEmpty: boolean;
};

/** One index per entity list: a plan resolves every row against the same list. */
const nameIndexes = new WeakMap<object, Map<string, string>>();

function buildNameIndex(
  entities: { id: string; name: string }[]
): Map<string, string> {
  const cached = nameIndexes.get(entities);
  if (cached) return cached;
  const index = new Map<string, string>();
  for (const entity of entities) {
    const key = normalizeName(entity.name);
    // First match wins; keeps resolution deterministic on duplicate names.
    if (key && !index.has(key)) index.set(key, entity.id);
  }
  nameIndexes.set(entities, index);
  return index;
}

export function resolvePayee(
  item: Pick<SyncSourceItem, "payeeName">,
  config: Pick<SyncFlowPlanConfig, "missingPayee">,
  targetPayees: SyncPlannerPayee[]
): PayeeResolution {
  const normalized = normalizeName(item.payeeName);
  // No usable source payee → nothing to resolve, leave empty silently.
  if (!normalized) {
    return { payeeId: null, payeeName: null, willCreateOnApply: false, leftEmpty: false };
  }

  const match = buildNameIndex(targetPayees).get(normalized);
  if (match) {
    return { payeeId: match, payeeName: null, willCreateOnApply: false, leftEmpty: false };
  }

  if (config.missingPayee === "create") {
    // Carry the raw name so apply can create/resolve it.
    return {
      payeeId: null,
      payeeName: item.payeeName ?? null,
      willCreateOnApply: true,
      leftEmpty: false,
    };
  }

  return { payeeId: null, payeeName: null, willCreateOnApply: false, leftEmpty: true };
}

export function resolveCategory(
  item: Pick<SyncSourceItem, "categoryName">,
  targetCategories: SyncPlannerCategory[]
): CategoryResolution {
  const normalized = normalizeName(item.categoryName);
  // No source category → not a "missing" case, just empty.
  if (!normalized) return { categoryId: null, leftEmpty: false };

  const match = buildNameIndex(targetCategories).get(normalized);
  // MVP never auto-creates categories; unmatched stays empty and does not block.
  return match
    ? { categoryId: match, leftEmpty: false }
    : { categoryId: null, leftEmpty: true };
}

/**
 * How a budget without an account names a transfer to it: `Transfer: AED Current`.
 * The payee sync gives a source transfer payee this name, and a transaction with
 * it syncs back as a real transfer to that account.
 */
export const TRANSFER_PAYEE_PREFIX = "Transfer: ";

export function transferPayeeName(accountName: string): string {
  return `${TRANSFER_PAYEE_PREFIX}${accountName}`;
}

/** The account name in a `Transfer: <account>` payee name, or null. */
export function transferPayeeAccount(payeeName: string | null | undefined): string | null {
  const name = payeeName?.trim() ?? "";
  if (!name.toLowerCase().startsWith(TRANSFER_PAYEE_PREFIX.trim().toLowerCase())) return null;
  const account = name.slice(TRANSFER_PAYEE_PREFIX.trim().length).trim();
  return account || null;
}

export type TargetPayeeResolution = PayeeResolution & {
  /** Set when the payee is a transfer payee: Actual creates the other leg in this account. */
  transferAccountId: string | null;
  /** That account's name, for messages. */
  transferName: string | null;
  /** Why a transfer payee was not used, when it was not. */
  note: string | null;
};

/**
 * Resolve a transaction's payee on the target, transfer payees included. A
 * `Transfer: <account>` name resolves only to that account's transfer payee. A
 * transfer to the flow's own target account would be a row transferring to
 * itself, so its payee is left empty.
 */
export function resolveTargetPayee(
  item: Pick<SyncSourceItem, "payeeName">,
  config: Pick<SyncFlowPlanConfig, "missingPayee" | "targetAccountId">,
  targetPayees: SyncPlannerPayee[]
): TargetPayeeResolution {
  const empty = (note: string): TargetPayeeResolution => ({
    payeeId: null, payeeName: null, willCreateOnApply: false, leftEmpty: true, transferAccountId: null, transferName: null, note,
  });
  const account = transferPayeeAccount(item.payeeName);
  const match = account
    ? targetPayees.find((p) => p.transferAccountId && normalizeName(p.name) === normalizeName(account))
    : undefined;
  if (account && !match) return empty(`No account named "${account}" in the target budget; payee left empty.`);
  const resolved: PayeeResolution = match
    ? { payeeId: match.id, payeeName: null, willCreateOnApply: false, leftEmpty: false }
    : resolvePayee(item, config, targetPayees);
  const payee = match ?? (resolved.payeeId ? targetPayees.find((p) => p.id === resolved.payeeId) : undefined);
  const transferAccountId = payee?.transferAccountId ?? null;
  if (transferAccountId && transferAccountId === config.targetAccountId) {
    return empty(`"${payee?.name}" is this account's own transfer payee; payee left empty.`);
  }
  return { ...resolved, transferAccountId, transferName: transferAccountId ? payee?.name ?? null : null, note: null };
}
