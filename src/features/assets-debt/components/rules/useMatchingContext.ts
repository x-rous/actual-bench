"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { getDebt, getSchedule, listMatchRules } from "../../lib/debtsApi";
import type { RecommendationInput } from "../../lib/matchingRuleBuilder";
import { useAccountDirectory } from "../../lib/useAccountDirectory";

export type RecommendationContext = Omit<RecommendationInput, "purpose">;

const isoToday = () => new Date().toISOString().slice(0, 10);
const inDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * What the Settings card and the matching editor share (RD-084 T280 rev 2): the loan, its rules,
 * the accounts, and the suggested setup built from the loan's settings (its repayment account and
 * the contractual or next projected repayment).
 */
export function useMatchingContext(debtId: string) {
  const connection = useConnectionStore(selectActiveInstance);
  const directory = useAccountDirectory();
  const queryClient = useQueryClient();
  const today = useMemo(() => isoToday(), []);
  const detail = useQuery({ queryKey: ["assets-debt", "debt", debtId], queryFn: () => getDebt(debtId), enabled: !!debtId });
  const rules = useQuery({ queryKey: ["assets-debt", "match-rules", debtId], queryFn: () => listMatchRules(debtId), enabled: !!debtId });
  const openingDate = detail.data?.config.ok ? detail.data.config.config.terms.openingDate : null;
  const contractualPaymentMinor = detail.data?.config.ok ? detail.data.config.config.terms.contractualPaymentMinor : null;
  // Without a contractual repayment, suggest the next projected one.
  const nextRepayment = useQuery({
    queryKey: ["assets-debt", "next-repayment", debtId, today],
    queryFn: () => getSchedule(debtId, { from: today, to: inDays(today, 400), resolution: "events" }),
    enabled: !!debtId && !!detail.data && contractualPaymentMinor === null,
  });
  const projectedPaymentMinor = nextRepayment.data?.ok
    ? Math.abs(nextRepayment.data.events.find((event) => event.eventType === "repayment")?.cashMovementMinor ?? 0) || null
    : null;
  const recommendation: RecommendationContext = useMemo(() => ({
    paymentAccountId: detail.data?.debt.paymentAccountId ?? null,
    liabilityAccountId: detail.data?.debt.liabilityAccountId ?? null,
    signConvention: detail.data?.debt.signConvention === "positive-is-debt" ? "positive-is-debt" : "negative-is-debt",
    expectedPaymentMinor: contractualPaymentMinor ?? projectedPaymentMinor,
    toleranceMinor: detail.data?.debt.driftToleranceMinor ?? 100,
    repaymentFrequency: detail.data?.config.ok ? detail.data.config.config.profile?.repaymentFrequency ?? null : null,
  }), [detail.data, contractualPaymentMinor, projectedPaymentMinor]);
  const defaultSource = detail.data?.debt.paymentAccountId ?? directory.data?.accounts.find((account) => !account.closed)?.id ?? "";
  return {
    connection, directory, detail, rules, recommendation, defaultSource, today,
    historyFrom: openingDate ?? today,
    minorDigits: detail.data?.debt.currencyMinorDigits ?? 2,
    currency: detail.data?.debt.currency ?? "",
    lenderPattern: detail.data?.debt.lenderPattern ?? null,
    refreshRules: () => queryClient.invalidateQueries({ queryKey: ["assets-debt", "match-rules", debtId] }),
  };
}
