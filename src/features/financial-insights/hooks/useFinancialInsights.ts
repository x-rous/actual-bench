"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { refreshFromServer } from "@/lib/refreshFromServer";
import { getTransport } from "@/lib/actual";
import { isAccountGroupsUnsupported } from "@/lib/api/accountGroups";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { resolveAccountClass, type AccountClass } from "@/lib/account-class";
import { evaluateAccountReadiness, type AccountReadinessStatus } from "@/lib/account-class/reporting";
import type { AssetDebtLink } from "@/lib/asset-registry/financing";
import { CASHFLOW_TYPES, type Asset, type BookMetadata } from "@/lib/asset-registry/models";
import { useBudgetAvailability } from "./useBudgetPlan";
import { useCashBufferSettings } from "./useCashBufferSettings";
import { readLoanSchedules, type LoanSchedules } from "../lib/loanSchedules";
import type { AccountGroup } from "@/types/entities";
import { useAccountClasses } from "@/features/accounts/hooks/useAccountClasses";
import { useAccountReporting } from "@/features/accounts/hooks/useAccountReporting";
import { useClosedAccountActivity } from "@/features/accounts/hooks/useClosedAccountActivity";
import { registryRequest } from "@/features/asset-registry/api";
import { useLocalToday } from "@/features/assets-debt/lib/useLocalToday";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import type { PlanMode } from "@/lib/financial-insights/budget";
import { ASSET_ROW_LIMIT, reviewAssetEntries, valueChangeRows, type AssetEntry, type ReviewEntry, type SavedClassification } from "@/lib/financial-insights/assetReview";
import { compositionSeries, debtRepayments, incomeBreakdown, monthlyFlows, netWorthSteps, payeeSpending, spendingBreakdown, spendingFacts, spendingGroups, type CategoryInfo, type DebtRepayments, type MonthlyPoint, type SpendingBreakdown, type SpendingFacts } from "@/lib/financial-insights/breakdowns";
import type { ScheduleInput } from "@/lib/financial-insights/debt";
import { UNCATEGORIZED_KEY, median, type BufferCategoryRow, type BufferSettings } from "@/lib/financial-insights/bufferScenario";
import { comparePeriods, type Comparison } from "@/lib/financial-insights/compare";
import type { DrillContext } from "@/lib/financial-insights/drill";
import { isFixedAssetAccount } from "@/lib/financial-insights/wealth";
import { buildLedger, cashBuffer, loanCostRowsIn, loanCostsIn, summarize, type Ledger, type AccountFact, type AssetReview, type DatedAmount, type FinancialFacts, type LoanCostRow, type LoanScheduleInput, type MovementRow, type ReclassifiedRow } from "@/lib/financial-insights/measures";
import { DEFAULT_PERIOD, lastCompleteMonths, resolvePeriod, type PeriodChoice, type ResolvedPeriod } from "@/lib/financial-insights/period";
import { readAssetEntries, readLinkedSales, readPayeeRows, readLoanCostRows, readMovement, readStartingBalances, readTransfersIn, readUncategorizedIn } from "@/lib/financial-insights/reads";

// ─── Gate ────────────────────────────────────────────────────────────────────

export type SetupRow = { id: string; name: string; status: Exclude<AccountReadinessStatus, "ready"> };

export type Gate =
  | { state: "none" }
  | { state: "loading" }
  | { state: "error"; retry: () => void }
  | { state: "setup"; rows: SetupRow[] }
  /** `accounts` are the ones that count; `excluded` are the off-budget accounts the owner left out. */
  | { state: "ready"; accounts: AccountFact[]; excluded: { id: string; name: string }[] };

/**
 * Every account must be understood before any figure shows. This reads only persisted state (the accounts Actual
 * has, the saved classes and choices), never the Accounts page's unsaved draft, and shares its caches, so editing
 * in Accounts and coming back unlocks, and a new unclassified account locks again.
 */
