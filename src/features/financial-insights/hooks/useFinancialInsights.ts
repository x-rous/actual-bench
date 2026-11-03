"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { refreshFromServer } from "@/lib/refreshFromServer";
import { getTransport } from "@/lib/actual";
import { isAccountGroupsUnsupported } from "@/lib/api/accountGroups";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { resolveAccountClass, type AccountClass } from "@/lib/account-class";
import { evaluateAccountReadiness, type AccountReadinessStatus } from "@/lib/account-class/reporting";
import { CASHFLOW_TYPES } from "@/lib/asset-registry/models";
import { readLoanSchedules, type LoanSchedules } from "../lib/loanSchedules";
import type { AccountGroup } from "@/types/entities";
import { useAccountClasses } from "@/features/accounts/hooks/useAccountClasses";
import { useAccountReporting } from "@/features/accounts/hooks/useAccountReporting";
import { useClosedAccountActivity } from "@/features/accounts/hooks/useClosedAccountActivity";
import { registryRequest } from "@/features/asset-registry/api";
import { useLocalToday } from "@/features/assets-debt/lib/useLocalToday";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { ASSET_ROW_LIMIT, reviewAssetEntries, valueChangeRows, type AssetEntry, type ReviewEntry, type SavedClassification } from "@/lib/financial-insights/assetReview";
import { buildLedger, cashBuffer, summarize, type AccountFact, type AssetReview, type DatedAmount, type FinancialFacts, type LoanCostRow, type LoanScheduleInput, type MovementRow, type ReclassifiedRow } from "@/lib/financial-insights/measures";
import { DEFAULT_PERIOD, resolvePeriod, type PeriodChoice } from "@/lib/financial-insights/period";
import { readAssetEntries, readLinkedSales, readLoanCostRows, readMovement, readStartingBalances, readUncategorizedIn } from "@/lib/financial-insights/reads";

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

  return useMemo((): Gate => {
    if (!connection || !classes.enabled) return { state: "none" };
    if (accountsQuery.isError || groupsQuery.isError || activity.isError || classes.failed || reporting.failed) {
      return {
        state: "error",
        retry: () => {
          void accountsQuery.refetch();
          void groupsQuery.refetch();
          void activity.refetch();
          void classes.refetch();
          void reporting.refetch();
        },
      };
    }
    // The accounts are checked again every time the page opens: until that check is back, what was cached is not shown as the truth.
    if (!accounts || !accountsQuery.isFetchedAfterMount || groupsQuery.data === undefined || !activity.data || !classes.available || !reporting.available) return { state: "loading" };

    const liveGroups = new Set((groupsQuery.data ?? []).map((g) => g.id));
    const classOf = new Map<string, AccountClass | null>(
      accounts.map((a) => [a.id, resolveAccountClass(a.id, a.groupId && liveGroups.has(a.groupId) ? a.groupId : null, classes.maps).accountClass])
    );
    const readiness = evaluateAccountReadiness({ accounts, classOf, reporting: reporting.byAccount, closedActivity: activity.data });
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
      return accountClass && accountClass !== "excluded" ? [{ id: a.id, name: a.name, accountClass, treatment: reporting.byAccount.get(a.id) ?? null, offBudget: a.offBudget }] : [];
    });
    const excluded = accounts.filter((a) => classOf.get(a.id) === "excluded").map((a) => ({ id: a.id, name: a.name }));
    return { state: "ready", accounts: facts, excluded };
  }, [connection, classes, reporting, accounts, groupsQuery, activity, accountsQuery]);
}

// ─── Data ────────────────────────────────────────────────────────────────────

type RawData = {
  movement: MovementRow[];
  startingBalances: DatedAmount[];
  uncategorizedIn: DatedAmount[];
  incomeCategories: string[];
  /** Rows the Asset Registry links to an asset sale. */
  linkedSales: ReclassifiedRow[];
  /** The rows of the asset accounts registered in the Asset Registry; null when they are too many to read. */
  assetEntries: AssetEntry[] | null;
  /** How many rows those accounts hold. */
  assetRowCount: number;
  /** False when the Asset Registry could not be read, so nothing in an asset account can be called classified. */
  registryRead: boolean;
  savedClassifications: SavedClassification[];
  loans: LoanSchedules;
  loanCosts: LoanCostRow[];
  readAt: string;
};

export type FinancialInsightsView = {
  gate: Gate;
  today: string;
  period: PeriodChoice;
  setPeriod: (period: PeriodChoice) => void;
  /** Loading, or failed, or ready; the figures exist only when ready. */
  data:
    | { state: "loading" }
    | { state: "error"; retry: () => void }
    | { state: "ready"; summary: ReturnType<typeof summarize>; buffer: ReturnType<typeof cashBuffer>; review: ReviewEntry[]; firstMonth: string | null; readAt: string; refreshing: boolean; /** The latest read failed: the figures are from an earlier one. */ refreshFailed: boolean };
  refresh: () => void;
};

