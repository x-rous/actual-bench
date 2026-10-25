import { generateId } from "@/lib/uuid";
import { syncTransportAfterChanges, type ActualBenchTransport } from "@/lib/actual/transport";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import { assetHashtags, attributeBook, readBook, sumMinor, type BookSnapshot } from "./ledger";
import type { Asset, BookMetadata, BookType, Registry } from "./models";
import { withTypeTag } from "./tags";

export type BookEdit = {
  kind: "create" | "set-value" | "edit" | "delete"; transactionId?: string;
  date: string; /** Signed integer minor units; target value for Update value. */ amountMinor: number;
  notes: string; payeeId: string | null;
};
export type ActionContext = { transport: ActualBenchTransport; asset: Asset; registry: Registry; snapshot: BookSnapshot };
export type PreparedAction = { edit: BookEdit; beforeMinor: number; afterMinor: number; deltaMinor: number; signature: string; marker: string; assetId: string; accountId: string; assetTag: string | null };
/**
 * The treatment that owns a row (depreciation, capital expenditure or disposal), mirroring the server rule that its type,
 * assignment and existence cannot change on their own. Checked before any Notes tag is written so Actual and Bench cannot disagree.
 */
export function boundTreatment(registry: { metadata: BookMetadata[]; cashflows?: { context?: BookMetadata["context"] }[] }, rowId: string): "depreciation" | "capital-expenditure" | "disposal" | null {
  const paired = registry.metadata.find((m) => m.actualTransactionId === rowId);
  if (paired?.depreciationPeriod) return "depreciation";
  if (paired?.capitalizedFromTransactionId) return "capital-expenditure";
  if (paired?.context?.data.kind === "disposal") return "disposal";
  return [...registry.metadata, ...(registry.cashflows ?? [])].some((m) => m.context?.data.kind === "disposal" && m.context.data.bookAdjustmentTransactionId === rowId) ? "disposal" : null;
}
export function protectedReason(row: SyncSourceTransaction | undefined, linksKnown: boolean): string | null {
  if (!row) return "The standalone transaction is unavailable";
  if (!linksKnown || row.transferId === undefined || row.scheduleId === undefined || typeof row.reconciled !== "boolean") return "This connection did not expose complete transaction safety fields";
  if (row.transferId) return "Transfers are classify-only; amend them in Actual";
  if (row.isParent || row.isChild || row.parentId || row.splitLines.length) return "Split structures are classify-only in Assets";
  if (row.reconciled) return "Reconciled transactions are protected";
  if (row.scheduleId) return "Scheduled transactions are protected";
  return null;
}
const signature = (c: ActionContext) => JSON.stringify([c.asset, c.registry, c.snapshot.date, c.snapshot.source]);
export function prepareAction(context: ActionContext, edit: BookEdit): PreparedAction {
  const { asset, snapshot, registry, transport } = context;
  if (asset.status !== "active") throw new Error("Restore the asset before changing its book");
  if (!isIsoDate(edit.date) || !Number.isSafeInteger(edit.amountMinor)) throw new Error("Invalid date or money units");
  if (snapshot.date !== edit.date) throw new Error("Refresh the account at the action date");
  const book = attributeBook(snapshot, registry.assets, registry.metadata);
  if (!book.available || book.issues.length) throw new Error("Resolve incomplete or missing account data before writing");
  const beforeMinor = book.totals.get(asset.id);
  if (beforeMinor === undefined) throw new Error("Asset membership is unavailable");
  const caps = transport.getSyncCapabilities().capabilities;
  const creating = edit.kind === "create" || edit.kind === "set-value";
  if (creating && (!caps.createTransaction || !caps.createTransactionWithImportedId)) throw new Error("This connection cannot create and identify an asset adjustment safely");
  if (edit.kind === "edit" && !caps.updateTransaction) throw new Error("Transaction editing is unsupported");
  if (edit.kind === "delete" && !caps.deleteTransaction) throw new Error("Transaction deletion is unsupported");
  let oldAmount = 0;
  if (!creating) {
    const row = snapshot.source.find((r) => r.id === edit.transactionId);
    const reason = protectedReason(row, snapshot.transferKnown);
    if (reason) throw new Error(reason);
    if (book.rows.find((r) => r.id === edit.transactionId)?.assetId !== asset.id) throw new Error("The row is not attributed to this asset");
    if (row!.date > edit.date) throw new Error("The action date must include the existing row");
    oldAmount = row!.amount;
  }
  const deltaMinor = edit.kind === "set-value" ? sumMinor([edit.amountMinor, -beforeMinor])
    : edit.kind === "delete" ? -oldAmount : sumMinor([edit.amountMinor, -oldAmount]);
  return { edit, beforeMinor, afterMinor: sumMinor([beforeMinor, deltaMinor]), deltaMinor, signature: signature(context), marker: `asset-action:${generateId()}`, assetId: asset.id, accountId: asset.actualAccountId, assetTag: asset.assetTag };
}
export class UncertainAssetWrite extends Error {
  constructor() { super("Actual write outcome needs inspection. Refresh and inspect the account before starting another action; do not repeat this create."); }
}
export type ActionResult = { transactionId: string | null; deleted: boolean; noop: boolean };
/** Reread immediately before a single write; no parallel mutations, retries or cross-client atomicity promise. */
export async function executeAction(prepared: PreparedAction, fresh: () => Promise<ActionContext>): Promise<ActionResult> {
  const context = await fresh();
  if (context.asset.id !== prepared.assetId || signature(context) !== prepared.signature) throw new Error("The book, membership or metadata changed. Review a fresh confirmation.");
  prepareAction(context, prepared.edit); // capability and row checks on the fresh read
  const { transport, snapshot } = context;
  const { edit } = prepared;
  if (edit.kind === "set-value" && prepared.deltaMinor === 0) return { transactionId: null, deleted: false, noop: true };
  if (edit.payeeId) {
    const payee = (await transport.getPayees()).find((p) => p.id === edit.payeeId);
    if (!payee || payee.transferAccountId) throw new Error("Choose an ordinary existing payee, not a transfer payee");
  }
  const tags = assetHashtags(edit.notes);
  if (tags.some((t) => t !== prepared.assetTag)) throw new Error("Adjustment Notes contain another asset tag");
  const creating = edit.kind === "create" || edit.kind === "set-value";
  const notes = !creating || !prepared.assetTag || tags.includes(prepared.assetTag) ? edit.notes : `${edit.notes.trim()} ${prepared.assetTag}`.trim();
  let id = edit.transactionId ?? null;
  try {
    if (creating) {
      const result = await transport.createTransactionsForSync([{ accountId: prepared.accountId, date: edit.date,
        amount: edit.kind === "set-value" ? prepared.deltaMinor : edit.amountMinor,
        payeeId: edit.payeeId, notes, importedId: prepared.marker, cleared: false }]);
      id = result.created[0]?.transactionId ?? null;
    } else if (edit.kind === "edit") {
      await transport.updateTransactionForSync({ accountId: prepared.accountId, transactionId: id!, date: edit.date, amount: edit.amountMinor, payeeId: edit.payeeId, notes, returnApplied: false });
    } else await transport.deleteTransactionForSync({ transactionId: id! });
    await syncTransportAfterChanges(transport, true);
    // Generic Direct writes can settle asynchronously. Bounded polling is read-only.
    for (let attempt = 0; attempt < 4; attempt++) {
      const source = await transport.listTransactionsForSync({ accountId: prepared.accountId });
      const row = creating ? source.find((r) => r.importedId === prepared.marker) : source.find((r) => r.id === id);
      if (edit.kind === "delete" && !row) return { transactionId: id, deleted: true, noop: false };
      const amount = edit.kind === "set-value" ? prepared.deltaMinor : edit.amountMinor;
      // Actual may normalize blank Notes to null; nonempty Notes still require an exact match.
      if (row && row.accountId === snapshot.accountId && row.date === edit.date && row.amount === amount && (row.notes?.trim() ? row.notes : null) === (notes.trim() ? notes : null) && row.payeeId === edit.payeeId && !protectedReason(row, snapshot.transferKnown)) {
        return { transactionId: row.id, deleted: false, noop: false };
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch { throw new UncertainAssetWrite(); }
  throw new UncertainAssetWrite();
}

export async function freshActionContext(transport: ActualBenchTransport, assetId: string, date: string, loadRegistry: () => Promise<Registry>): Promise<ActionContext> {
  await transport.sync(); // Direct must receive external ledger edits before a fresh guard.
  const registry = await loadRegistry();
  const asset = registry.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error("Asset is unavailable");
  return { transport, registry, asset, snapshot: await readBook(transport, asset.actualAccountId, date) };
}

/**
 * Writes (or removes) the type hashtag in the Notes of the given book rows in Actual. Protected rows (transfers, splits,
 * reconciled or scheduled) are never edited and are reported as skipped: their type stays in Bench's metadata only.
 */
export async function writeTypeTags(context: ActionContext, rowIds: string[], type: BookType | null): Promise<{ tagged: string[]; skipped: string[] }> {
  const { transport, snapshot } = context;
  const caps = transport.getSyncCapabilities().capabilities;
  const tagged: string[] = []; const skipped: string[] = [];
  const edits: { row: SyncSourceTransaction; notes: string }[] = [];
  for (const id of rowIds) {
    const row = snapshot.source.find((r) => r.id === id);
    if (!row || !caps.updateTransaction || protectedReason(row, snapshot.transferKnown) || boundTreatment(context.registry, id)) { skipped.push(id); continue; }
    const notes = withTypeTag(row.notes, type);
    if (notes === (row.notes ?? "")) continue; // already carries exactly this tag
    edits.push({ row, notes });
  }
  try {
    for (const { row, notes } of edits) {
      await transport.updateTransactionForSync({ accountId: row.accountId, transactionId: row.id, date: row.date, amount: row.amount, notes, returnApplied: false });
      tagged.push(row.id);
    }
    if (edits.length) await syncTransportAfterChanges(transport, true);
  } catch { throw new UncertainAssetWrite(); }
  return { tagged, skipped };
}