export function useFinancialInsightsGate(): Gate {
  const connection = useConnectionStore(selectActiveInstance);
  const classes = useAccountClasses();
  const reporting = useAccountReporting();

  const accountsQuery = useQuery({
    queryKey: ["accounts", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getTransport(connection).getAccounts();
    },
    enabled: !!connection,
    // A new or changed account elsewhere must be noticed when this page opens.
    refetchOnMount: "always",
  });
  const groupsQuery = useQuery<AccountGroup[] | null>({
    queryKey: ["accountGroups", connection?.id],
    queryFn: async () => {
      if (!connection) throw new Error("No active connection");
      const transport = getTransport(connection);
      if (!transport.getAccountGroups) return null;
      try {
        return await transport.getAccountGroups();
      } catch (error) {
        if (isAccountGroupsUnsupported(error)) return null;
        throw error;
      }
    },
    enabled: !!connection,
    refetchOnMount: "always",
  });
  const accounts = accountsQuery.data;
  const closedIds = useMemo(() => (accounts ?? []).filter((a) => a.closed).map((a) => a.id), [accounts]);
  const activity = useClosedAccountActivity(closedIds);
  // `classes` and `reporting` are new objects on every render; the gate depends on the parts it reads, so it is rebuilt only when they change.
  const { enabled: classesEnabled, available: classesAvailable, failed: classesFailed, refetch: refetchClasses, maps: classMaps } = classes;
  const { available: reportingAvailable, failed: reportingFailed, refetch: refetchReporting, byAccount: reportingByAccount } = reporting;
  const { isError: accountsFailed, refetch: refetchAccounts, isFetchedAfterMount: accountsFetchedAfterMount } = accountsQuery;
  const { isError: groupsFailed, refetch: refetchGroups, data: groupsData } = groupsQuery;
  const { isError: activityFailed, refetch: refetchActivity, data: activityData } = activity;

  return useMemo((): Gate => {
    if (!connection || !classesEnabled) return { state: "none" };
    if (accountsFailed || groupsFailed || activityFailed || classesFailed || reportingFailed) {
      return {
        state: "error",
        retry: () => {
          void refetchAccounts();
          void refetchGroups();
          void refetchActivity();
          void refetchClasses();
          void refetchReporting();
        },
      };
    }
    // The accounts are checked again every time the page opens: until that check is back, what was cached is not shown as the truth.
    if (!accounts || !accountsFetchedAfterMount || groupsData === undefined || !activityData || !classesAvailable || !reportingAvailable) return { state: "loading" };

    const groupNames = new Map((groupsData ?? []).map((g) => [g.id, g.name]));
    const liveGroups = new Set(groupNames.keys());
    const classOf = new Map<string, AccountClass | null>(
      accounts.map((a) => [a.id, resolveAccountClass(a.id, a.groupId && liveGroups.has(a.groupId) ? a.groupId : null, classMaps).accountClass])
    );
    const readiness = evaluateAccountReadiness({ accounts, classOf, reporting: reportingByAccount, closedActivity: activityData });
    if (!readiness.ready) {
      const names = new Map(accounts.map((a) => [a.id, a.name]));
      const rows = readiness.accounts
        .filter((a): a is { accountId: string; status: Exclude<AccountReadinessStatus, "ready"> } => a.status !== "ready")
        .map((a) => ({ id: a.accountId, name: names.get(a.accountId) ?? a.accountId, status: a.status }));
      return { state: "setup", rows };
    }
    // An exempt closed account (no history) has no class and nothing to count, so it is left out of every figure.
    const facts: AccountFact[] = accounts.flatMap((a) => {
      const accountClass = classOf.get(a.id);
      return accountClass && accountClass !== "excluded" ? [{ id: a.id, name: a.name, groupId: a.groupId ?? null, groupName: a.groupId ? groupNames.get(a.groupId) ?? null : null, accountClass, treatment: reportingByAccount.get(a.id) ?? null, offBudget: a.offBudget, closed: a.closed }] : [];
    });
    const excluded = accounts.filter((a) => classOf.get(a.id) === "excluded").map((a) => ({ id: a.id, name: a.name }));
    return { state: "ready", accounts: facts, excluded };
  }, [connection, classesEnabled, classesAvailable, classesFailed, refetchClasses, classMaps, reportingAvailable, reportingFailed, refetchReporting, reportingByAccount, accounts, accountsFetchedAfterMount, accountsFailed, refetchAccounts, groupsFailed, refetchGroups, groupsData, activityFailed, refetchActivity, activityData]);
}

// ─── Data ────────────────────────────────────────────────────────────────────

