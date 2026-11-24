import { getBudgetFileSyncCapabilities } from "../capabilities";
import { connectionMatchesBudget } from "../connectionRef";
import { decodeFlowPlanConfig, type SyncFlowPlanConfig } from "../flowConfig";
import {
  DEFAULT_SOURCE_FILTER,
  decodeSourceFilter,
  filterSourceItems,
  filterSourceTransactions,
  type SyncSourceFilter,
} from "../sourceFilter";
import { allKeysOf, expandSourceTransactions, type SyncSourceItem } from "../sourceItems";
import { planExpandedItems } from "../syncPlanner";
import {
  describeSyncError,
  registerSyncKindAdapter,
  SyncKindError,
  type AdapterApplyContext,
  type AdapterLiveTarget,
  type AdapterScanOptions,
  type AdapterWriteOptions,
  type AdapterCreateInput,
  type AdapterCreateResult,
  type AdapterMutateInput,
  type AdapterMutateResult,
  type AdapterSourceResult,
  type AdapterSummary,
  type AdapterValidateInput,
  type SyncKindAdapter,
} from "../syncKind";
import { fxNeedDates } from "../fxPolicy";
import { targetBaseline, targetMatchesBaseline } from "../targetFingerprint";
import type {
  ActualBenchTransport,
  BatchTransactionUpdate,
  SyncSourceTransaction,
  SyncTargetSplitChild,
  SyncTargetTransactionInput,
} from "@/lib/actual/transport";
import type { JsonObject, SyncCapabilitySet, SyncFlow, SyncMapping } from "@/lib/app-db/types";
import type { PlannedTargetPayload, SyncPlannedItem, SyncPlannerTargetSnapshot, SyncPlanResult } from "../plannedChanges";

/**
 * Transaction data-type adapter for the unified sync engine (RD-053 behavior,
 * unchanged - this is the behavior-preserving extraction of the original
 * inline transaction logic behind the `SyncKindAdapter` interface).
 */

type MaterializedSource = {
  items: SyncSourceItem[];
  filter: SyncSourceFilter;
  config: SyncFlowPlanConfig;
  /** Every item key in the source account before filters; set when deletions are detected. */
  presentSourceKeys?: string[];
  /** The day rates were asked for, so planning judges a month against the same days. */
  fxToday: string;
};

/** Keys in both split shapes, so changing the split setting never reads as a deletion. */
function allItemKeys(transactions: SyncSourceTransaction[]): string[] {
  return [
    ...expandSourceTransactions(transactions, { groupSplits: false }),
    ...expandSourceTransactions(transactions, { groupSplits: true }),
  ].flatMap(allKeysOf);
}

/** The persisted fields of every target row, from one account read (or a few days of it). */
async function readTargetRows(
  transport: ActualBenchTransport,
  accountId: string,
  ...dates: string[]
): Promise<Map<string, AdapterLiveTarget & { importedId: string | null }>> {
  const range = dates.length > 0 ? { startDate: [...dates].sort()[0], endDate: [...dates].sort()[dates.length - 1] } : {};
  const rows = await transport.listTransactionsForSync({ accountId, resolveNames: false, ...range });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        amount: row.amount,
        date: row.date,
        cleared: row.cleared,
        categoryId: row.categoryId,
        payeeId: row.payeeId,
        notes: row.notes,
        importedPayee: row.importedPayee ?? null,
        importedId: row.importedId ?? null,
        transferId: row.transferId ?? null,
        reconciled: row.reconciled,
        isParent: row.isParent,
        splitLines: row.isParent
          ? row.splitLines.map((line) => ({
              id: line.id,
              amount: line.amount,
              notes: line.notes,
              payeeId: line.payeeId,
              categoryId: line.categoryId,
              reconciled: line.reconciled,
            }))
          : undefined,
      },
    ])
  );
}

type PlannedLine = { amount: number; notes: string | null };
type SplitLine = NonNullable<AdapterLiveTarget["splitLines"]>[number];

const writeLine = (
  transport: ActualBenchTransport,
  accountId: string,
  date: string,
  line: SplitLine,
  next: PlannedLine
) => transport.updateTransactionForSync({
  transactionId: line.id as string,
  accountId,
  date,
  amount: next.amount,
  payeeId: line.payeeId,
  categoryId: line.categoryId,
  notes: next.notes ?? null,
  returnApplied: false,
});

/**
 * Rewrite a grouped split, each line on the line itself. Actual gives a line its
 * parent's payee and category when an update leaves them out, so every write names
 * the line's own. The parent follows last, once the lines add up.
 *
 * Lines are written one at a time, so after the first write each line is read
 * again before its own: its category belongs to the target and may have been set
 * meanwhile, and a line edited meanwhile stops the update.
 *
 * A failed write puts the lines already changed back, so a retry does not take
 * this sync's own half-finished work for an outside edit. Returns false when the
 * apply lost its claim part-way: another writer may own the row, so it stops there.
 */
