"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Landmark, RefreshCw, Settings2, Plus } from "lucide-react";
import { FEATURES } from "@/lib/features/catalogue";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import { linkedExternalAccountIds, readExternal } from "@/lib/asset-registry/cashflows";
import { performance } from "@/lib/asset-registry/performance";
import { averageYearlyYield, yearsBetween } from "@/lib/asset-registry/yields";
import { valueBridge } from "@/lib/asset-registry/valueBridge";
import { IncomeExpensesTab } from "./IncomeExpensesTab";
import { CapitalEditor } from "./CapitalEditor";
import { DepreciationPanel } from "./DepreciationPanel";
import { depreciationSchedule, forecastMonths, periodStatuses } from "@/lib/asset-registry/depreciation";
import { capitalMovements } from "@/lib/asset-registry/capitalMovements";
import { financingEvents, type OperatingEntry } from "./timeline";
import { earliestDate } from "./dateRange";
import { DEFAULT_CHART_PREFS, type BookFocus, type CashflowFocus } from "./TimelineSection";
import { DepreciationEditor } from "./DepreciationEditor";
import { FinancingPanel } from "./FinancingPanel";
import { getLoanSummary, listDebts } from "@/features/assets-debt/lib/debtsApi";
import { datedBalanceFromTransactions, readAccountLedger, toDebtMagnitude } from "@/lib/assets-debt/actual/ledgerPort";
import { trackedEquity, type DatedDebt } from "@/lib/asset-registry/financing";
import { percent } from "./ReportControls";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageLayout } from "@/components/layout/PageLayout";
import { DataTable, Stack, Text, type Column, type SortState } from "@/features/credit-cards/components/primitives/DataTable";
import { useConnectionStore, selectActiveInstance, type ConnectionInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";
import { useAccountClasses } from "@/features/accounts/hooks/useAccountClasses";
import { getTransport } from "@/lib/actual";
import { ASSET_TYPES, eligibility, ownershipAt, type Asset, type Registry } from "@/lib/asset-registry/models";
import { attributeBook, readBook, sumMinor } from "@/lib/asset-registry/ledger";
import { freshActionContext } from "@/lib/asset-registry/actions";
import { bankToday } from "@/features/credit-cards/lib/cycles";
import type { AccountClass } from "@/lib/account-class";
import { pruneRequest, registryRequest } from "./api";
import { buildPruneEvidence, planPrune, pruneSize } from "@/lib/asset-registry/prune";
import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { AssetEditor } from "./AssetEditor";
import { BookPanel, type BookView } from "./BookPanel";
import { AssetOverview } from "./AssetOverview";
import { AssetCreateDrawer } from "./AssetCreateDrawer";
import { AssetGuide, guideSectionForTab, type AssetGuideSection } from "./AssetGuide";
import { AssetMark, AttentionBadge, EmptyState, NA, SummaryStrip, assetMoney, bookTypeLabel, type AssetAttention } from "./AssetPresentation";
import { readTime } from "@/features/credit-cards/components/primitives/format";

export function AssetWorkspace({ assetId }: { assetId?: string }) {
  const connection = useConnectionStore(selectActiveInstance);
  if (!connection) return <PageLayout title="Assets"><p className="p-6 text-sm text-muted-foreground">Connect to a budget to open the Asset Registry.</p></PageLayout>;
  return <ConnectedAssets key={connection.id} connection={connection} assetId={assetId} />;
}
function ConnectedAssets({ connection, assetId }: { connection: ConnectionInstance; assetId?: string }) {
  const client = useQueryClient();
  const date = bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const router = useRouter();
  const [capitalKind, setCapitalKind] = useState<"payment" | "dispose" | null>(null);
  const [financialUnknown, setFinancialUnknown] = useState(false);
  const [depreciationEditing, setDepreciationEditing] = useState(false);
  const [asOf, setAsOf] = useState(date);
  const [bookView, setBookView] = useState<BookView>("asset");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [type, setType] = useState("");
  const [tab, setTab] = useState("Overview");
  /** A period (and types) chosen by clicking a chart event; the tables show a filter chip with Clear while it is set. */
  const [bookFocus, setBookFocus] = useState<BookFocus | null>(null); const [cashFocus, setCashFocus] = useState<CashflowFocus | null>(null);
  /** The Overview charts' choices (Monthly / Yearly, lines shown, smoothing), kept here so they survive switching tabs. */
  const [chartPrefs, setChartPrefs] = useState(DEFAULT_CHART_PREFS);
  const [guide, setGuide] = useState<AssetGuideSection | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });
  const [editorAsset, setEditorAsset] = useState<Asset | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  /** How many saved links were dropped because Actual no longer has their transaction; shown until dismissed. */
  const [droppedCount, setDroppedCount] = useState(0); const pruning = useRef(false);
  const [linkedAccountsOpen, setLinkedAccountsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const docsUrl = FEATURES.find((f) => f.id === "assets")?.docsUrl;
  const classes = useAccountClasses();
  const transport = getTransport(connection);
  const key = ["assetRegistry", connection.id, connection.budgetSyncId];
  const query = useQuery({ queryKey: key, queryFn: () => registryRequest(connection.budgetSyncId) });
  const accountsQuery = useQuery({ queryKey: ["accounts", connection.id], queryFn: () => transport.getAccounts() });
  const registry = query.data ?? { assets: [], metadata: [] };
  const accounts = accountsQuery.data ?? [];
  const accountIds = [...new Set(registry.assets.map((a) => a.actualAccountId))].sort();
  const bookQueries = useQueries({ queries: accountIds.map((accountId) => ({
    queryKey: ["assetBook", connection.id, connection.budgetSyncId, accountId, date],
    queryFn: () => readBook(getTransport(connection), accountId, date), enabled: query.isSuccess && accountsQuery.isSuccess,
  })) });
  const books = new Map(accountIds.map((id, index) => [id, bookQueries[index]]));
  // Each account read has a fixed cost: read only the accounts that hold links, never the whole budget.
  const linkedAccountIds = linkedExternalAccountIds(registry, accountIds);
  const externalQuery = useQuery({ queryKey: ["assetExternal", connection.id, connection.budgetSyncId, accountIds.join("|"), linkedAccountIds.join("|")], queryFn: () => readExternal(getTransport(connection), accountIds, linkedAccountIds), enabled: query.isSuccess && accountsQuery.isSuccess });
  const payeesQuery = useQuery({ queryKey: ["assetPayees", connection.id], queryFn: () => getTransport(connection).getPayees(), enabled: query.isSuccess && !!assetId });
  /** Actual's categories: whether a linked row is income follows its category type, and the payment panel lists the expense ones. */
  const categoryQuery = useQuery({ queryKey: ["assetPaymentCategories", connection.id], queryFn: () => getTransport(connection).getCategoryGroups(), enabled: query.isSuccess && !!assetId });
  const loansQuery = useQuery({ queryKey: ["assetLoans", connection.id, connection.budgetSyncId], queryFn: () => listDebts(connection.budgetSyncId, true), enabled: query.isSuccess });
  const loans = loansQuery.data ?? [];
  const linkedDebtIds = [...new Set((registry.debtLinks ?? []).map((l) => l.debtId))].sort();
  const ledgerQueries = useQueries({ queries: linkedDebtIds.map((debtId) => {
    const accountId = loans.find((d) => d.id === debtId)?.liabilityAccountId ?? null;
    return { queryKey: ["assetLoanLedger", connection.id, connection.budgetSyncId, accountId], enabled: loansQuery.isSuccess && !!accountId,
      queryFn: async () => { const read = await readAccountLedger(getTransport(connection), { accountId: accountId! }); if (!read.ok) throw new Error(read.message); return read.transactions; } };
  }) });
  /** Each linked loan's regular repayment, from Loans & Debt, for the Linked Loans tab. */
  const summaryQueries = useQueries({ queries: linkedDebtIds.map((debtId) => ({
    queryKey: ["assetLoanSummary", connection.id, connection.budgetSyncId, debtId, date],
    queryFn: async () => (await getLoanSummary(debtId, { today: date })).summary, enabled: loansQuery.isSuccess && !!assetId, retry: false,
  })) });
  const repayments = Object.fromEntries(linkedDebtIds.map((id, index) => [id, summaryQueries[index]?.isSuccess ? summaryQueries[index].data.regularRepaymentMinor : summaryQueries[index]?.isError ? null : undefined]));
  const asset = registry.assets.find((a) => a.id === assetId);
  const currentQuery = asset ? books.get(asset.actualAccountId) : undefined;
  const snapshot = currentQuery?.isSuccess ? currentQuery.data : undefined;
  const book = snapshot ? attributeBook(snapshot, registry.assets, registry.metadata) : undefined;
  const reason = asset ? eligibility(accounts.find((a) => a.id === asset.actualAccountId), asset.assetType, classes.maps) : null;
  const available = query.isSuccess && accountsQuery.isSuccess && classes.available;
  const value = (a: Asset): number | null => {
    const q = books.get(a.actualAccountId);
    if (!q?.isSuccess || !q.data || !available) return null;
    const result = attributeBook(q.data, registry.assets, registry.metadata);
    return result.available ? result.totals.get(a.id) ?? null : null;
  };
  /** Recorded owned value from this asset's Actual book rows on or before a date; null when unavailable. */
  const valueAt = (a: Asset, on: string): number | null => {
    const q = books.get(a.actualAccountId);
    if (!q?.isSuccess || !q.data || !available) return null;
    const result = attributeBook({ ...q.data, rows: q.data.rows.filter((r) => r.date <= on) }, registry.assets, registry.metadata);
    return result.available ? result.totals.get(a.id) ?? null : null;
  };
  /** Positive Actual debt per linked loan on a date from its liability account's own ledger; never a loan forecast. */
  const debtsAt = (on: string): DatedDebt[] => linkedDebtIds.map((debtId, index) => {
    const loan = loans.find((d) => d.id === debtId); const q = ledgerQueries[index];
    if (!loan?.liabilityAccountId || !q?.isSuccess || !q.data) return { debtId, magnitudeMinor: null };
    const dated = datedBalanceFromTransactions(loan.liabilityAccountId, q.data, on);
    return { debtId, magnitudeMinor: toDebtMagnitude(dated.balanceMinor, loan.signConvention as "negative-is-debt" | "positive-is-debt") };
  });
  /** Any loan's Actual debt (positive) on a date, read from its liability account; for the link dialog's preview. */
  const loanBalanceAt = async (debtId: string, on: string): Promise<number | null> => {
    const loan = loans.find((d) => d.id === debtId);
    if (!loan?.liabilityAccountId) return null;
    const read = await readAccountLedger(getTransport(connection), { accountId: loan.liabilityAccountId });
    if (!read.ok) return null;
    return toDebtMagnitude(datedBalanceFromTransactions(loan.liabilityAccountId, read.transactions, on).balanceMinor, loan.signConvention as "negative-is-debt" | "positive-is-debt");
  };
  const equityOf = (a: Asset, on: string) => trackedEquity(a.id, on, registry.debtLinks ?? [], valueAt(a, on), debtsAt(on));
  /** Worked out once per asset per render: it runs the attribution and the performance report. */
  const attentionCache = new Map<string, AssetAttention>();
  const attention = (a: Asset): AssetAttention => { let known = attentionCache.get(a.id); if (!known) { known = computeAttention(a); attentionCache.set(a.id, known); } return known; };
  const computeAttention = (a: Asset): AssetAttention => {
    if (a.status === "archived") return { label: "Archived", tone: "neutral", detail: "Archived assets are not checked for attention" };
    const q = books.get(a.actualAccountId);
    if (!available || !q?.isSuccess || !q.data) return { label: "Unavailable", tone: "danger", detail: "Refresh to read the account book" };
    const result = attributeBook(q.data, registry.assets, registry.metadata);
    if (report(a)?.gaps.length) return { label: "Needs review", tone: "attention", detail: report(a)!.gaps[0] };
    const invalid = eligibility(accounts.find((row) => row.id === a.actualAccountId), a.assetType, classes.maps);
    if (invalid || result.issues.length) return { label: "Needs review", tone: "attention", detail: invalid ?? result.issues[0] };
    if (result.rows.some((r) => !r.assetId)) return { label: "Unassigned rows", tone: "attention", detail: "Some account rows need attribution" };
    const count = result.rows.filter((r) => r.assetId === a.id && bookTypeLabel(r.classification) === "Unclassified").length;
    return count ? { label: "Unclassified", tone: "attention", detail: `${count} Asset Ledger entries need a type` } : { label: "Current", tone: "success" };
  };
  async function refresh(next?: Registry, inspected = false) {
    setRefreshing(true); setError("");
    try {
      await getTransport(connection).sync();
      if (next) client.setQueryData(key, next); else await query.refetch({ throwOnError: true });
      await accountsQuery.refetch({ throwOnError: true });
      await client.invalidateQueries({ queryKey: ["accountClasses", connection.budgetSyncId] });
      await externalQuery.refetch({ throwOnError: true });
      await client.invalidateQueries({ queryKey: ["assetLoans", connection.id] });
      await client.invalidateQueries({ queryKey: ["assetLoanLedger", connection.id] });
      if (inspected) setFinancialUnknown(false);
      // The known accounts plus those of the registry just saved: an asset created a moment ago has a new account this closure does not know.
      for (const id of new Set([...accountIds, ...(next?.assets ?? []).map((a) => a.actualAccountId)])) await client.invalidateQueries({ queryKey: ["assetBook", connection.id, connection.budgetSyncId, id] });
    } catch (e) { setError(`Could not refresh from Actual: ${e instanceof Error && e.message ? e.message : "the connection did not answer"}.`); }
    finally { setRefreshing(false); }
  }
  async function fresh(actionDate: string) {
    if (!assetId) throw new Error("Choose an asset");
    if (useConnectionStore.getState().activeInstanceId !== connection.id) throw new Error("Active budget changed");
    const context = await freshActionContext(getTransport(connection), assetId, actionDate, () => registryRequest(connection.budgetSyncId));
    const directory = await context.transport.getAccounts();
    const response = await fetch(`/api/account-classes?budgetSyncId=${encodeURIComponent(connection.budgetSyncId)}`);
    if (!response.ok) throw new Error("Could not confirm current account class");
    const records = (await response.json()).accountClasses as { scope: string; accountId: string; accountClass: AccountClass }[];
    const maps = { accounts: new Map(records.filter((r) => r.scope === "account").map((r) => [r.accountId, r.accountClass])), groups: new Map(records.filter((r) => r.scope === "group").map((r) => [r.accountId, r.accountClass])) };
    const invalid = eligibility(directory.find((a) => a.id === context.asset.actualAccountId), context.asset.assetType, maps);
    if (invalid) throw new Error(invalid);
    const pending = useStagedStore.getState().accounts[context.asset.actualAccountId];
    if (pending && (pending.isNew || pending.isUpdated || pending.isDeleted || pending.pendingAccountClass !== undefined || pending.saveError)) throw new Error("Save pending changes to this account in Accounts first");
    if (useConnectionStore.getState().activeInstanceId !== connection.id) throw new Error("Active budget changed");
    return context;
  }
  /** Linked accounts plus just the accounts an action touches, read fresh. */
  async function readTouched(transport: ReturnType<typeof getTransport>, assets: Asset[], touched: string[] = []) {
    const bookIds = [...new Set(assets.map((a) => a.actualAccountId))];
    return readExternal(transport, bookIds, [...new Set([...linkedAccountIds, ...touched])]);
  }
  async function freshCapital(actionDate: string, touched: string[] = []) {
    const context = await fresh(actionDate);
    return { ...context, external: await readTouched(context.transport, context.registry.assets, touched) };
  }
  const ensureExternal = (touched: string[]) => readTouched(transport, registry.assets, touched);
  /** The date of an asset's first linked income or expense row, when Actual still has it. */
  const firstCashDate = (a: Asset): string | undefined => earliestDate(...(registry.cashflows ?? []).filter((m) => m.assetId === a.id).map((m) => externalQuery.data?.rows.find((r) => r.id === m.actualTransactionId && r.accountId === m.actualAccountId)?.date));
  /**
   * Where an asset's history, and every all-time figure, starts: its first ledger entry or its first linked income or expense,
   * whichever is earlier, so "all time" never leaves out a row the Income & Expenses table shows. The ledger's own opening and
   * capital are unaffected: nothing sits in the ledger before its first entry.
   */
  const firstDates = new Map<string, string>();
  const firstDateOf = (a: Asset): string => {
    const known = firstDates.get(a.id); if (known) return known;
    const q = books.get(a.actualAccountId);
    const ledger = q?.isSuccess && q.data && available ? attributeBook(q.data, registry.assets, registry.metadata).rows.filter((r) => r.assetId === a.id).map((r) => r.date).sort()[0] : undefined;
    const first = earliestDate(ledger, firstCashDate(a)) ?? date;
    firstDates.set(a.id, first); return first;
  };
  /** The performance report; the whole history up to today unless dates are given. */
  function report(a: Asset, start = firstDateOf(a), end = date) {
    const snapshot = books.get(a.actualAccountId)?.data;
    return snapshot && externalQuery.data && isIsoDate(start) && isIsoDate(end) && start <= end && end <= date ? performance(a, registry, snapshot, externalQuery.data, start, end) : undefined;
  }
  /** What the value rose by (revaluation and depreciation) against what was put in, over the whole history; null while the book is unavailable. */
  const gains = new Map<string, { gainMinor: number; capitalMinor: number } | null>();
  const gainOf = (a: Asset) => {
    if (gains.has(a.id)) return gains.get(a.id)!;
    const q = books.get(a.actualAccountId); let result: { gainMinor: number; capitalMinor: number } | null = null;
    if (q?.isSuccess && q.data && available) {
      const book = attributeBook(q.data, registry.assets, registry.metadata);
      if (book.available) { const b = valueBridge(book.rows.filter((r) => r.assetId === a.id), null, date); result = { gainMinor: b.revaluationMinor + b.depreciationMinor, capitalMinor: b.capitalMinor }; }
    }
    gains.set(a.id, result); return result;
  };
  const signed = (minor: number) => `${minor > 0 ? "+" : ""}${assetMoney(minor)}`;
  const statusAssets = registry.assets.filter((a) => status === "all" || a.status === status);
  const filtered = statusAssets.filter((a) => (!type || a.assetType === type) && `${a.name} ${accounts.find((r) => r.id === a.actualAccountId)?.name ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  filtered.sort((a, b) => {
    const compare = sort.key === "value" ? (value(a) ?? -Infinity) - (value(b) ?? -Infinity) : sort.key === "change" ? (gainOf(a)?.gainMinor ?? -Infinity) - (gainOf(b)?.gainMinor ?? -Infinity) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    return sort.direction === "asc" ? compare : -compare;
  });
  const open = (a: Asset) => router.push(`/assets/${encodeURIComponent(a.id)}`);
  const membersOf = (a: Asset) => registry.assets.filter((member) => member.actualAccountId === a.actualAccountId);
  const accountRows = accountIds.map((id) => {
    const q = books.get(id);
    const result = q?.isSuccess && q.data ? attributeBook(q.data, registry.assets, registry.metadata) : null;
    return { id, name: accounts.find((a) => a.id === id)?.name ?? "Unavailable account", members: registry.assets.filter((a) => a.actualAccountId === id), snapshot: q?.isSuccess ? q.data : undefined, book: result };
  });
  const reading = externalQuery.isPending;
  // Actual is the truth: once every read is complete and newer than the saved links, drop links to transactions Actual no longer has.
  useEffect(() => {
    const reads = bookQueries.map((q) => q.data);
    const fresh = [externalQuery.dataUpdatedAt, ...bookQueries.map((q) => q.dataUpdatedAt)].every((at) => at >= query.dataUpdatedAt);
    if (pruning.current || refreshing || financialUnknown || !query.isSuccess || !externalQuery.isSuccess || !externalQuery.data || !fresh || bookQueries.some((q) => !q.isSuccess)) return;
    const external = externalQuery.data;
    const evidence = buildPruneEvidence(connection.budgetSyncId, {
      books: accountIds.map((accountId, index) => { const read = reads[index]; return { accountId, complete: !!read && read.issues.length === 0 && read.balanceMinor !== null, ids: read ? [...new Set([...read.source.map((r) => r.id), ...normalizeActivity(read.source).rows.map((r) => r.id)])] : [] }; }),
      directory: external.accounts.map((a) => a.id),
      external: { accountIds: external.readAccountIds ?? [], rows: external.rows, accountIssues: external.accountIssues ?? {} },
    });
    if (pruneSize(planPrune(query.data ?? { assets: [], metadata: [] }, evidence)) === 0) return;
    pruning.current = true;
    void pruneRequest(evidence).then(({ registry: next, dropped }) => { client.setQueryData(key, next); if (dropped > 0) setDroppedCount((n) => n + dropped); }).catch(() => undefined).finally(() => { pruning.current = false; });
  }, [query.dataUpdatedAt, externalQuery.dataUpdatedAt, bookQueries.map((q) => q.dataUpdatedAt).join("|"), refreshing, financialUnknown]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasLinks = (a: Asset) => (registry.debtLinks ?? []).some((l) => l.assetId === a.id);
  const hasCashflows = (a: Asset) => (registry.cashflows ?? []).some((m) => m.assetId === a.id);
  const columns: Column<Asset>[] = [
    { key: "name", header: "Asset", width: 220, grow: true, sortable: true, cell: (a) => <div className="flex min-w-0 items-center gap-2.5"><AssetMark type={a.assetType} /><Link tabIndex={-1} className="truncate font-medium hover:underline" href={`/assets/${encodeURIComponent(a.id)}`} title={a.name}>{a.name}</Link></div> },
    { key: "type", header: "Type", width: 130, cell: (a) => <Text>{ASSET_TYPES[a.assetType as keyof typeof ASSET_TYPES]?.label ?? "Unknown type"}</Text> },
    { key: "account", header: "Linked Actual account", width: 190, cell: (a) => <div className="flex min-w-0 items-center gap-2"><Text>{accounts.find((r) => r.id === a.actualAccountId)?.name ?? "Unavailable"}</Text>{membersOf(a).length > 1 && <AttentionBadge status={{ label: "Shared", tone: "neutral", detail: `${membersOf(a).length} assets share this account` }} />}</div> },
    { key: "value", header: "Recorded value", width: 140, align: "right", sortable: true, cell: (a) => <Stack primary={assetMoney(value(a))} secondary={ownershipAt(a, date) === null ? undefined : `${ownershipAt(a, date)! / 100}% owned`} /> },
    { key: "equity", header: "Equity", width: 140, align: "right", cell: (a) => hasLinks(a) ? <Stack primary={assetMoney(equityOf(a, date).equityMinor)} secondary={`Debt ${assetMoney(equityOf(a, date).allocatedDebtMinor)}`} /> : NA },
    { key: "change", header: "Value gain", width: 140, align: "right", sortable: true, cell: (a) => { const c = gainOf(a); return c ? <Stack primary={signed(c.gainMinor)} secondary={c.capitalMinor > 0 ? `${c.gainMinor > 0 ? "+" : ""}${((c.gainMinor / c.capitalMinor) * 100).toFixed(2)}% of capital` : undefined} /> : NA; } },
    { key: "income", header: "Net cash flow", width: 190, align: "right", cell: (a) => {
      if (!hasCashflows(a)) return NA;
      if (reading) return "…";
      const p = report(a);
      return <Stack primary={assetMoney(p?.operatingMinor)} secondary={a.incomeGenerating ? `Yearly yield on cost ${percent(averageYearlyYield(p?.operatingYield, yearsBetween(firstDateOf(a), date)))}` : undefined} />;
    } },
    { key: "attention", header: "Attention", width: 150, cell: (a) => <AttentionBadge status={attention(a)} /> },
    { key: "actions", header: "Actions", hiddenHeader: true, width: 44, align: "right", sticky: "end", cell: (a) => <Button variant="ghost" size="icon" className="size-7" aria-label={`Settings for ${a.name}`} onClick={() => setEditorAsset(a)}><Settings2 className="size-3.5" /></Button> },
  ];
  const totals = statusAssets.map(value);
  const total = available && totals.every((n) => n !== null) ? sumMinor(totals as number[]) : null;
  const unassigned = available && accountRows.every((r) => r.book?.available) ? sumMinor(accountRows.map((r) => r.book!.unassignedMinor)) : null;
  const reviewCount = statusAssets.filter((a) => attention(a).tone === "attention" || attention(a).tone === "danger").length;
  const linkedAssets = statusAssets.filter(hasLinks);
  const equities = linkedAssets.map((a) => equityOf(a, date));
  const debtTotal = equities.every((e) => e.allocatedDebtMinor !== null) ? sumMinor(equities.map((e) => e.allocatedDebtMinor!)) : null;
  const netEquity = total !== null && (linkedAssets.length === 0 || debtTotal !== null) ? total - (debtTotal ?? 0) : null;
  const gainList = statusAssets.map(gainOf);
  const gainTotal = gainList.every(Boolean) ? sumMinor(gainList.map((g) => g!.gainMinor)) : null;
  const capitalTotal = gainList.every(Boolean) ? sumMinor(gainList.map((g) => g!.capitalMinor)) : null;
  const gainPercent = gainTotal !== null && capitalTotal !== null && capitalTotal > 0 ? (gainTotal / capitalTotal) * 100 : null;
  const cashAssets = statusAssets.filter(hasCashflows);
  const reports = cashAssets.map((a) => report(a));
  const portfolioCashflow = reports.every((p) => p?.operatingMinor != null) ? sumMinor(reports.map((p) => p!.operatingMinor!)) : null;
  const operatingEntries: OperatingEntry[] = asset && externalQuery.data ? (registry.cashflows ?? []).filter((m) => m.assetId === asset.id && !m.classification && !m.context).flatMap((m) => {
    const row = externalQuery.data!.rows.find((r) => r.id === m.actualTransactionId && r.accountId === m.actualAccountId);
    const category = categoryQuery.data?.categories.find((c) => c.id === row?.categoryId);
    return row && !row.transferId && row.amountMinor !== 0 ? [{ date: row.date, category: row.categoryName ?? "Uncategorized", amountMinor: row.amountMinor, income: category ? category.isIncome : row.amountMinor > 0 }] : [];
  }) : [];
  const capitalEntries = asset && snapshot && externalQuery.data ? capitalMovements(asset, registry, snapshot, externalQuery.data) : [];
  const schedule = asset ? registry.depreciation?.find((d) => d.assetId === asset.id) : undefined;
  const scheduleRows = asset && schedule && snapshot ? periodStatuses(depreciationSchedule(schedule, forecastMonths(schedule, date)), registry.metadata, asset.id, new Set(snapshot.source.map((r) => r.id)), date) : [];
  const depreciationDue = scheduleRows.filter((r) => r.state === "due").length;
  const unpostedMonths = scheduleRows.filter((r) => r.amountMinor > 0 && (r.state === "due" || r.state === "forecast")).map((r) => ({ postDate: r.postDate, amountMinor: r.amountMinor }));
  const links = registry.debtLinks ?? [];
  const firstLink = asset ? links.filter((l) => l.assetId === asset.id).map((l) => l.effectiveFrom).sort()[0] : undefined;
  const debtAtDate = (on: string): number | null => !asset || !firstLink || on < firstLink ? null : trackedEquity(asset.id, on, links, null, debtsAt(on)).allocatedDebtMinor;
  /** Where the Overview and Income & Expenses start (a loan allocation still starts from the first ledger entry, `firstBookDate`). */
  const historyStart = asset ? firstDateOf(asset) : date;
  const firstBookDate = asset && book ? book.rows.filter((r) => r.assetId === asset.id).map((r) => r.date).sort()[0] ?? date : date;
  const financingTimeline = asset ? financingEvents(links.filter((l) => l.assetId === asset.id), (id) => loans.find((d) => d.id === id)?.name ?? "Loan") : [];
  const capitalContext = asset && snapshot && externalQuery.data ? { asset, registry, snapshot, transport, external: externalQuery.data } : undefined;
  const lastRead = accountRows.flatMap((r) => r.snapshot ? [r.snapshot.fetchedAt] : []).sort().at(-1);
  const openBook = (view: BookView = "asset") => { setBookFocus(null); setBookView(view); setTab("Asset Ledger"); };
  const tabs = ["Overview", "Asset Ledger", "Income & Expenses", "Linked Loans", "Depreciation Schedule"];
  const editingContext = editorAsset ? accountRows.find((r) => r.id === editorAsset.actualAccountId) : undefined;
  const accountColumns: Column<typeof accountRows[number]>[] = [
    { key: "name", header: "Actual account", width: 200, cell: (r) => <Text title={r.name}>{r.name}</Text> },
    { key: "assets", header: "Assets", width: 280, grow: true, cell: (r) => <Text title={r.members.map((a) => a.name).join(", ")}>{r.members.length > 1 ? `Shared · ${r.members.map((a) => a.name).join(", ")}` : r.members[0]?.name ?? "-"}</Text> },
    { key: "assigned", header: "Attributed", width: 120, align: "right", cell: (r) => assetMoney(r.book?.available ? sumMinor([...r.book.totals.values()]) : null) },
    { key: "unassigned", header: "Unassigned", width: 120, align: "right", cell: (r) => assetMoney(r.book?.available ? r.book.unassignedMinor : null) },
    { key: "balance", header: "Account balance", width: 140, align: "right", cell: (r) => assetMoney(r.snapshot?.balanceMinor) },
    { key: "state", header: "State", width: 150, cell: (r) => <AttentionBadge status={!r.book?.available ? { label: "Unavailable", tone: "danger" } : r.book.issues.length ? { label: "Needs review", tone: "attention" } : r.book.rows.some((row) => !row.assetId) ? { label: "Review unassigned", tone: "attention" } : { label: "Reconciles", tone: "success" }} /> },
  ];
  const needReview = accountRows.filter((r) => !r.book?.available || r.book.issues.length > 0 || r.book.rows.some((row) => !row.assetId)).length;
  const header = <header aria-label="Asset workspace" className="shrink-0 border-b border-border">
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {assetId && <Button nativeButton={false} render={<Link href="/assets" />} variant="outline" size="xs"><ArrowLeft className="size-3.5" aria-hidden />All assets</Button>}
        {asset && <AssetMark type={asset.assetType} header />}
        <div className="min-w-0"><h1 className="truncate text-base font-semibold" title={assetId ? asset?.name : undefined}>{assetId ? asset?.name ?? "Asset" : "Assets"}{asset?.status === "archived" && <span className="ml-2 text-xs font-normal text-muted-foreground">Archived</span>}</h1>
          {asset && <p className="truncate text-xs text-muted-foreground">{`${ASSET_TYPES[asset.assetType as keyof typeof ASSET_TYPES]?.label ?? "Unknown type"} · ${accounts.find((a) => a.id === asset.actualAccountId)?.name ?? "Unavailable account"} · ${ownershipAt(asset, date) === null ? "Unknown ownership" : `${ownershipAt(asset, date)! / 100}% owned`}${membersOf(asset).length > 1 ? ` · Shared account${asset.assetTag ? ` · ${asset.assetTag}` : ""}` : ""}`}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span role="status" className="text-xs text-muted-foreground">{refreshing ? "Refreshing…" : lastRead ? `Read from Actual ${readTime(lastRead)}` : "Reading Actual…"}</span>
        <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh(undefined, true)}><RefreshCw className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />Refresh</Button>
        <Button variant="outline" size="sm" onClick={() => setGuide(guideSectionForTab(asset ? tab : null))}><BookOpen className="size-3.5" aria-hidden />Guide</Button>
        {!assetId && <Button size="sm" variant="outline" onClick={() => setLinkedAccountsOpen(true)}>Linked accounts</Button>}
        <Button size="sm" variant={assetId ? "outline" : "default"} disabled={!available || (assetId ? !asset : false)} onClick={() => { if (asset) setEditorAsset(asset); else setCreating(true); }}>{assetId ? <Settings2 className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}{assetId ? "Settings" : "Add Asset"}</Button>
      </div>
    </div>
    {asset && <TabsList aria-label="Asset workspace" className="gap-1 overflow-x-auto border-0 px-3">{tabs.map((name) => <TabsTrigger key={name} value={name} className="h-9 shrink-0 gap-1.5 whitespace-nowrap px-2 text-[13px]">{name}{name === "Asset Ledger" && book && (book.issues.length > 0 || book.rows.some((r) => !r.assetId || (r.assetId === asset.id && bookTypeLabel(r.classification) === "Unclassified"))) && <span className="size-1.5 rounded-full bg-staged-updated" aria-label="Needs attention" />}</TabsTrigger>)}</TabsList>}
  </header>;
  const guideDialog = guide && <AssetGuide section={guide} onSection={setGuide} onClose={() => setGuide(null)} docsUrl={docsUrl} />;
  return <Tabs className="min-h-0 flex-1" value={tab} onValueChange={(value) => setTab(String(value))}><PageLayout scrollManaged header={header}>
    {query.isPending || accountsQuery.isPending ? <p role="status" className="p-4 text-sm">Loading assets…</p> : !available ? <p role="alert" className="border-b p-3 text-sm text-destructive">Asset data or account classes are unavailable. Refresh to retry.</p> : null}
    {droppedCount > 0 && <div role="status" className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs"><span>Cleaned up {droppedCount} saved {droppedCount === 1 ? "link" : "links"} to transactions that are no longer in Actual.</span><Button size="xs" variant="ghost" className="ml-auto" onClick={() => setDroppedCount(0)}>Dismiss</Button></div>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"><span>{error}{lastRead ? ` Showing data read from Actual at ${readTime(lastRead)}.` : ""}</span><Button size="xs" variant="outline" disabled={refreshing} onClick={() => void refresh(undefined, true)}>Retry</Button></div>}
    {!assetId ? <div className="flex min-h-0 flex-1 flex-col">
      <SummaryStrip label="Asset registry summary" items={[
        { label: "Total value", value: assetMoney(total), detail: `${statusAssets.length} ${status === "archived" ? "archived" : status === "all" ? "registered" : "active"} ${statusAssets.length === 1 ? "asset" : "assets"}, your share`, wrap: true },
        { label: "Net equity", value: assetMoney(netEquity), detail: linkedAssets.length === 0 ? "No loan linked, so equal to the total value" : `Value less ${assetMoney(debtTotal)} of debt on ${linkedAssets.length} ${linkedAssets.length === 1 ? "asset" : "assets"}`, wrap: true },
        { label: "Value gain", value: gainTotal === null ? NA : signed(gainTotal), detail: gainTotal === null ? "Needs every asset's dated value" : gainPercent === null ? "Revaluation and depreciation, all time" : `${gainPercent > 0 ? "+" : ""}${gainPercent.toFixed(2)}% of capital added, all time`, wrap: true },
        { label: "Net cash flow", value: cashAssets.length === 0 ? NA : reading ? "…" : assetMoney(portfolioCashflow), detail: cashAssets.length === 0 ? "No income or expenses linked" : `Linked income and expenses on ${cashAssets.length} ${cashAssets.length === 1 ? "asset" : "assets"}, all time`, wrap: true },
        { label: "Needs attention", value: status === "archived" ? NA : <span className={reviewCount > 0 ? "text-amber-600 dark:text-amber-500" : undefined}>{reviewCount}</span>, detail: status === "archived" ? "Archived assets are not checked" : `${reviewCount === 1 ? "asset" : "assets"} to review · ${assetMoney(unassigned)} Unassigned`, wrap: true },
      ]} />
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <SearchInput size="sm" aria-label="Search assets" className="w-56" value={search} onValueChange={setSearch} />
        <Select size="sm" className="w-44" aria-label="Asset status" value={status} onValueChange={setStatus} options={[{ value: "active", label: `Active assets (${registry.assets.filter((a) => a.status === "active").length})` }, { value: "archived", label: `Archived assets (${registry.assets.filter((a) => a.status === "archived").length})` }, { value: "all", label: "All assets" }]} />
        <Select size="sm" aria-label="Filter asset type" className="w-40" value={type} onValueChange={setType} options={[{ value: "", label: "All types" }, ...Object.entries(ASSET_TYPES).map(([value, info]) => ({ value, label: info.label }))]} />
        {(search || type || status !== "active") && <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setType(""); setStatus("active"); }}>Clear filters</Button>}
        <p role="status" className="ml-auto text-xs text-muted-foreground">{filtered.length} {filtered.length === 1 ? "asset" : "assets"}</p>
      </div>
      <div className="flex min-h-0 flex-1"><DataTable label="Asset Registry" rows={filtered} columns={columns} sort={sort} onSort={setSort} rowKey={(a) => a.id} rowLabel={(a) => a.name} onOpen={open} stacked empty={registry.assets.length ? <EmptyState icon={Landmark} title="No results match your filters" action={<Button size="sm" variant="outline" onClick={() => { setSearch(""); setType(""); setStatus("active"); }}>Clear filters</Button>}>Try a different search, status or type.</EmptyState> : <EmptyState icon={Landmark} title="No assets yet" action={<Button size="sm" disabled={!available} onClick={() => setCreating(true)}><Plus className="size-3.5" aria-hidden />Add Asset</Button>}>Register an off-budget Actual account as an asset to track its value, returns and loans. Create the account in Accounts if it does not exist yet.</EmptyState>} /></div>
    </div> : asset ? <div className="flex min-h-0 flex-1 overflow-hidden"><div className="flex min-w-0 flex-1 flex-col">
        {Boolean(reason || book?.issues.length) && <div role="alert" className="border-b px-4 py-2 text-xs text-destructive">{reason ?? book?.issues[0]}<Button size="xs" variant="ghost" onClick={() => setEditorAsset(asset)}>Details</Button></div>}
        {currentQuery?.isError && <p role="alert" className="border-b p-3 text-sm text-destructive">Book read failed: {currentQuery.error.message}</p>}
        <TabsContent value="Overview" className="flex min-h-0 flex-col"><AssetOverview asset={asset} date={date} valueMinor={value(asset)} reading={externalQuery.isPending} reportFor={(start, end) => isIsoDate(start) && isIsoDate(end) && start <= end ? report(asset, start, end) : undefined} firstDate={historyStart} book={book} debtAt={debtAtDate} unposted={unpostedMonths} operating={operatingEntries} capital={capitalEntries} financing={financingTimeline} depreciationDue={depreciationDue} onBook={openBook} onTab={setTab} chartPrefs={chartPrefs} onChartPrefs={setChartPrefs}
          onFocusBook={(focus) => { setBookFocus(focus); setBookView("asset"); setTab("Asset Ledger"); }} onFocusCashflow={(focus) => { setCashFocus(focus); setTab("Income & Expenses"); }} /></TabsContent>
        <TabsContent value="Asset Ledger" className="flex min-h-0 flex-col">{snapshot && available ? <BookPanel key={asset.id} payeeOptions={payeesQuery.data} onCapitalAction={(kind) => { if (!financialUnknown && capitalContext && asset.status === "active") setCapitalKind(kind); }} recordDisabled={financialUnknown || !capitalContext || asset.status !== "active"} asset={asset} registry={registry} snapshot={snapshot} fresh={fresh} onSaved={refresh} financialBlocked={financialUnknown} onUncertain={() => setFinancialUnknown(true)} accountName={accounts.find((a) => a.id === asset.actualAccountId)?.name} view={bookView} onViewChange={setBookView} focus={bookFocus} onClearFocus={() => setBookFocus(null)} /> : <p role="status" className="p-4 text-sm">Reading the Asset Ledger… Refresh to retry if unavailable.</p>}</TabsContent>
        <TabsContent value="Income & Expenses" className="flex min-h-0 flex-col">{externalQuery.data ? <IncomeExpensesTab key={asset.id} asset={asset} registry={registry} external={externalQuery.data} categories={categoryQuery.data?.categories} firstDate={historyStart} operating={operatingEntries} reportFor={(start, end) => report(asset, start, end)} valueAt={(on) => valueAt(asset, on)} focus={cashFocus} onClearFocus={() => setCashFocus(null)} today={date} fresh={freshCapital} ensureExternal={ensureExternal} onSaved={refresh} /> : <p role="status" className="p-4 text-sm">Reading source accounts… Refresh to retry.</p>}</TabsContent>
        <TabsContent value="Depreciation Schedule" className="flex min-h-0 flex-col">{snapshot && available ? <div className="flex min-h-0 flex-1"><DepreciationPanel key={asset.id} asset={asset} registry={registry} snapshot={snapshot} valueMinor={value(asset)} today={date} fresh={fresh} onSaved={refresh} onEdit={() => setDepreciationEditing(true)} onOpenBook={() => openBook()} financialBlocked={financialUnknown} onUncertain={() => setFinancialUnknown(true)} />
          {depreciationEditing && <DepreciationEditor asset={asset} settings={registry.depreciation?.find((d) => d.assetId === asset.id)} recordedMinor={value(asset)} today={date} onSaved={async (next) => { await refresh(next); }} onClose={() => setDepreciationEditing(false)} />}</div> : <p role="status" className="p-4 text-sm">Reading the asset book… Refresh to retry if unavailable.</p>}</TabsContent>
        <TabsContent value="Linked Loans" className="flex min-h-0 flex-col">{available ? <FinancingPanel key={asset.id} asset={asset} registry={registry} loans={loans} loansReady={loansQuery.isSuccess} accounts={accounts} asOf={asOf} onAsOf={setAsOf} today={date} valueAt={(on) => valueAt(asset, on)} debtsAt={debtsAt} onSaved={refresh} firstDate={firstBookDate} balanceAt={loanBalanceAt} repayments={repayments} /> : <p role="status" className="p-4 text-sm">Reading financing data… Refresh to retry if unavailable.</p>}</TabsContent>
        {financialUnknown && <p role="alert" className="border-t p-3 text-xs text-destructive">An Actual write needs inspection. Close the editor, Refresh and inspect the account before another financial action.</p>}
    </div>{capitalKind && capitalContext && <CapitalEditor key={capitalKind} kind={capitalKind} context={capitalContext} categories={categoryQuery.data?.categories ?? []} fresh={freshCapital} onSaved={async (next) => { await refresh(next); setFinancialUnknown(false); }} onClose={() => setCapitalKind(null)} onUncertain={() => setFinancialUnknown(true)} onPendingMetadata={() => setFinancialUnknown(true)} />}</div> : query.isSuccess && <p className="p-4 text-sm">Asset not found in this budget.</p>}
    <Dialog open={linkedAccountsOpen} onOpenChange={setLinkedAccountsOpen}><DialogContent className="sm:max-w-[min(94vw,68rem)]"><DialogHeader><DialogTitle>Linked accounts</DialogTitle><DialogDescription>Account balance equals attributed assets plus Unassigned. {accountRows.length} {accountRows.length === 1 ? "account" : "accounts"} · {needReview === 0 ? "all reconcile" : `${needReview} need review`}. Open a row to go to its asset.</DialogDescription></DialogHeader>
      <div className="flex min-h-32 flex-col overflow-hidden rounded-md border" style={{ height: Math.min(460, accountRows.length * 34 + 40) }}><DataTable label="Linked asset accounts" rows={accountRows} columns={accountColumns} rowKey={(r) => r.id} rowLabel={(r) => r.name} onOpen={(r) => { setLinkedAccountsOpen(false); open(r.members.find((a) => a.status === "active") ?? r.members[0]); }} dense={34} empty="No linked accounts yet." /></div>
    </DialogContent></Dialog>
    {editorAsset && <AssetEditor connection={connection} asset={editorAsset} registry={registry} recordedValueMinor={value(editorAsset)} bookContext={editingContext ? { balanceMinor: editingContext.snapshot?.balanceMinor ?? null, assignedMinor: editingContext.book?.available ? sumMinor([...editingContext.book.totals.values()]) : null, unassignedMinor: editingContext.book?.available ? editingContext.book.unassignedMinor : null, memberCount: editingContext.members.length, issues: editingContext.book?.issues ?? [] } : undefined} accounts={accounts} onClose={() => setEditorAsset(undefined)} onSaved={(next) => { void refresh(next); }} onDeleted={() => { if (assetId) router.push("/assets"); }} />}
    {creating && <AssetCreateDrawer connection={connection} accounts={accounts} registry={registry} today={date} onSaved={(next) => { void refresh(next); }} onOpenAsset={(id) => { setCreating(false); router.push(`/assets/${encodeURIComponent(id)}`); }} onClose={() => setCreating(false)} />}
  </PageLayout>{guideDialog}</Tabs>;
}
