"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getTransport } from "@/lib/actual";
import { readMatchingHistory } from "@/lib/assets-debt/actual/ledgerPort";
import type { MatchRuleSave, MatchRuleView } from "@/lib/assets-debt/services/matchingService";
import type { DebtBacktestResult, MatchConditionsV1 } from "@/lib/financial-models/matching";
import { cn } from "@/lib/utils";
import { deleteMatchRule, updateMatchRule } from "../../lib/debtsApi";
import { conditionsToSettings, ruleSentence } from "../../lib/matchingRuleBuilder";
import { isHandled } from "./BacktestResultsTable";
import { useMatchingContext } from "./useMatchingContext";

/**
 * Repayment matching on the loan's Settings tab (RD-084 T280 rev 2; FR-075a). Matching is saved
 * on its own, not with Save changes. Without a rule it is a clearly required step, because the
 * Transactions tab cannot propose anything until one is on. With rules, each reads in plain words
 * with its state and last check; Edit opens the matching editor.
 */

export const PURPOSE_LABEL: Record<string, string> = {
  repayment: "Your repayments",
  "lender-repayment-row": "The lender's repayment rows",
  "interest-charge": "The lender's interest charges",
};

/** Counts with periods already handled by an applied change shown as such, not as missing. */
export function backtestSummary(result: DebtBacktestResult): string {
  // The server already leaves handled periods out of the missing, multiple and unsafe counts.
  const handled = result.periods.filter(isHandled).length;
  return [`${result.summary.unique} found`, ...(handled ? [`${handled} already handled`] : []), `${result.summary.missing} missing`, ...(result.summary.multiple ? [`${result.summary.multiple} more than one`] : []), ...(result.summary.unsafe ? [`${result.summary.unsafe} unsafe`] : [])].join(", ");
}

function lastCheck(rule: MatchRuleView): string | null {
  if (!rule.record.lastBacktestJson) return null;
  try {
    return `Last check: ${backtestSummary(JSON.parse(rule.record.lastBacktestJson) as DebtBacktestResult)}`;
  } catch {
    return null;
  }
}

export function MatchingCard({ debtId, onEdit }: { debtId: string; /** Open the matching editor for a rule, or "new". */ onEdit: (ruleId: string) => void }) {
  const ctx = useMatchingContext(debtId);
  const [busy, setBusy] = useState<string | null>(null);
  const rules = ctx.rules.data ?? [];
  const hasRepaymentRule = rules.some((r) => r.record.purpose === "repayment");
  const accounts = ctx.directory.data?.accounts ?? [];

  const setEnabled = async (rule: MatchRuleView, enabled: boolean) => {
    if (!rule.conditions || !rule.actions || typeof rule.record.purpose !== "string" || !ctx.connection) return;
    try {
      setBusy(rule.record.id);
      const value: MatchRuleSave = { purpose: rule.record.purpose, conditions: rule.conditions, actions: rule.actions, enabled };
      let backtest;
      if (enabled) {
        // Turning on always re-checks the rule over the loan's history; the server refuses a weak rule and says why.
        const named = (rule.conditions as MatchConditionsV1).items.filter((c) => c.kind === "source-account").map((c) => c.accountId);
        const accountIds = named.length ? named : [ctx.defaultSource].filter(Boolean);
        backtest = { from: ctx.historyFrom, to: ctx.today, snapshots: await readMatchingHistory(getTransport(ctx.connection), { accountIds, from: ctx.historyFrom, to: ctx.today }) };
      }
      await updateMatchRule(debtId, rule.record.id, value, backtest);
      await ctx.refreshRules();
      toast.success(enabled ? "Matching is on. Transactions now uses it." : "Matching turned off");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (rule: MatchRuleView) => {
    await deleteMatchRule(debtId, rule.record.id);
    await ctx.refreshRules();
    toast.success("Matching rule removed");
  };

  return (
    <section aria-labelledby="matching-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="matching-heading" className="text-sm font-semibold">Repayment matching</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">Saved separately</span>
        {rules.length ? (
          <Button type="button" size="sm" variant="ghost" className="ml-auto" disabled={!ctx.defaultSource} onClick={() => onEdit("new")}><Plus aria-hidden="true" /> Add a rule</Button>
        ) : null}
      </div>
      {ctx.detail.data?.blocked ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">This loan is blocked: {ctx.detail.data.blocked.message}</p> : null}

      {!ctx.rules.isLoading && !hasRepaymentRule ? (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-amber-500/50 bg-amber-50/60 p-4 dark:bg-amber-950/20">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">Required step</p>
            <p className="text-base font-semibold">Tell Bench how to find your repayments in Actual</p>
            <p className="text-sm text-foreground/80">Bench looks for each scheduled repayment among your Actual transactions using a matching rule. Until a rule is on, the Transactions tab cannot propose any change for this loan.</p>
            <p className="text-xs text-muted-foreground">Bench suggests one from the accounts and repayment above, then checks it against your history before you turn it on.</p>
          </div>
          <Button type="button" disabled={!ctx.defaultSource} onClick={() => onEdit("new")}>Set up repayment matching</Button>
        </div>
      ) : null}

      {rules.length ? (
        <>
          <p className="text-xs text-muted-foreground">How Bench finds each repayment in Actual. Saved on its own, not with Save changes; turning a rule on checks it against your history first.</p>
          <ul aria-label="Matching rules" className="flex flex-col gap-2">
            {rules.map((rule) => {
              const read = rule.conditions ? conditionsToSettings(rule.conditions) : null;
              const sentence = rule.blocked ? `Cannot be used: ${rule.blocked}` : read?.ok ? ruleSentence(read.settings, accounts, ctx.minorDigits) : read?.reason ?? "This rule cannot be shown in the editor.";
              const on = rule.record.enabled;
              const check = lastCheck(rule);
              return (
                <li key={rule.record.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", on ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{on ? "On" : "Off"}</span>
                  <div className="min-w-0 flex-[1_1_260px]">
                    <p className="text-sm font-medium">{typeof rule.record.purpose === "string" ? PURPOSE_LABEL[rule.record.purpose] : "Unsupported rule"}</p>
                    <p className="text-xs text-muted-foreground">{sentence}</p>
                  </div>
                  {check ? <span className="text-xs text-muted-foreground">{check}</span> : null}
                  <Button type="button" size="sm" variant="outline" disabled={!!rule.blocked || typeof rule.record.purpose !== "string"} onClick={() => onEdit(rule.record.id)}>Edit</Button>
                  {rule.conditions && !rule.blocked ? (
                    <Button type="button" size="sm" variant={on ? "outline" : "default"} disabled={busy !== null} onClick={() => void setEnabled(rule, !on)}>
                      {busy === rule.record.id ? "Checking…" : on ? "Turn off" : "Turn on"}
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${typeof rule.record.purpose === "string" ? PURPOSE_LABEL[rule.record.purpose] : "rule"} rule`} onClick={() => void remove(rule)}>Remove</Button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}