async function updateSplit(
  transport: ActualBenchTransport,
  accountId: string,
  date: string,
  live: AdapterLiveTarget,
  planned: PlannedLine[],
  writeParent: () => Promise<unknown>,
  readLines: () => Promise<Map<string, SplitLine>>,
  shouldStop?: () => boolean
): Promise<boolean> {
  const changed: SplitLine[] = [];
  try {
    for (const [index, line] of (live.splitLines ?? []).entries()) {
      const next = planned[index];
      if (line.amount === next.amount && (line.notes ?? null) === (next.notes ?? null)) continue;
      if (shouldStop?.()) return false;
      let current = line;
      if (changed.length > 0) {
        const fresh = (await readLines()).get(line.id as string);
        if (
          !fresh ||
          fresh.amount !== line.amount ||
          (fresh.notes ?? null) !== (line.notes ?? null) ||
          (fresh.payeeId ?? null) !== (line.payeeId ?? null)
        ) {
          throw new Error("A split line was edited outside sync during the update.");
        }
        if (shouldStop?.()) return false;
        current = { ...line, categoryId: fresh.categoryId };
      }
      await writeLine(transport, accountId, date, current, next);
      changed.push(line);
    }
    if (shouldStop?.()) return false;
    await writeParent();
    return true;
  } catch (err) {
    try {
      // Amounts and notes go back to what they were; each category stays as it is now.
      // If that read fails, the restore still runs with the categories read at the start.
      const now = changed.length > 0 ? await readLines().catch(() => new Map<string, SplitLine>()) : new Map<string, SplitLine>();
      for (const line of [...changed].reverse()) {
        // A category or payee changed meanwhile stays as the owner set it, cleared
        // included; the start's values apply only to a line not read back.
        const current = now.get(line.id as string);
        const categoryId = current ? current.categoryId : line.categoryId;
        const payeeId = current ? current.payeeId : line.payeeId;
        await writeLine(transport, accountId, live.date, { ...line, categoryId, payeeId }, { amount: line.amount, notes: line.notes });
      }
    } catch {
      throw new Error(`The split was only partly updated and could not be put back. Check it in Actual. ${describeSyncError(err, "")}`.trim());
    }
    throw err;
  }
}

type LiveRow = AdapterLiveTarget & { importedId: string | null };

/**
 * The other leg of a linked transfer, read from its own account. The leg's account
 * is the one its transfer payee points at. Null when it cannot be found.
 */
async function readOtherLeg(
  transport: ActualBenchTransport,
  payeeAccounts: () => Promise<Map<string, string>>,
  live: LiveRow,
  date: string
): Promise<{ accountId: string; row: LiveRow } | null> {
  const accountId = live.payeeId ? (await payeeAccounts()).get(live.payeeId) : undefined;
  if (!accountId || !live.transferId) return null;
  const row = (await readTargetRows(transport, accountId, date)).get(live.transferId);
  return row ? { accountId, row } : null;
}