type RawData = {
  movement: MovementRow[];
  startingBalances: DatedAmount[];
  uncategorizedIn: DatedAmount[];
  transfersIn: (DatedAmount & { transferAccountId: string })[];
  incomeCategories: string[];
  categories: CategoryInfo[];
  /** Rows the Asset Registry links to an asset sale. */
  linkedSales: ReclassifiedRow[];
  /** The rows of the asset accounts registered in the Asset Registry; null when they are too many to read. */
  assetEntries: AssetEntry[] | null;
  /** How many rows those accounts hold. */
  assetRowCount: number;
  /** False when the Asset Registry could not be read, so nothing in an asset account can be called classified. */
  registryRead: boolean;
  savedClassifications: SavedClassification[];
  /** The Asset Registry's assets, book metadata and loan links (empty when it could not be read). */
  registryAssets: Asset[];
  registryMetadata: BookMetadata[];
  debtLinks: AssetDebtLink[];
  loans: LoanSchedules;
  loanCosts: LoanCostRow[];
  readAt: string;
};

/** Everything the tabs render, from one read: the figures, the month-by-month series and the context links need. */
export type ReadyData = {
  summary: ReturnType<typeof summarize>;
  buffer: ReturnType<typeof cashBuffer>;
  /** The goal and how a typical month is worked out, as the user chose them. */
  bufferSettings: BufferSettings;
  /** What the cash buffer's average monthly spending is made of: the average of each category group over the same months. */
  bufferSpending: { groups: { name: string; avgMinor: number }[]; /** A typical month's spending as the cash buffer counts it, in the way the user chose (average or median). */ spendingMinor: number; /** What the interest and fees of tracked loans come to in a month: counted in the loan repayments, so taken out of the categories. */ loanInterestMinor: number; /** What came in in a typical month, the average or median as the user chose. */ incomeMinor: number; /** How many complete months it is taken over, and which: the first and the last. */ months: number; startMonth: string; endMonth: string; /** The same average, category by category: what a cash buffer scenario starts from. */ categories: BufferCategoryRow[] } | null;
  review: ReviewEntry[];
  firstMonth: string | null;
  readAt: string;
  refreshing: boolean;
  /** The latest read failed: the figures are from an earlier one. */
  refreshFailed: boolean;
  ledger: Ledger;
  period: ResolvedPeriod;
  categories: ReadonlyMap<string, CategoryInfo>;
  monthly: MonthlyPoint[];
  breakdown: SpendingBreakdown;
  spending: SpendingFacts;
  groups: ReturnType<typeof spendingGroups>;
  /** Money received, by income category: the same shapes as spending, so the Income tab reads like the Spending tab. */
  /** The period against the stretch of the same length before it (whole months only), when the budget has data that far back. */
  comparison: Comparison | null;
  income: { breakdown: SpendingBreakdown; facts: SpendingFacts; groups: ReturnType<typeof spendingGroups> };
  composition: ReturnType<typeof compositionSeries>;
  netWorthChange: ReturnType<typeof netWorthSteps>;
  debt: DebtRepayments;
  /** The tracked loans' schedules (next-12-month principal), already read for the cash buffer; Loans & cards shows them. */
  schedules: ScheduleInput[];
  drill: DrillContext;
  /** What the Asset Registry holds, for Investments. */
  registry: RegistryData;
};

export type RegistryData = {
  /** False when the registry could not be read, so nothing in an asset account can be called classified. */
  read: boolean;
  assets: Asset[];
  metadata: BookMetadata[];
  debtLinks: AssetDebtLink[];
  /** The non-transfer rows of the registered asset accounts; null when they are too many to read. */
  assetEntries: AssetEntry[] | null;
  assetRowCount: number;
  savedClassifications: SavedClassification[];
};

export const TABS = [
  { value: "summary", label: "Summary" },
  { value: "money", label: "Money in & out" },
  { value: "income", label: "Income" },
  { value: "spending", label: "Spending" },
  { value: "budget", label: "My budget" },
  { value: "wealth", label: "Investments" },
  { value: "property", label: "Property & assets" },
  { value: "loans", label: "Loans & cards" },
  { value: "statements", label: "Statements" },
] as const;

/** The tabs that have something to show: My budget once its mode is known and a month was read, Investments once an investment or retirement account exists, Property & assets once a fixed asset account exists (property, vehicle or a fixed other asset), Loans & cards once a loan, credit card or other liability account exists. */
export function offeredTabs(accounts: readonly Pick<AccountFact, "accountClass" | "treatment">[] | null, budgetAvailable: boolean): readonly (typeof TABS)[number][] {
  const wealth = (accounts ?? []).some((a) => a.accountClass === "investment" || a.accountClass === "retirement");
  const property = (accounts ?? []).some((a) => isFixedAssetAccount(a));
  const debt = (accounts ?? []).some((a) => a.accountClass === "loan" || a.accountClass === "credit-card" || a.accountClass === "other-liability");
  return TABS.filter((t) => (t.value !== "budget" || budgetAvailable) && (t.value !== "wealth" || wealth) && (t.value !== "property" || property) && (t.value !== "loans" || debt));
}
export type TabId = (typeof TABS)[number]["value"];

