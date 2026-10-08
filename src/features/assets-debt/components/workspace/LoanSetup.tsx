"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { crossesBudgetBoundary, type AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import { cn } from "@/lib/utils";
import { listMatchRules } from "../../lib/debtsApi";
import type { SaveIssue, SimulationState, TrackingState } from "../../lib/simulatorModel";
import { MatchingCard } from "../rules/MatchingCard";
import { TrackingSetup } from "../tracking/TrackingSetup";

/**
 * The loan workspace's Settings tab (RD-084 P1.6b T292 rev 2; `ux-loan-workspace.md`
 * §5): a checklist, the loan settings in two columns, and Repayment matching
 * across the bottom. The loan settings belong to the loan's revision (Save
 * changes in the header); matching is saved and turned on on its own, behind
 * its history check, and is labelled so.
 */

export type ChecklistItem = { id: string; label: string; done: boolean };

export function setupChecklist(input: { sim: SimulationState; tracking: TrackingState; directory: AccountDirectory | undefined; matchingEnabled: boolean | null }): ChecklistItem[] {
  const { sim, tracking, directory } = input;
  const liability = directory?.accounts.find((a) => a.id === tracking.liabilityAccountId);
  const payment = directory?.accounts.find((a) => a.id === tracking.paymentAccountId);
  const isTermOwed = sim.shape === "term-loan" && tracking.direction === "owed-by-me";
  const items: ChecklistItem[] = [
    { id: "liability", label: tracking.direction === "owed-to-me" ? "Receivable account" : "Loan account", done: !!tracking.liabilityAccountId },
    { id: "payment", label: "Repayment account", done: !!tracking.paymentAccountId },
  ];
  if (liability && payment && crossesBudgetBoundary(liability, payment)) items.push({ id: "category", label: "Loan payment category", done: !!tracking.loanPaymentCategoryId });
  if (isTermOwed) items.push({ id: "pattern", label: "Lender interest answered", done: !!tracking.lenderPattern });
  if (input.matchingEnabled !== null) items.push({ id: "matching", label: "Repayment matching on", done: input.matchingEnabled });
  return items;
}

/** The loan settings that must be complete for a save to make the loan active (matching is saved on its own). */
export function loanSettingsComplete(items: ChecklistItem[]): boolean {
  return items.filter((i) => i.id !== "matching").every((i) => i.done);
}

export function LoanSetup({ debtId, sim, setSimulation, tracking, setTracking, directory, issues, onEditRule, active }: { debtId: string | null; sim: SimulationState; setSimulation?: (sim: SimulationState) => void; tracking: TrackingState; setTracking: (t: TrackingState) => void; directory: AccountDirectory | undefined; issues: SaveIssue[]; /** Open the matching editor for a rule id or "new". */ onEditRule?: (ruleId: string) => void; /** The loan is already active (no activation note). */ active?: boolean }) {
  const rules = useQuery({ queryKey: ["assets-debt", "match-rules", debtId], queryFn: () => listMatchRules(debtId!), enabled: !!debtId });
  const matchingEnabled = debtId ? (rules.data ?? []).some((r) => r.record.enabled && r.record.purpose === "repayment") : null;
  const checklist = setupChecklist({ sim, tracking, directory, matchingEnabled });
  const done = checklist.filter((c) => c.done).length;
  const matching = debtId && onEditRule ? (
    <MatchingCard debtId={debtId} onEdit={onEditRule} />
  ) : (
    <section aria-labelledby="matching-new" className="flex min-w-0 flex-col gap-1 rounded-lg border border-dashed border-border p-4">
      <h2 id="matching-new" className="text-sm font-semibold">Repayment matching</h2>
      <p className="text-xs text-muted-foreground">Required once the loan is saved: Bench then suggests a rule from the accounts and repayment above, so it can find each repayment in Actual.</p>
    </section>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <section aria-label="Setup checklist" className="mx-4 mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border px-3 py-2 text-xs">
        <span className="font-medium">{done === checklist.length ? "Setup complete" : `Setup: ${done} of ${checklist.length} done`}</span>
        {checklist.map((item) => (
          <span key={item.id} className={cn("flex items-center gap-1", item.done ? "text-muted-foreground" : "text-foreground")}>
            {item.done ? <CheckCircle2 aria-hidden="true" className="size-3.5 text-emerald-600" /> : <Circle aria-hidden="true" className="size-3.5" />}
            <span>{item.label}</span>
            <span className="sr-only">{item.done ? "(done)" : "(to do)"}</span>
          </span>
        ))}
        <span className="ml-auto text-muted-foreground">{active ? "Nothing here changes Actual." : "Nothing here changes Actual. The first save with the loan settings complete makes the loan active."}</span>
      </section>
      <TrackingSetup sim={sim} setSimulation={setSimulation} tracking={tracking} setTracking={setTracking} directory={directory} issues={issues} matching={matching} />
    </div>
  );
}