const TRANSFER_MATCH_DAYS = 3;
const TRANSFER_MATCH_BPS = 500;
const DAY_MS = 86_400_000;
const dayGap = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
const shiftDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const formatMinor = (minor: number) => (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Transfer payee id → the account it transfers to, read once per batch when first needed. */
function transferAccountsOf(transport: ActualBenchTransport): () => Promise<Map<string, string>> {
  let cached: Promise<Map<string, string>> | null = null;
  return () =>
    (cached ??= transport.getPayees().then((payees) =>
      new Map(payees.filter((p) => p.transferAccountId).map((p) => [p.id, p.transferAccountId as string]))
    ));
}

/** A skip that also records the change as seen, so the next preview does not offer it again. */
function settledSkip(input: AdapterMutateInput, message: string, patch: AdapterMutateResult["mappingPatch"]): AdapterMutateResult {
  return { itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message, ...(patch ? { mappingPatch: patch } : {}) };
}

/**
 * Update one leg of a linked transfer. Actual copies its amount and notes to the
 * other leg; the date is moved here. Only a transfer this sync created is changed:
 * one linked to the user's own row keeps the amount that row recorded.
 */
async function updateLinkedTransfer(
  transport: ActualBenchTransport,
  targetAccountId: string,
  input: AdapterMutateInput,
  live: LiveRow,
  payeeAccounts: () => Promise<Map<string, string>>,
  shouldStop?: () => boolean
): Promise<AdapterMutateResult> {
  const seen = input.sourceFingerprint ? { sourceFingerprint: input.sourceFingerprint } : undefined;
  if (!input.ownsTransferLeg) {
    return settledSkip(input, "This transfer is linked to your own row in another account, which holds the real amount; left unchanged.", seen);
  }
  const payload = input.payload ?? {};
  const date = String(payload.date ?? live.date);
  const amount = Number(payload.amount ?? live.amount);
  const notes = (payload.notes as string | null) ?? null;
  const other = await readOtherLeg(transport, payeeAccounts, live, live.date);
  if (!other) return { itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "The transfer's other leg could not be found; left unchanged." };
  if (other.row.reconciled) return settledSkip(input, "The transfer's other leg is reconciled; left unchanged.", seen);
  if (shouldStop?.()) return { itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Apply stopped before this row; left unchanged." };
  // The payee stays: it is what makes the row a transfer. The category is the target's.
  await transport.updateTransactionForSync({ transactionId: input.targetId, accountId: targetAccountId, date, amount, notes, returnApplied: false });
  if (date !== live.date) {
    await transport.updateTransactionForSync({ transactionId: live.transferId as string, accountId: other.accountId, date, amount: -amount, returnApplied: false });
  }
  return {
    itemId: input.itemId,
    outcome: "updated",
    targetId: input.targetId,
    targetFingerprint: targetBaseline({ ...live, date, amount, notes }),
    message: "Both legs of the transfer updated.",
  };
}

/**
 * Why a linked transfer must not be deleted, or null when it may. Deleting a leg
 * deletes both, so only a transfer this sync created goes, and not once its other
 * leg is reconciled. The others stop being synced, so they are reported once.
 */
async function linkedTransferDeleteProblem(
  transport: ActualBenchTransport,
  input: AdapterMutateInput,
  live: LiveRow,
  payeeAccounts: () => Promise<Map<string, string>>
): Promise<AdapterMutateResult | null> {
  const stop = { status: "source_missing" as const };
  if (!input.ownsTransferLeg) {
    return settledSkip(input, "This transfer is linked to your own row in another account, so both rows stay. It is no longer synced.", stop);
  }
  const other = await readOtherLeg(transport, payeeAccounts, live, live.date);
  if (other?.row.reconciled) return settledSkip(input, "The transfer's other leg is reconciled, so both rows stay. It is no longer synced.", stop);
  return null;
}

/** A queued update without its category, for a row whose category is already set. */
function withoutCategory<T extends { fields: BatchTransactionUpdate }>(write: T): T {
  const fields = { ...write.fields };
  delete fields.categoryId;
  return { ...write, fields };
}

/** Why a grouped split cannot take these lines, or null when it can. */
function splitUpdateProblem(live: AdapterLiveTarget, planned: PlannedLine[]): string | null {
  if (!live.isParent || !live.splitLines) return "Target is not a split; left unchanged.";
  if (live.splitLines.length !== planned.length) return "The split now has a different number of lines; left unchanged.";
  if (live.reconciled || live.splitLines.some((line) => line.reconciled)) return "Target split is reconciled; left unchanged.";
  if (live.splitLines.some((line) => !line.id)) return "A target split line has no id; left unchanged.";
  return null;
}

function decodeFilterOrDefault(flow: SyncFlow): SyncSourceFilter {
  try {
    return decodeSourceFilter(flow);
  } catch {
    return { ...DEFAULT_SOURCE_FILTER };
  }
}

async function loadTargetSnapshot(
  transport: ActualBenchTransport,
  config: SyncFlowPlanConfig,
  filter: SyncSourceFilter,
  scan?: AdapterScanOptions
): Promise<SyncPlannerTargetSnapshot> {
  // The whole account: a mapped row may have moved outside the flow's date window
  // without being deleted. Duplicate checks still only consider the window. A
  // routine scan reads from its own date and leaves the deleted-row check to the
  // next full scan.
  const lookup = await transport.getTargetLookupForSync({ accountId: config.targetAccountId, startDate: scan?.sinceDate });
  const categoryGroups = await transport.getCategoryGroups();
  const inWindow = (date: string) =>
    (!filter.startDate || date >= filter.startDate) && (!filter.endDate || date <= filter.endDate);

  return {
    payees: lookup.payees.map((p) => ({ id: p.id, name: p.name, transferAccountId: p.transferAccountId ?? null })),
    categories: categoryGroups.categories.map((c) => ({ id: c.id, name: c.name })),
    importedIdIndex: lookup.importedIdIndex,
    transactions: lookup.transactions.filter((t) => inWindow(t.date)).map((t) => ({
      id: t.id,
      date: t.date,
      amount: t.amount,
      payeeName: t.payeeName,
      categoryId: t.categoryId,
      splitAmounts: t.splitAmounts,
      transferId: t.transferId ?? null,
    })),
    allTransactionIds: scan?.sinceDate ? undefined : new Set(lookup.transactions.map((t) => t.id)),
  };
}

function diffPlannedVsActual(
  payload: JsonObject,
  resolvedPayeeId: string | null,
  actual: { amount: number; date: string; cleared: boolean; categoryId: string | null; payeeId: string | null; notes: string | null }
): string[] {
  const changed: string[] = [];
  if (payload.amount !== actual.amount) changed.push("amount");
  if (payload.date !== actual.date) changed.push("date");
  if ((payload.cleared ?? false) !== actual.cleared) changed.push("cleared");
  if ((payload.categoryId ?? null) !== (actual.categoryId ?? null)) changed.push("category");
  if ((resolvedPayeeId ?? null) !== (actual.payeeId ?? null)) changed.push("payee");
  if ((payload.notes ?? null) !== (actual.notes ?? null)) changed.push("notes");
  return changed;
}

export const transactionAdapter: SyncKindAdapter = {
  flowType: "transaction_sync",

  validate({ flow, sourceConnection, targetConnection }: AdapterValidateInput): void {
    const config = decodeFlowPlanConfig(flow);
    if (!config.sourceAccountId || !config.targetAccountId) {
      throw new SyncKindError("missing_route", "Source and target accounts must both be selected before previewing.");
    }
    assertConnectionMatches(config.sourceBudgetId, sourceConnection, "source");
    assertConnectionMatches(config.targetBudgetId, targetConnection, "target");

    const sourceCaps = getBudgetFileSyncCapabilities({ mode: sourceConnection.mode });
    const targetCaps = getBudgetFileSyncCapabilities({ mode: targetConnection.mode });
    if (!sourceCaps.supported) throw new SyncKindError("unsupported_connection", sourceCaps.reason ?? "Source connection is unsupported.");
    if (!targetCaps.supported) throw new SyncKindError("unsupported_connection", targetCaps.reason ?? "Target connection is unsupported.");
    if (!sourceCaps.capabilities.listTransactions || !sourceCaps.capabilities.readSplitLines) {
      throw new SyncKindError("unsupported_connection", "Source connection cannot list transactions or split lines.");
    }
    if (!targetCaps.capabilities.listTransactions) {
      throw new SyncKindError("unsupported_connection", "Target connection cannot list transactions for lookup.");
    }
  },

  async loadSource(transport: ActualBenchTransport, flow: SyncFlow, scan?: AdapterScanOptions): Promise<AdapterSourceResult> {
    const config = decodeFlowPlanConfig(flow);
    const filter = decodeFilterOrDefault(flow);
    const startDate = [filter.startDate, scan?.sinceDate].filter((date): date is string => !!date).sort().pop();
    let rawSource;
    try {
      rawSource = await transport.listTransactionsForSync({
        accountId: config.sourceAccountId,
        startDate,
        endDate: filter.endDate ?? undefined,
      });
    } catch (err) {
      throw new SyncKindError("source_load_failed", describeSyncError(err, "Failed to read source transactions."));
    }
    const scanned = rawSource.length;
    const nonGenerated = filterSourceTransactions(rawSource, filter);
    const generatedExcluded = scanned - nonGenerated.length;
    const expanded = expandSourceTransactions(nonGenerated, { groupSplits: config.createTargetSplits });
    const expandedCount = expanded.length;
    const kept = filterSourceItems(expanded, filter);
    const items = JSON.parse(JSON.stringify(kept)) as SyncSourceItem[];
    // Deletions are judged against the whole account, not the filtered rows.
    let presentSourceKeys: string[] | undefined;
    if (config.detectDeletedSource && !scan?.sinceDate) {
      try {
        const whole = filter.startDate || filter.endDate
          ? await transport.listTransactionsForSync({ accountId: config.sourceAccountId, resolveNames: false })
          : rawSource;
        presentSourceKeys = allItemKeys(whole);
      } catch (err) {
        throw new SyncKindError("source_load_failed", describeSyncError(err, "Failed to read the source account."));
      }
    }
    const materialized: MaterializedSource = { items, filter, config, presentSourceKeys, fxToday: new Date().toISOString().slice(0, 10) };
    return { materialized, stats: { scanned, generatedExcluded, expandedCount, keptCount: items.length } };
  },

  async loadTarget(transport: ActualBenchTransport, flow: SyncFlow, scan?: AdapterScanOptions): Promise<unknown> {
    const config = decodeFlowPlanConfig(flow);
    const filter = decodeFilterOrDefault(flow);
    try {
      return await loadTargetSnapshot(transport, config, filter, scan);
    } catch (err) {
      throw new SyncKindError("target_load_failed", describeSyncError(err, "Failed to read target lookup data."));
    }
  },

  /** Distinct (sourceCurrency → targetCurrency, date) rates this run needs (RD-056). */
  collectFxNeeds(materialized: unknown): { baseCurrency: string; quoteCurrency: string; date: string }[] {
    const source = materialized as MaterializedSource;
    const { config } = source;
    if (!config.fxEnabled || config.fxSourceCurrency === config.fxTargetCurrency) return [];
    return fxNeedDates(config, source.items.map((item) => item.date), source.fxToday)
      .map((date) => ({ baseCurrency: config.fxSourceCurrency, quoteCurrency: config.fxTargetCurrency, date }));
  },

  plan({ flow, materialized, target, mappings, targetCapabilities, fxRateByDate, fxPendingByDate, manualFxRates }): SyncPlanResult {
    const source = materialized as MaterializedSource;
    void flow;
    return planExpandedItems({
      config: source.config,
      capabilities: { mode: "browser-api", supported: true, reason: null, capabilities: targetCapabilities },
      sourceItems: source.items,
      target: target as SyncPlannerTargetSnapshot,
      existingMappings: mappings as SyncMapping[],
      detectDeletedSource: source.config.detectDeletedSource && !!source.presentSourceKeys,
      presentSourceKeys: source.presentSourceKeys ? new Set(source.presentSourceKeys) : undefined,
      fxRateByDate,
      fxPendingByDate,
      fxToday: source.fxToday,
      manualFxRates,
    });
  },

  /**
   * A planned transfer whose other account already holds a row that looks like its
   * other side: an unlinked row of the opposite sign within three days and 5% of
   * the amount. Creating the transfer would count the move twice, so it is held
   * unselected and the message says where to link the two instead.
   */
  async reviewPlan(transport: ActualBenchTransport, flow: SyncFlow, plan: SyncPlanResult): Promise<SyncPlanResult> {
    const planned = plan.items.filter((item) => item.action === "create" && item.flags.includes("creates_transfer") && item.plannedTargetPayload?.transferAccountId);
    if (planned.length === 0) return plan;
    void flow;
    const byAccount = new Map<string, SyncPlannedItem[]>();
    for (const item of planned) {
      const accountId = item.plannedTargetPayload?.transferAccountId as string;
      byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), item]);
    }
    const used = new Set<string>();
    const held = new Map<SyncPlannedItem, string>();
    for (const [accountId, items] of byAccount) {
      const dates = items.map((item) => item.plannedTargetPayload?.date as string).sort();
      const rows = (await transport.listTransactionsForSync({
        accountId,
        startDate: shiftDays(dates[0], -TRANSFER_MATCH_DAYS),
        endDate: shiftDays(dates[dates.length - 1], TRANSFER_MATCH_DAYS),
        resolveNames: false,
      })).filter((row) => !row.transferId && !row.isParent && !row.isChild && row.amount !== 0);
      for (const item of items) {
        const payload = item.plannedTargetPayload as PlannedTargetPayload;
        // The other leg Actual would add carries the opposite amount.
        const expected = -payload.amount;
        const match = rows
          .filter((row) => !used.has(row.id) && Math.sign(row.amount) === Math.sign(expected))
          .map((row) => ({ row, days: dayGap(row.date, payload.date), bps: Math.round((Math.abs(Math.abs(row.amount) - Math.abs(expected)) * 10_000) / Math.abs(expected)) }))
          .filter((entry) => entry.days <= TRANSFER_MATCH_DAYS && entry.bps <= TRANSFER_MATCH_BPS)
          .sort((a, b) => a.bps - b.bps || a.days - b.days)[0];
        if (!match) continue;
        used.add(match.row.id);
        const name = payload.transferAccountName ?? "The other account";
        held.set(item, `${name} already has ${formatMinor(match.row.amount)} on ${match.row.date}, which looks like the other side of this transfer. Creating it would count the move twice, so it is not selected. Select it only if they are different, or link the two in the currency panel after syncing.`);
      }
    }
    if (held.size === 0) return plan;
    return {
      ...plan,
      items: plan.items.map((item) => {
        const message = held.get(item);
        return message ? { ...item, selectedForApply: false, flags: [...item.flags, "transfer_may_duplicate"], message: [item.message, message].filter(Boolean).join(" · ") } : item;
      }),
    };
  },

  sourceSummary(flow: SyncFlow): JsonObject {
    const config = decodeFlowPlanConfig(flow);
    return {
      accountId: config.sourceAccountId,
      budgetId: config.sourceBudgetId,
      connectionFingerprint: config.sourceConnectionFingerprint,
    };
  },

  buildSummary(plan: SyncPlanResult, stats): AdapterSummary {
    const c = plan.counts;
    const autoMapped = plan.items.filter((i) => i.flags.includes("exact_duplicate_auto_map")).length;
    const dup = (c.exact_duplicate ?? 0) + (c.strong_duplicate ?? 0) + (c.weak_duplicate ?? 0) - autoMapped;
    return {
      sourceTransactionsScanned: stats.scanned,
      generatedTransactionsExcluded: stats.generatedExcluded,
      sourceItemsScanned: stats.expandedCount,
      sourceItemsFilteredOut: stats.expandedCount - stats.keptCount,
      plannedItems: plan.items.length,
      createCandidates: c.new ?? 0,
      alreadySynced: c.already_synced ?? 0,
      duplicatesSkipped: Math.max(0, dup),
      exactDuplicatesAutoMapped: autoMapped,
      sourceChangedWarnings: c.source_changed_since_sync ?? 0,
      targetMarkerMatches: c.target_marker_match ?? 0,
      blocked: c.blocked ?? 0,
      targetMissing: c.target_missing ?? 0,
    };
  },

  async prepareApply(transport: ActualBenchTransport, flow: SyncFlow): Promise<AdapterApplyContext> {
    const config = decodeFlowPlanConfig(flow);
    // One read serves the marker index and every repair's baseline.
    const liveTargets = await readTargetRows(transport, config.targetAccountId);
    const markerIndex = new Map<string, string>();
    for (const [id, row] of liveTargets) {
      if (row.importedId && !markerIndex.has(row.importedId)) markerIndex.set(row.importedId, id);
    }
    return { markerIndex, liveTargets };
  },

  assertCanApply(caps: SyncCapabilitySet, willCreate: boolean): void {
    if (!willCreate) return;
    if (!caps.createTransaction || !caps.createTransactionWithImportedId) {
      throw new SyncKindError("unsupported_connection", "Target cannot create transactions with a durable marker.");
    }
  },

  async createBatch(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterCreateInput[]
  ): Promise<AdapterCreateResult[]> {
    const config = decodeFlowPlanConfig(flow);
    const createInputs: SyncTargetTransactionInput[] = inputs.map(({ payload }) => ({
      accountId: config.targetAccountId,
      date: String(payload.date ?? ""),
      amount: Number(payload.amount ?? 0),
      payeeId: (payload.payeeId as string | null) ?? null,
      payeeName: (payload.payeeName as string | null) ?? null,
      categoryId: (payload.categoryId as string | null) ?? null,
      notes: (payload.notes as string | null) ?? null,
      cleared: payload.cleared === true,
      importedId: (payload.importedId as string | null) ?? null,
      subtransactions: Array.isArray(payload.subtransactions)
        ? (payload.subtransactions as SyncTargetSplitChild[])
        : null,
    }));
    const { created } = await transport.createTransactionsForSync(createInputs);
    // A split's baseline covers its lines, which the create result does not return.
    let splitRows: Awaited<ReturnType<typeof readTargetRows>> | null = null;
    if (createInputs.some((input) => input.subtransactions?.length)) {
      splitRows = await readTargetRows(transport, config.targetAccountId).catch(() => null);
    }
    return inputs.map((input, i) => {
      const res = created[i];
      const actual = res?.applied ?? null;
      const lines = res?.transactionId ? splitRows?.get(res.transactionId)?.splitLines : undefined;
      const changedFields = actual
        ? diffPlannedVsActual(input.payload, res?.resolvedPayeeId ?? (input.payload.payeeId as string | null) ?? null, actual)
        : [];
      return {
        itemId: input.itemId,
        targetId: res?.transactionId ?? null,
        changedFields,
        targetFingerprint: actual ? targetBaseline({ ...actual, splitLines: lines }) : null,
      };
    });
  },

  async updateBatch(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterMutateInput[],
    options?: AdapterWriteOptions
  ): Promise<AdapterMutateResult[]> {
    const config = decodeFlowPlanConfig(flow);
    const results: AdapterMutateResult[] = [];
    // Read by id from one account read: the row may still be on its old date when
    // the source date changed.
    const liveRows = await readTargetRows(transport, config.targetAccountId);
    const payeeAccounts = transferAccountsOf(transport);
    const plainWrites: { input: AdapterMutateInput; fields: BatchTransactionUpdate; baseline: string; liveDate: string }[] = [];
    // Set once anything has waited since `liveRows` was read.
    let readIsOld = false;

    for (const input of inputs) {
      if (options?.shouldStop?.()) {
        results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Apply stopped before this row; left unchanged." });
        continue;
      }
      // Per-item try/catch: one failed target write must not discard the results
      // of items already updated earlier in the batch.
      try {
        const payload = input.payload ?? {};
        const live = liveRows.get(input.targetId);
        if (!live) {
          results.push({ itemId: input.itemId, outcome: "skipped", targetId: null, message: "Target no longer exists; not updated." });
          continue;
        }
        // Without a recorded baseline we cannot prove the target is unmodified, so
        // refuse to overwrite it (RD-057 §4). With one, only overwrite a match.
        if (!input.expectedTargetFingerprint) {
          results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "No sync baseline for this target; left unchanged." });
          continue;
        }
        if (!targetMatchesBaseline(live, input.expectedTargetFingerprint)) {
          results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Target was edited outside sync; left unchanged." });
          continue;
        }
        // A linked transfer's amount and notes are shared with its other leg.
        if (live.transferId) {
          readIsOld = true;
          results.push(await updateLinkedTransfer(transport, config.targetAccountId, input, live, payeeAccounts, options?.shouldStop));
          continue;
        }
        const keepPayee = payload.keepTargetPayee === true;
        const plannedCategory = (payload.categoryId as string | null) ?? null;
        const date = String(payload.date ?? live.date);
        const amount = Number(payload.amount ?? live.amount);
        const notes = (payload.notes as string | null) ?? null;
        const plannedLines = Array.isArray(payload.subtransactions) ? (payload.subtransactions as PlannedLine[]) : null;
        if (plannedLines) {
          const problem = splitUpdateProblem(live, plannedLines);
          if (problem) {
            results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: problem });
            continue;
          }
        }
        // Resolved first so the baseline below can state exactly what was written.
        const payeeName = (payload.payeeName as string | null) ?? null;
        let payeeId = keepPayee ? live.payeeId : (payload.payeeId as string | null) ?? null;
        if (!keepPayee && !payeeId && payeeName) {
          readIsOld = true;
          payeeId = (await transport.createOrResolvePayee({ name: payeeName })).id;
        }
        // A split is written line by line straight away, so it is read again first
        // if anything waited since the account read. Its checks, write and rollback
        // all use that copy.
        let target = live;
        if (plannedLines && readIsOld) {
          const fresh = (await readTargetRows(transport, config.targetAccountId, live.date)).get(input.targetId);
          if (options?.shouldStop?.()) {
            results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Apply stopped before this row; left unchanged." });
            continue;
          }
          const problem = !fresh
            ? "Target was edited or removed outside sync; left unchanged."
            : fresh.transferId || !targetMatchesBaseline(fresh, input.expectedTargetFingerprint)
              ? "Target was edited outside sync; left unchanged."
              : splitUpdateProblem(fresh, plannedLines);
          if (problem || !fresh) {
            results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: problem ?? "Target was edited outside sync; left unchanged." });
            continue;
          }
          target = fresh;
        }
        // Category and cleared state belong to the target budget. A category is only
        // filled in when the target row has none. A split's category is on its lines.
        const categoryId = !plannedLines && live.categoryId == null && plannedCategory ? plannedCategory : undefined;
        // The baseline is what this sync wrote. A later read could include someone
        // else's edit and would then let the next update overwrite it.
        const baseline = targetBaseline({
          ...target,
          date,
          amount,
          payeeId,
          notes,
          splitLines: plannedLines ? plannedLines.map((line) => ({ amount: line.amount, notes: line.notes ?? null })) : undefined,
        });
        if (plannedLines) {
          readIsOld = true;
          const finished = await updateSplit(
            transport,
            config.targetAccountId,
            date,
            target,
            plannedLines,
            () => transport.updateTransactionForSync({ transactionId: input.targetId, accountId: config.targetAccountId, date, amount, payeeId: keepPayee ? undefined : payeeId, notes, returnApplied: false }),
            async () => {
              // Lines already written may be on the new date, the rest on the old one.
              const row = (await readTargetRows(transport, config.targetAccountId, target.date, date)).get(input.targetId);
              return new Map((row?.splitLines ?? []).map((line) => [line.id as string, line]));
            },
            options?.shouldStop
          );
          results.push(finished
            ? { itemId: input.itemId, outcome: "updated", targetId: input.targetId, targetFingerprint: baseline }
            : { itemId: input.itemId, outcome: "failed", targetId: input.targetId, message: "Apply stopped part-way through this split. Check it in Actual." });
          continue;
        }
        plainWrites.push({
          input,
          baseline,
          liveDate: live.date,
          fields: { id: input.targetId, date, amount, ...(keepPayee ? {} : { payeeId }), ...(categoryId ? { categoryId } : {}), notes },
        });
      } catch (err) {
        results.push({ itemId: input.itemId, outcome: "failed", targetId: input.targetId, message: describeSyncError(err, "Update failed.") });
      }
    }

    // Anything that waited since the read may have let someone edit a queued row.
    let queued = plainWrites;
    if (readIsOld && queued.length > 0) {
      const fresh = await readTargetRows(transport, config.targetAccountId).catch(() => null);
      if (!fresh) {
        // Splits already written keep their results; the queued rows were not written.
        for (const { input } of plainWrites) {
          results.push({ itemId: input.itemId, outcome: "failed", targetId: input.targetId, message: "Could not read the target account again; left unchanged." });
        }
        return results;
      }
      queued = plainWrites.flatMap((write) => {
        const { input } = write;
        const row = fresh.get(input.targetId);
        if (row && !row.transferId && targetMatchesBaseline(row, input.expectedTargetFingerprint as string)) {
          // The fingerprint leaves out the category, so a category set meanwhile must be kept.
          return [row.categoryId != null ? withoutCategory(write) : write];
        }
        results.push({ itemId: input.itemId, outcome: "skipped", targetId: row ? input.targetId : null, message: row ? "Target was edited outside sync; left unchanged." : "Target no longer exists; not updated." });
        return [];
      });
    }

    // One write for the whole set where the transport can do it; one at a time otherwise.
    let batched = false;
    if (queued.length > 1 && transport.batchWriteTransactionsForSync && !options?.shouldStop?.()) {
      try {
        await transport.batchWriteTransactionsForSync({ updated: queued.map((write) => write.fields), deleted: [] });
        batched = true;
      } catch {
        // An unsupported surface: fall through to writing one at a time.
      }
    }
    for (const { input, fields, baseline, liveDate } of queued) {
      if (!batched && options?.shouldStop?.()) {
        results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Apply stopped before this row; left unchanged." });
        continue;
      }
      try {
        if (!batched) {
          // One at a time takes longer, so each row is checked just before its write.
          const current = await transport.readTargetTransactionForSync({ accountId: config.targetAccountId, transactionId: input.targetId, date: liveDate });
          if (!current || !targetMatchesBaseline(current, input.expectedTargetFingerprint as string)) {
            results.push({ itemId: input.itemId, outcome: "skipped", targetId: current ? input.targetId : null, message: current ? "Target was edited outside sync; left unchanged." : "Target no longer exists; not updated." });
            continue;
          }
          if (options?.shouldStop?.()) {
            results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Apply stopped before this row; left unchanged." });
            continue;
          }
          await transport.updateTransactionForSync({
            transactionId: input.targetId,
            accountId: config.targetAccountId,
            date: fields.date as string,
            amount: fields.amount as number,
            payeeId: fields.payeeId,
            categoryId: current.categoryId != null ? undefined : fields.categoryId,
            notes: fields.notes,
            returnApplied: false,
          });
        }
        results.push({ itemId: input.itemId, outcome: "updated", targetId: input.targetId, targetFingerprint: baseline });
      } catch (err) {
        results.push({ itemId: input.itemId, outcome: "failed", targetId: input.targetId, message: describeSyncError(err, "Update failed.") });
      }
    }
    return results;
  },

  async deleteBatch(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterMutateInput[],
    options?: AdapterWriteOptions
  ): Promise<AdapterMutateResult[]> {
    const config = decodeFlowPlanConfig(flow);
    const results: AdapterMutateResult[] = [];
    const liveRows = await readTargetRows(transport, config.targetAccountId);
    const payeeAccounts = transferAccountsOf(transport);
    const toDelete: AdapterMutateInput[] = [];
    for (const input of inputs) {
      const live = liveRows.get(input.targetId);
      if (!live) {
        results.push({ itemId: input.itemId, outcome: "skipped", targetId: null, message: "Target already gone." });
      } else if (!input.expectedTargetFingerprint) {
        // Only delete a target we can prove is exactly what sync wrote: no baseline
        // (or a mismatch) means it may have been re-used/edited - never delete it.
        results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "No sync baseline for this target; not deleted." });
      } else if (!targetMatchesBaseline(live, input.expectedTargetFingerprint)) {
        results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Target was edited outside sync; not deleted." });
      } else if (live.transferId) {
        // Deleting one leg of a linked transfer deletes the other account's row too.
        const problem = await linkedTransferDeleteProblem(transport, input, live, payeeAccounts);
        if (problem) results.push(problem);
        else toDelete.push(input);
      } else {
        toDelete.push(input);
      }
    }
    let batched = false;
    // Set once a batch was tried or a delete was sent: from then on each row is read
    // again (its day of the account) and checked just before its own delete.
    let readIsOld = false;
    if (toDelete.length > 1 && transport.batchWriteTransactionsForSync && !options?.shouldStop?.()) {
      readIsOld = true;
      try {
        await transport.batchWriteTransactionsForSync({ updated: [], deleted: toDelete.map((input) => input.targetId) });
        batched = true;
      } catch {
        // An unsupported surface: fall through to deleting one at a time.
      }
    }
    for (const input of toDelete) {
      if (!batched && options?.shouldStop?.()) {
        results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Apply stopped before this row; not deleted." });
        continue;
      }
      // Per-item try/catch so one failed delete doesn't discard earlier successes.
      try {
        if (!batched) {
          if (readIsOld) {
            const date = (liveRows.get(input.targetId) as AdapterLiveTarget).date;
            const current = (await readTargetRows(transport, config.targetAccountId, date)).get(input.targetId);
            const problem = !current
              ? "Target is gone or was moved to another date; not deleted."
              : !targetMatchesBaseline(current, input.expectedTargetFingerprint as string)
                ? "Target was edited outside sync; not deleted."
                : current.transferId && !input.ownsTransferLeg
                  ? "Target is a linked transfer; not deleted."
                  : options?.shouldStop?.()
                    ? "Apply stopped before this row; not deleted."
                    : null;
            if (problem) {
              results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: problem });
              continue;
            }
          }
          readIsOld = true;
          await transport.deleteTransactionForSync({ transactionId: input.targetId });
        }
        results.push({ itemId: input.itemId, outcome: "deleted", targetId: input.targetId });
      } catch (err) {
        results.push({ itemId: input.itemId, outcome: "failed", targetId: input.targetId, message: describeSyncError(err, "Delete failed.") });
      }
    }
    return results;
  },
};

function assertConnectionMatches(savedBudgetId: string, connection: AdapterValidateInput["sourceConnection"], side: "source" | "target"): void {
  if (!savedBudgetId) return;
  // Match on the budget's stable id, not the mode/URL fingerprint, so a flow
  // built in Direct mode also runs in HTTP mode against the same budget.
  if (!connectionMatchesBudget(connection, savedBudgetId)) {
    throw new SyncKindError("connection_mismatch", `The ${side} connection is not the budget this flow was saved for.`);
  }
}

registerSyncKindAdapter(transactionAdapter);