export type FinancialInsightsView = {
  gate: Gate;
  /** The tabs that have something to show: My budget only appears once the budget's mode is known and a month of it was read. */
  tabs: readonly (typeof TABS)[number][];
  /** The budget's mode, when it is Tracking or Envelope. */
  budgetMode: PlanMode | null;
  tab: TabId;
  setTab: (tab: TabId) => void;
  today: string;
  period: PeriodChoice;
  setPeriod: (period: PeriodChoice) => void;
  /** Loading, or failed, or ready; the figures exist only when ready. */
  data:
    | { state: "loading"; /** What is being read now, so a long read says where it is. */ stage?: string }
    | { state: "error"; retry: () => void }
    | ({ state: "ready" } & ReadyData);
  refresh: () => void;
};

export function useFinancialInsights(): FinancialInsightsView {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const today = useLocalToday();
  const gate = useFinancialInsightsGate();
  const { settings: bufferSettings } = useCashBufferSettings();
  const [filters, setFilters] = usePersistedFilters("filters:financial-insights", { period: DEFAULT_PERIOD, tab: "summary" as TabId });
  const accounts = gate.state === "ready" ? gate.accounts : null;
  const excluded = gate.state === "ready" ? gate.excluded : null;
  const [stage, setStage] = useState<string | undefined>(undefined);
  const loanIds = useMemo(() => new Set((accounts ?? []).filter((a) => a.accountClass === "loan").map((a) => a.id)), [accounts]);

  // One read per budget and day, shared by every tab. It re-reads whenever the page opens and whenever the toolbar's
  // Refresh invalidates the caches; a new period, tab or chart mode never refetches.
  const query = useQuery({
    queryKey: ["financial-insights", "data", connection?.id, connection?.budgetSyncId, today, [...loanIds].sort().join(","), (excluded ?? []).map((a) => a.id).sort().join(",")],
    enabled: !!connection?.budgetSyncId && gate.state === "ready",
    refetchOnMount: "always",
    queryFn: async (): Promise<RawData> => {
      if (!connection?.budgetSyncId) throw new Error("No active connection");
      const budget = connection.budgetSyncId;
      // One request at a time: the transport queues them anyway, and this keeps a failure easy to place.
      setStage("Reading transactions…");
      const movement = await readMovement(connection, today);
      const startingBalances = await readStartingBalances(connection, today);
      const uncategorizedIn = await readUncategorizedIn(connection, today);
      const transfersIn = await readTransfersIn(connection, today);
      setStage("Reading categories…");
      const groups = await getTransport(connection).getCategoryGroups();
      const groupOf = new Map(groups.groups.map((g) => [g.id, g]));
      // A category is income when its group is, as in Actual's budget; the category's own flag is only used when the group is unknown.
      const isIncome = (c: (typeof groups.categories)[number]) => groupOf.get(c.groupId)?.isIncome ?? c.isIncome;
      const incomeCategories = groups.categories.filter(isIncome).map((c) => c.id);
      const groupIndex = new Map(groups.groups.map((g, i) => [g.id, i]));
      const seen = new Map<string, number>();
      const categories: CategoryInfo[] = groups.categories.map((c) => {
        const within = seen.get(c.groupId) ?? 0;
        seen.set(c.groupId, within + 1);
        return {
          id: c.id, name: c.name, groupId: c.groupId, groupName: groupOf.get(c.groupId)?.name ?? "Other", hidden: c.hidden || !!groupOf.get(c.groupId)?.hidden, isIncome: isIncome(c),
          order: (groupIndex.get(c.groupId) ?? 9999) * 100_000 + within,
        };
      });

      setStage("Reading the Asset Registry…");
      let registryRead = true;
      let savedClassifications: SavedClassification[] = [];
      let linkedIds: string[] = [];
      let registered: string[] = [];
      let registryAssets: Asset[] = [], registryMetadata: BookMetadata[] = [], debtLinks: AssetDebtLink[] = [];
      try {
        const registry = await registryRequest(budget);
        savedClassifications = registry.metadata.map((m) => ({ actualTransactionId: m.actualTransactionId, actualAccountId: m.actualAccountId, classification: m.classification }));
        linkedIds = (registry.cashflows ?? []).filter((m) => m.classification && Object.hasOwn(CASHFLOW_TYPES, m.classification)).map((m) => m.actualTransactionId);
        registered = [...new Set(registry.assets.map((asset) => asset.actualAccountId))];
        registryAssets = registry.assets; registryMetadata = registry.metadata; debtLinks = registry.debtLinks ?? [];
      } catch {
        registryRead = false;
      }
      const linkedSales = await readLinkedSales(connection, linkedIds, today);

      // Only the accounts registered as assets are read: they are the only ones the registry can classify.
      // An account left out of Financial Insights affects no figure here, so it is neither counted against the row limit nor read.
      const leftOut = new Set((excluded ?? []).map((a) => a.id));
      registered = registered.filter((id) => !leftOut.has(id));
      let count = 0;
      const registeredSet = new Set(registered);
      for (const row of movement) if (registeredSet.has(row.accountId) && !row.transferAccountId) count += row.count;
      const assetEntries = count > ASSET_ROW_LIMIT ? null : await readAssetEntries(connection, registered, today);

      setStage("Reading loan schedules…");
      const loans = await readLoanSchedules(connection, { budgetSyncId: budget, today, loanAccountIds: loanIds });
      const loanCosts = await readLoanCostRows(connection, loans.costRows, today);
      return { movement, startingBalances, uncategorizedIn, transfersIn, incomeCategories, categories, linkedSales, assetEntries, assetRowCount: count, registryRead, savedClassifications, registryAssets, registryMetadata, debtLinks, loans, loanCosts, readAt: new Date().toISOString() };
    },
  });

  const raw = query.data;
  const ledger = useMemo(() => {
    if (!accounts || !excluded || !raw) return null;
    const facts: FinancialFacts = {
      accounts, excluded: new Set(excluded.map((a) => a.id)), incomeCategories: new Set(raw.incomeCategories), movement: raw.movement, startingBalances: raw.startingBalances,
      uncategorizedIn: raw.uncategorizedIn, transfersIn: raw.transfersIn, loanCosts: raw.loanCosts,
      reclassified: [...raw.linkedSales, ...(raw.assetEntries ? valueChangeRows(raw.assetEntries, raw.savedClassifications) : [])],
    };
    return buildLedger(facts);
  }, [accounts, excluded, raw]);

  const period = filters.period;
  const budget = useBudgetAvailability(gate.state === "ready", today);
  const tabs = useMemo(() => offeredTabs(accounts, budget.available), [accounts, budget.available]);
  // The query result is a new object on every render, so the memo below depends on the few values it reads from it.
  const { isError, isFetching, refetch } = query;
  const data = useMemo((): FinancialInsightsView["data"] => {
    if (gate.state !== "ready") return { state: "loading", stage };
    if (isError && !raw) return { state: "error", retry: () => void refetch() };
    if (!raw || !ledger) return { state: "loading", stage };
    const resolved = resolvePeriod(period, today, ledger.firstMonth);
    let review: ReviewEntry[] = [];
    let assetReview: AssetReview;
    // A sale linked to an asset is taken out of income and spending whatever the class of its account, so no failed read is let through.
    if (!raw.registryRead) assetReview = { unavailableReason: "The Asset Registry could not be read, so asset entries and linked sales cannot be classified", rowCount: 0 };
    else if (raw.assetEntries === null) assetReview = { unavailableReason: `The registered asset accounts hold ${raw.assetRowCount.toLocaleString()} entries, more than can be read to classify them`, rowCount: 0 };
    else {
      review = reviewAssetEntries(raw.assetEntries, raw.savedClassifications, resolved);
      assetReview = { unavailableReason: null, rowCount: review.length };
    }
    const trackedLoans = new Set<string>([...raw.loans.schedules.filter((l) => l.state === "ready").map((l) => l.accountId), ...raw.loans.costRows.map((c) => c.loanAccountId)]);
    const schedules = new Map<string, LoanScheduleInput>(raw.loans.schedules.map((l) => [l.accountId, l.state === "ready" ? { state: "ready", monthlyMinor: l.monthlyMinor } : { state: "unavailable", reason: l.reason }]));
    const summary = summarize(ledger, resolved, assetReview);
    const categories = new Map(raw.categories.map((c) => [c.id, c]));
    const monthly = monthlyFlows(ledger, resolved, today, summary.moneyKept.state === "ready");
    const breakdown = spendingBreakdown(ledger, resolved, categories, monthly);
    const incomeRows = incomeBreakdown(ledger, resolved, categories, monthly);
    const bufferSpending = bufferSpendingGroups(ledger, today, categories, bufferSettings);
    return {
      state: "ready", summary, buffer: cashBuffer(ledger, today, schedules, { months: bufferSettings.averageMonths, spendingMinor: bufferSettings.method === "median" ? bufferSpending?.spendingMinor : undefined }), bufferSpending, bufferSettings,
      review, firstMonth: ledger.firstMonth, readAt: raw.readAt, refreshing: isFetching, refreshFailed: isError,
      ledger, period: resolved, categories, monthly, breakdown, spending: spendingFacts(breakdown, monthly),
      groups: spendingGroups(breakdown), comparison: comparePeriods(ledger, resolved, today), income: { breakdown: incomeRows, facts: spendingFacts(incomeRows, monthly, (m) => m.received), groups: spendingGroups(incomeRows) }, composition: compositionSeries(ledger, resolved, summary.opening), netWorthChange: netWorthSteps(summary),
      debt: debtRepayments(ledger, resolved, trackedLoans, summary.cashBridge.loanOut * -1),
      schedules: raw.loans.schedules.map((l): ScheduleInput => (l.state === "ready" ? { accountId: l.accountId, state: "ready", principalNext12Minor: l.principalNext12Minor, costNext12Minor: l.costNext12Minor } : { accountId: l.accountId, state: "unavailable", reason: l.reason })),
      drill: { ledger, period: resolved, today, reclassifiedIds: new Set(ledger.facts.reclassified.map((r) => r.id)) },
      registry: { read: raw.registryRead, assets: raw.registryAssets, metadata: raw.registryMetadata, debtLinks: raw.debtLinks, assetEntries: raw.assetEntries, assetRowCount: raw.assetRowCount, savedClassifications: raw.savedClassifications },
    };
  }, [gate, isError, isFetching, refetch, raw, ledger, period, today, stage, bufferSettings]);

  return {
    gate, today, period, data, tabs, budgetMode: budget.mode,
    // A saved tab that is not offered (yet) is shown as Summary without forgetting the choice.
    tab: tabs.some((t) => t.value === filters.tab) ? filters.tab : "summary",
    setTab: (next) => setFilters((f) => ({ ...f, tab: next })),
    setPeriod: (next) => setFilters((f) => ({ ...f, period: next })),
    // The same path as the toolbar's Refresh: pull the budget from the server first, then re-read.
    refresh: () => void refreshFromServer({
      sync: async () => { if (connection) await getTransport(connection).sync(); },
      invalidate: () => Promise.all([
        queryClient.invalidateQueries({ queryKey: ["financial-insights"] }),
        // My budget reads Actual's budget months through Budget Cockpit's cache; mark them out of date so they are read again.
        queryClient.invalidateQueries({ queryKey: ["budget-month-data", connection?.id] }),
        queryClient.invalidateQueries({ queryKey: ["budget-months", connection?.id] }),
        queryClient.invalidateQueries({ queryKey: ["budgetPreferences", connection?.id] }),
        // Investments reads each registered asset account's book through the Asset Registry's cache.
        queryClient.invalidateQueries({ queryKey: ["assetBook", connection?.id] }),
        queryClient.invalidateQueries({ queryKey: ["accounts", connection?.id] }),
        queryClient.invalidateQueries({ queryKey: ["accountGroups", connection?.id] }),
        queryClient.invalidateQueries({ queryKey: ["accountActivity"] }),
        // Saved in another tab since: the setup screen must not keep an answer that has changed.
        queryClient.invalidateQueries({ queryKey: ["accountClasses", connection?.budgetSyncId] }),
        queryClient.invalidateQueries({ queryKey: ["accountReporting", connection?.budgetSyncId] }),
      ]),
      onSyncFailed: () => toast.warning("Could not reach the server. Showing the data already loaded."),
    }),
  };
}

