import { BENCH_ROW_MARKER, withTypeTag } from "./tags";
import { generateId } from "@/lib/uuid";
import { syncTransportAfterChanges } from "@/lib/actual/transport";
import type { ActivityRow } from "@/features/credit-cards/lib/activity";
import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import { attributeBook, sumMinor } from "./ledger";
import { executeAction, prepareAction, UncertainAssetWrite, type ActionContext, type ActionResult, type PreparedAction } from "./actions";
import type { ExternalSnapshot, CashflowChange } from "./cashflows";
import type { AssetContext } from "./models";

/** What a payment into the asset is recorded as: the purchase itself, or capital added later (an improvement, an extra contribution). */
export type PaymentType = "acquisition" | "added-capital";
export type CapitalContext = ActionContext & { external: ExternalSnapshot };
/** Money is signed integer minor units; amount/carrying inputs below must be positive. */
export type CapitalInput = { date: string; notes: string } & (
  { kind: "convert"; sourceId: string; asType?: PaymentType } |
  { kind: "dispose"; representation: "external-receipt" | "asset-transfer" | "write-off"; sourceId: string; carryingMinor: number; proceedsBasis: "gross" | "net"; feeIds: string[] } |
  { kind: "acquire"; sourceAccountId: string; categoryId: string; amountMinor: number; paymentNotRecorded: boolean; asType?: PaymentType }
);
export type CapitalPrepared = { input: CapitalInput; beforeMinor: number; deltaMinor: number; afterMinor: number; proceedsMinor: number; feesMinor: number; guard: string; book: PreparedAction | null; marker: string; source?: ActivityRow; fees: ActivityRow[]; context: CapitalContext };
const signature = (c: CapitalContext) => JSON.stringify([c.asset, c.registry, c.snapshot.date, c.snapshot.source, c.external.rows, c.external.issues, c.external.accounts]);
export function capitalEvidence(context: CapitalContext) { return [...normalizeActivity(context.snapshot.source).rows, ...context.external.rows]; }
export function prepareCapital(context: CapitalContext, input: CapitalInput): CapitalPrepared {
  if (!isIsoDate(input.date) || input.date !== context.snapshot.date) throw new Error("Refresh at the action's effective date");
  if (context.external.issues.length) throw new Error(context.external.issues[0]);
  const attributed = attributeBook(context.snapshot, context.registry.assets, context.registry.metadata);
  if (!attributed.available || attributed.issues.length || context.asset.status !== "active") throw new Error("Resolve incomplete account data or restore this asset before posting");
  const beforeMinor = attributed.totals.get(context.asset.id)!;
  const allMetadata = [...context.registry.metadata, ...(context.registry.cashflows ?? [])];
  const feeRows: ActivityRow[] = [];
  let source: ActivityRow | undefined, delta = 0, proceeds = 0;
  function availableExternal(id: string) {
    const row = context.external.rows.find((r) => r.id === id);
    if (!row || row.transferId || !row.transferKnown) throw new Error("Choose a complete external transaction, not a transfer");
    const link = allMetadata.find((m) => m.actualTransactionId === row.id);
    if (link && link.assetId !== context.asset.id) throw new Error("Source is already linked to another asset");
    if (link?.context) throw new Error("This source is already part of a disposal treatment");
    return row;
  }
  if (input.kind === "convert") {
    source = availableExternal(input.sourceId);
    if (source.amountMinor >= 0) throw new Error("Choose an expense: money you paid out");
    if (source.parentId) throw new Error("A split line cannot be converted into a transfer; pick a transaction that is not split");
    const sourceAccount = context.external.accounts.find((a) => a.id === source!.accountId);
    if (!sourceAccount || sourceAccount.closed) throw new Error("The expense's account is unavailable");
    if (!sourceAccount.offBudget && !source.categoryId) throw new Error("Give the expense a category in Actual first: an on-budget payment keeps its category when it becomes a transfer");
    if (!context.transport.convertToTransfer) throw new Error("This connection cannot turn an expense into a transfer");
    if (source.date > input.date) throw new Error("The payment cannot be after the action date");
    delta = -source.amountMinor;
  } else if (input.kind === "dispose") {
    if (!Number.isSafeInteger(input.carryingMinor) || input.carryingMinor <= 0) throw new Error("Enter a positive carrying value to remove");
    if (new Set(input.feeIds).size !== input.feeIds.length) throw new Error("Selling costs must be unique");
    if (input.representation === "external-receipt") {
      source = availableExternal(input.sourceId);
      if (source.amountMinor <= 0) throw new Error("Choose a positive existing receipt");
      proceeds = source.amountMinor;
    } else if (input.representation === "asset-transfer") {
      source = attributed.rows.find((r) => r.id === input.sourceId && r.assetId === context.asset.id && r.amountMinor < 0 && r.transferId !== null);
      if (!source) throw new Error("Choose this asset's existing outgoing transfer");
      const counterpart = context.external.rows.find((r) => r.id === source!.transferId && r.transferId === source!.id && r.amountMinor === -source!.amountMinor && r.date === source!.date);
      if (!counterpart) throw new Error("The matching bank-side transfer is unavailable");
      if (allMetadata.some((m) => m.actualTransactionId === counterpart.id) || allMetadata.find((m) => m.actualTransactionId === source!.id)?.context) throw new Error("This proceeds movement already has an asset treatment");
      proceeds = -source.amountMinor;
    }
    if (source && source.date !== input.date) throw new Error("Disposal date must match the existing proceeds transaction");
    if (input.carryingMinor > sumMinor([beforeMinor, input.representation === "asset-transfer" ? proceeds : 0])) throw new Error("Carrying removed exceeds the pre-disposal asset value");
    for (const id of input.feeIds) {
      const fee = availableExternal(id);
      if (fee.amountMinor >= 0 || id === source?.id) throw new Error("Choose separate negative selling-cost rows");
      feeRows.push(fee);
    }
    delta = input.representation === "asset-transfer" ? sumMinor([proceeds, -input.carryingMinor]) : -input.carryingMinor;
  } else {
    if (!input.paymentNotRecorded) throw new Error("Confirm that the genuine payment has not already been recorded");
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter a positive acquisition amount");
    const account = context.external.accounts.find((a) => a.id === input.sourceAccountId && !a.closed && !context.registry.assets.some((asset) => asset.actualAccountId === a.id));
    if (!account || (!account.offBudget && !input.categoryId)) throw new Error("Choose a saved source account and the on-budget expense category");
    if (context.external.readAccountIds && !context.external.readAccountIds.includes(account.id)) throw new Error("The source account has not been read. Refresh before recording the acquisition.");
    if (context.external.rows.some((r) => r.accountId === account.id && r.date === input.date && r.amountMinor === -input.amountMinor)) throw new Error("A matching payment already exists. Inspect/classify the existing movement instead.");
    delta = input.amountMinor;
  }
  // Reuse the existing financial checks and single-row helper for noncash capital treatments.
  const book = input.kind === "dispose" && delta !== 0 ? prepareAction(context, { kind: "create", date: input.date, amountMinor: delta, notes: withTypeTag(input.notes, "disposal"), payeeId: null }) : null;
  if (input.kind === "acquire") {
    const caps = context.transport.getSyncCapabilities().capabilities;
    if (!caps.createTransaction || !caps.createTransactionWithImportedId || !context.snapshot.transferKnown) throw new Error("This connection cannot safely create/verify the acquisition transfer");
  }
  return { input, beforeMinor, deltaMinor: delta, afterMinor: sumMinor([beforeMinor, delta]), proceedsMinor: proceeds, feesMinor: sumMinor(feeRows.map((r) => -r.amountMinor)), guard: signature(context), book, marker: `${BENCH_ROW_MARKER}${generateId()}`, source, fees: feeRows, context };
}
/** Exactly one financial create, or zero for an already-balanced disposal. Unknown outcomes never retry here. */
export async function executeCapital(prepared: CapitalPrepared, fresh: () => Promise<CapitalContext>): Promise<ActionResult> {
  const context = await fresh();
  if (signature(context) !== prepared.guard) throw new Error("The asset/source data changed. Review a fresh preview before posting");
  prepareCapital(context, prepared.input);
  if (prepared.input.kind === "dispose") return prepared.book ? executeAction(prepared.book, async () => context) : { transactionId: null, noop: true, deleted: false };
  if (prepared.input.kind === "convert") return convertExpense(prepared, context);
  const input = prepared.input;
  const payee = (await context.transport.getPayees()).find((p) => p.transferAccountId === context.asset.actualAccountId);
  if (!payee) throw new Error("Actual's transfer payee for the asset account is unavailable");
  const categories = await context.transport.getCategoryGroups();
  if (input.categoryId && !categories.categories.some((c) => c.id === input.categoryId && !c.isIncome)) throw new Error("Choose a saved expense category for the payment");
  const notes = [input.notes.trim(), context.asset.assetTag].filter(Boolean).join(" ");
  try {
    await context.transport.createTransactionsForSync([{ accountId: input.sourceAccountId, amount: -input.amountMinor, date: input.date, payeeId: payee.id, categoryId: input.categoryId || null, notes, importedId: prepared.marker, cleared: false }]);
    await syncTransportAfterChanges(context.transport, true);
    for (let attempt = 0; attempt < 4; attempt++) {
      const bank = await context.transport.listTransactionsForSync({ accountId: input.sourceAccountId });
      const asset = await context.transport.listTransactionsForSync({ accountId: context.asset.actualAccountId });
      const source = bank.find((r) => r.importedId === prepared.marker);
      const peer = asset.find((r) => r.id === source?.transferId);
      if (source && peer && source.accountId === input.sourceAccountId && peer.accountId === context.asset.actualAccountId && source.amount === -input.amountMinor && peer.amount === input.amountMinor && source.date === input.date && peer.date === input.date && peer.transferId === source.id && source.payeeId === payee.id && source.categoryId === (input.categoryId || null) && (source.notes || "") === notes && !source.isParent && !peer.isParent && !source.reconciled && !peer.reconciled) return { transactionId: peer.id, noop: false, deleted: false };
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch { throw new UncertainAssetWrite(); }
  throw new UncertainAssetWrite();
}
export function capitalMetadata(prepared: CapitalPrepared, result: ActionResult): CashflowChange[] {
  const { context, input } = prepared;
  const all = [...context.registry.metadata, ...(context.registry.cashflows ?? [])];
  const entry = (id: string, accountId: string, role: "book" | "cashflow", classification: string): CashflowChange => ({ role, actualTransactionId: id, actualAccountId: accountId, assetId: context.asset.id, classification, revision: all.find((m) => m.actualTransactionId === id)?.revision ?? 0 });
  if (input.kind === "acquire") return [entry(result.transactionId!, context.asset.actualAccountId, "book", input.asType ?? "acquisition")];
  if (input.kind === "convert") {
    // The expense is now a transfer, so it is no longer an income/expense link; the row Actual made in the asset account is the purchase.
    const link = (context.registry.cashflows ?? []).find((m) => m.actualTransactionId === prepared.source!.id);
    return [...(link ? [{ ...entry(link.actualTransactionId, link.actualAccountId, "cashflow", link.classification ?? ""), classification: link.classification, remove: true }] : []), entry(result.transactionId!, context.asset.actualAccountId, "book", input.asType ?? "acquisition")];
  }
  const writeOff = input.representation === "write-off";
  const id = writeOff ? result.transactionId! : prepared.source!.id;
  const contextData: AssetContext = { version: 1, data: { kind: "disposal", representation: input.representation, carryingRemovedMinor: input.carryingMinor, bookAdjustmentTransactionId: writeOff ? null : result.transactionId, ...(writeOff ? {} : { proceedsBasis: input.proceedsBasis }) } };
  const changes: CashflowChange[] = [{ ...entry(id, input.representation === "external-receipt" ? prepared.source!.accountId : context.asset.actualAccountId, input.representation === "external-receipt" ? "cashflow" : "book", input.representation === "external-receipt" ? "disposal-proceeds" : "disposal"), context: contextData }];
  if (!writeOff && result.transactionId) changes.push(entry(result.transactionId, context.asset.actualAccountId, "book", "disposal"));
  for (const fee of prepared.fees) changes.push({ ...entry(fee.id, fee.accountId, "cashflow", "other-excluded"), context: { version: 1, data: { kind: "selling-cost", disposalTransactionId: id } } });
  return changes;
}

/**
 * Turns an existing expense into the transfer into the asset: its payee becomes the asset account's transfer payee and Actual
 * creates the one matching row in the asset account. Amount, date, category and Notes stay. One write, read back; an
 * unknown outcome never repeats. A reconciled expense is converted too (its cleared status is unchanged); a split is refused.
 */
async function convertExpense(prepared: CapitalPrepared, context: CapitalContext): Promise<ActionResult> {
  const { transport, asset } = context; const source = prepared.source!;
  const payee = (await transport.getPayees()).find((p) => p.transferAccountId === asset.actualAccountId);
  if (!payee) throw new Error("Actual's transfer payee for the asset account is unavailable");
  const raw = (await transport.listTransactionsForSync({ accountId: source.accountId })).find((r) => r.id === source.id);
  if (!raw || raw.amount !== source.amountMinor || raw.date !== source.date || raw.transferId || raw.isParent || raw.isChild || raw.parentId) throw new Error("The expense changed. Refresh and review again.");
  try {
    await transport.convertToTransfer!({ allowReconciled: true, transferPayeeId: payee.id, counterpartAccountId: asset.actualAccountId,
      expected: { id: raw.id, accountId: raw.accountId, date: raw.date, amount: raw.amount, payeeId: raw.payeeId, categoryId: raw.categoryId, notes: raw.notes?.trim() ? raw.notes : null,
        reconciled: raw.reconciled === true, transferId: null, isParent: false, isChild: false, parentId: null, childCount: 0 } });
    await syncTransportAfterChanges(transport, true);
    for (let attempt = 0; attempt < 4; attempt++) {
      const [bank, book] = [await transport.listTransactionsForSync({ accountId: source.accountId }), await transport.listTransactionsForSync({ accountId: asset.actualAccountId })];
      const now = bank.find((r) => r.id === source.id); const peer = book.find((r) => r.id === now?.transferId);
      if (now && peer && now.payeeId === payee.id && now.amount === source.amountMinor && now.date === source.date && peer.accountId === asset.actualAccountId && peer.amount === prepared.deltaMinor && peer.date === source.date && peer.transferId === source.id) return { transactionId: peer.id, deleted: false, noop: false };
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch { throw new UncertainAssetWrite(); }
  throw new UncertainAssetWrite();
}