export function useFinancialInsights(): FinancialInsightsView {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const today = useLocalToday();
  const gate = useFinancialInsightsGate();
  const [filters, setFilters] = usePersistedFilters("filters:financial-insights", { period: DEFAULT_PERIOD });
  const accounts = gate.state === "ready" ? gate.accounts : null;
  const excluded = gate.state === "ready" ? gate.excluded : null;
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
      const movement = await readMovement(connection, today);
      const startingBalances = await readStartingBalances(connection, today);
      const uncategorizedIn = await readUncategorizedIn(connection, today);
      const groups = await getTransport(connection).getCategoryGroups();
      const incomeCategories = groups.categories.filter((c) => c.isIncome).map((c) => c.id);

      let registryRead = true;
      let savedClassifications: SavedClassification[] = [];
      let linkedIds: string[] = [];
      let registered: string[] = [];
      try {
        const registry = await registryRequest(budget);
        savedClassifications = registry.metadata.map((m) => ({ actualTransactionId: m.actualTransactionId, actualAccountId: m.actualAccountId, classification: m.classification }));
        linkedIds = (registry.cashflows ?? []).filter((m) => m.classification && Object.hasOwn(CASHFLOW_TYPES, m.classification)).map((m) => m.actualTransactionId);
        registered = [...new Set(registry.assets.map((asset) => asset.actualAccountId))];
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

      const loans = await readLoanSchedules(connection, { budgetSyncId: budget, today, loanAccountIds: loanIds });
      const loanCosts = await readLoanCostRows(connection, loans.costRowIds, today);
      return { movement, startingBalances, uncategorizedIn, incomeCategories, linkedSales, assetEntries, assetRowCount: count, registryRead, savedClassifications, loans, loanCosts, readAt: new Date().toISOString() };
    },
  });

  const raw = query.data;
  const ledger = useMemo(() => {
    if (!accounts || !excluded || !raw) return null;
    const facts: FinancialFacts = {
      accounts, excluded: new Set(excluded.map((a) => a.id)), incomeCategories: new Set(raw.incomeCategories), movement: raw.movement, startingBalances: raw.startingBalances,
      uncategorizedIn: raw.uncategorizedIn, loanCosts: raw.loanCosts,
      reclassified: [...raw.linkedSales, ...(raw.assetEntries ? valueChangeRows(raw.assetEntries, raw.savedClassifications) : [])],
    };
    return buildLedger(facts);
  }, [accounts, excluded, raw]);

  const period = filters.period;
  const data = useMemo((): FinancialInsightsView["data"] => {
    if (gate.state !== "ready") return { state: "loading" };
    const accounts = gate.accounts;
    if (query.isError && !raw) return { state: "error", retry: () => void query.refetch() };
    if (!raw || !ledger) return { state: "loading" };
    const resolved = resolvePeriod(period, today, ledger.firstMonth);
    let review: ReviewEntry[] = [];
    let assetReview: AssetReview;
    const hasAssetAccounts = (accounts ?? []).some((a) => ["property", "vehicle", "other-asset", "investment", "retirement"].includes(a.accountClass));
    // A sale linked to an asset is taken out of income and spending whatever the class of its account, so an account left out matters too.
    if (!raw.registryRead && (hasAssetAccounts || gate.excluded.length > 0)) assetReview = { unavailableReason: "The Asset Registry could not be read, so asset entries and linked sales cannot be classified", rowCount: 0 };
    else if (raw.assetEntries === null) assetReview = { unavailableReason: `The registered asset accounts hold ${raw.assetRowCount.toLocaleString()} entries, more than can be read to classify them`, rowCount: 0 };
    else {
      review = reviewAssetEntries(raw.assetEntries, raw.savedClassifications, resolved);
      assetReview = { unavailableReason: null, rowCount: review.length };
    }
    const schedules = new Map<string, LoanScheduleInput>(raw.loans.schedules.map((l) => [l.accountId, l.state === "ready" ? { state: "ready", monthlyMinor: l.monthlyMinor } : { state: "unavailable", reason: l.reason }]));
    return {
      state: "ready", summary: summarize(ledger, resolved, assetReview), buffer: cashBuffer(ledger, today, schedules),
      review, firstMonth: ledger.firstMonth, readAt: raw.readAt, refreshing: query.isFetching, refreshFailed: query.isError,
    };
  }, [gate, query, raw, ledger, period, today]);

  return {
    gate, today, period, data,
    setPeriod: (next) => setFilters((f) => ({ ...f, period: next })),
    // The same path as the toolbar's Refresh: pull the budget from the server first, then re-read.
    refresh: () => void refreshFromServer({
      sync: async () => { if (connection) await getTransport(connection).sync(); },
      invalidate: () => Promise.all([
        queryClient.invalidateQueries({ queryKey: ["financial-insights"] }),
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