/**
 * Spending by payee for the selected period. It is read when the Spending tab opens and is the one read that depends on the
 * period, so it is read again when the period changes (everything else is read once and reused).
 */
export function usePayeeSpending(data: ReadyData, today: string, side: "spending" | "income" = "spending") {
  const connection = useConnectionStore(selectActiveInstance);
  const { period, ledger, categories } = data;
  const query = useQuery({
    queryKey: ["financial-insights", "payees", connection?.id, connection?.budgetSyncId, today, period.startDate, period.endDate],
    enabled: !!connection?.budgetSyncId,
    refetchOnMount: "always",
    queryFn: async () => {
      if (!connection) throw new Error("No active connection");
      const rows = await readPayeeRows(connection, period.startDate, period.endDate, today);
      const payees = await getTransport(connection).getPayees();
      return { rows, names: new Map(payees.map((p) => [p.id, p.name])) };
    },
  });
  const payees = useMemo(
    () => (query.data ? payeeSpending(query.data.rows, ledger, period, categories, query.data.names, 15, side) : null),
    [query.data, ledger, period, categories, side],
  );
  return { payees, isLoading: query.isLoading, isError: query.isError, retry: () => void query.refetch() };
}

/** The average of each category group over the months the cash buffer averages, the buffer's own figure differs by the interest and fees of tracked loans, which it counts in their repayments. */
export function bufferSpendingGroups(ledger: Ledger, today: string, categories: ReadonlyMap<string, CategoryInfo>, settings: BufferSettings): ReadyData["bufferSpending"] {
  const months = lastCompleteMonths(today, ledger.firstMonth, settings.averageMonths);
  if (months.length < 3) return null;
  const window: ResolvedPeriod = { startMonth: months[0], endMonth: months[months.length - 1], months, startDate: `${months[0]}-01`, endDate: `${months[months.length - 1]}-28`, partial: false, label: "" };
  const flows = monthlyFlows(ledger, window, today, false);
  const breakdown = spendingBreakdown(ledger, window, categories, flows);
  // A typical month of a category: the average of the months, or the middle one, as the user chose.
  const typical = (values: readonly number[]) => (settings.method === "median" ? median(values) : Math.round(values.reduce((a, v) => a + v, 0) / months.length));
  // The interest and fees of tracked loans are counted in each loan's repayment, so they are taken out of the category they were recorded
  // in: a category's typical amount is what is left, and one that was only loan interest is not listed at all.
  const loanCosts = new Map<string, number[]>();
  const slot = new Map(months.map((m, i) => [m, i]));
  for (const row of loanCostRowsIn(ledger, window)) {
    const key = row.categoryId ?? UNCATEGORIZED_KEY;
    const series = loanCosts.get(key) ?? months.map(() => 0);
    series[slot.get(row.month) ?? 0] += 0 - row.amountMinor;
    loanCosts.set(key, series);
  }
  const all = breakdown.rows.map((r): BufferCategoryRow => {
    const removed = loanCosts.get(r.id ?? UNCATEGORIZED_KEY);
    const net = removed ? r.byMonth.map((v, i) => v - removed[i]) : r.byMonth;
    return {
      id: r.id, name: r.name, group: r.group, hidden: r.hidden, avgMinor: typical(net), order: r.order,
      // The transactions of the whole category are listed, so this is its whole total; `loanInterestMinor` is the part a month of it that is counted in the loan repayments.
      totalMinor: r.totalMinor, loanInterestMinor: removed ? Math.round(removed.reduce((a, v) => a + v, 0) / months.length) : undefined,
    };
  });
  const rows = all.filter((r) => r.avgMinor !== 0).sort((a, b) => b.avgMinor - a.avgMinor);
  const byGroup = new Map<string, number>();
  for (const r of rows) byGroup.set(r.group, (byGroup.get(r.group) ?? 0) + r.avgMinor);
  const groups = [...byGroup].map(([name, avgMinor]) => ({ name, avgMinor })).filter((g) => g.avgMinor !== 0).sort((a, b) => b.avgMinor - a.avgMinor);
  // The typical month's spending as the buffer counts it: the categories, already without the interest and fees of tracked loans.
  const spendingMinor = all.reduce((sum, r) => sum + r.avgMinor, 0);
  const loanInterestMinor = Math.round(0 - loanCostsIn(ledger, window) / months.length);
  // What came in in a typical month, in the same way: it is what is left to save from.
  const incomeMinor = typical(flows.map((m) => m.received));
  return { groups, categories: rows, spendingMinor, loanInterestMinor, incomeMinor, months: months.length, startMonth: months[0], endMonth: months[months.length - 1] };
}
