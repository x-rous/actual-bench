"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import { modelFromDetail } from "@/lib/assets-debt/model/buildModel";
import { planTracking, type TrackingDebt, type TrackingResult } from "@/lib/assets-debt/tracking/plan";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { localToday } from "./calendarDate";
import { getTrackingBundle, type TrackingBundle } from "./trackingApi";
import { readTracking, ruleAccounts, type TrackingReads } from "./trackingReads";
import { useAccountDirectory } from "./useAccountDirectory";

/** The categories the loan's split lines use, from its components. */
export function componentCategory(detail: DebtDetail, kind: "interest" | "fee"): string | null {
  if (!detail.config.ok) return null;
  return (detail.config.config.components as Array<{ economicKind: string; categoryId: string | null }>).find((c) => c.economicKind === kind)?.categoryId ?? null;
}

/** The tracking settings the core needs, or null while the loan isn't tracked in Actual. */
export function trackingDebtOf(detail: DebtDetail): TrackingDebt | null {
  const { debt } = detail;
  if (!debt.trackingStartDueDate || !debt.liabilityAccountId || debt.status !== "active") return null;
  return {
    id: debt.id, budgetSyncId: debt.budgetSyncId, liabilityAccountId: debt.liabilityAccountId, trackingStartDueDate: debt.trackingStartDueDate,
    representation: debt.lenderPattern === "separate-interest" ? "lender-charged" : "split",
    loanPaymentCategoryId: debt.loanPaymentCategoryId, interestCategoryId: componentCategory(detail, "interest"), feeCategoryId: componentCategory(detail, "fee"),
    principalNoteSuffix: debt.principalNoteSuffix, interestNoteSuffix: debt.interestNoteSuffix, toleranceMinor: debt.driftToleranceMinor, missingGraceDays: debt.missingGraceDays,
  };
}

/**
 * The contract the tracking compares with: terms, rates and the events dated before the tracking start. Later events
 * are what-ifs (Terms & Schedule only); what happened since the tracking start comes from the Loan Ledger.
 */
export function trackingDetail(detail: DebtDetail, trackingStart: string): DebtDetail {
  return { ...detail, assumptions: detail.assumptions.filter((a) => a.enabled !== false && a.effectiveFrom < trackingStart) };
}

/** A month before the tracking start: the period of the first tracked installment starts after the one before it. */
export function readWindowStart(trackingStart: string): string {
  const d = new Date(`${trackingStart}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 2);
  return d.toISOString().slice(0, 10);
}

export type LoanTracking = {
  tracked: boolean;
  debt: TrackingDebt | null;
  bundle: TrackingBundle | undefined;
  reads: TrackingReads | undefined;
  result: TrackingResult | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  today: string;
  /** Read Actual again (with a sync) and re-plan. */
  refresh: () => Promise<void>;
  /** Re-read Bench's saved decisions only (after a classification or a rule changed). */
  reloadBundle: () => Promise<void>;
};

export function useLoanTracking(detail: DebtDetail | undefined): LoanTracking {
  const connection = useConnectionStore(selectActiveInstance);
  const directory = useAccountDirectory();
  const queryClient = useQueryClient();
  const today = localToday();
  const debt = detail ? trackingDebtOf(detail) : null;
  const bundle = useQuery({ queryKey: ["assets-debt", "tracking", detail?.debt.id], queryFn: () => getTrackingBundle(detail!.debt.id), enabled: !!detail && !!debt });
  const openAccounts = useMemo(() => directory.data?.accounts.filter((a) => !a.closed && !a.offBudget).map((a) => a.id) ?? [], [directory.data]);
  const rulesKey = JSON.stringify(bundle.data?.rules.map((r) => r.conditions) ?? []);
  const sameBudget = !!connection && connection.budgetSyncId === detail?.debt.budgetSyncId;
  const reads = useQuery({
    queryKey: ["assets-debt", "tracking-reads", connection?.id, detail?.debt.id, debt?.trackingStartDueDate, debt?.liabilityAccountId, rulesKey],
    queryFn: () => readTracking(getTransport(connection!), {
      loanAccountId: debt!.liabilityAccountId, from: readWindowStart(debt!.trackingStartDueDate), today,
      ruleAccountIds: ruleAccounts(bundle.data?.rules ?? [], openAccounts, debt!.liabilityAccountId),
    }),
    enabled: !!debt && sameBudget && !!bundle.data && !!directory.data,
    staleTime: 60_000,
  });
  const result = useMemo((): TrackingResult | null => {
    if (!detail || !debt || !reads.data || !bundle.data || !directory.data) return null;
    const built = modelFromDetail(trackingDetail(detail, debt.trackingStartDueDate));
    if (!built.ok) return { ok: false, message: built.blocked.message };
    return planTracking({
      debt, model: built.model, today, openingStatement: bundle.data.openingStatement, anchors: bundle.data.anchors,
      accounts: directory.data.accounts, transferPayeeByAccount: reads.data.transferPayeeByAccount,
      loanRows: reads.data.loanRows, bankRows: reads.data.bankRows, entries: bundle.data.entries, rules: bundle.data.rules,
    });
  }, [detail, debt, reads.data, bundle.data, directory.data, today]);
  const error = !sameBudget && debt ? "Connect to this loan's budget to see it in Actual." : reads.error instanceof Error ? reads.error.message : bundle.error instanceof Error ? bundle.error.message : null;
  return {
    tracked: !!debt, debt, bundle: bundle.data, reads: reads.data, result, today, error,
    loading: !!debt && (bundle.isLoading || reads.isLoading || directory.isLoading),
    refreshing: reads.isFetching,
    refresh: async () => { await queryClient.invalidateQueries({ queryKey: ["assets-debt", "tracking-reads", connection?.id, detail?.debt.id] }); await bundle.refetch(); },
    reloadBundle: async () => { await bundle.refetch(); },
  };
}
