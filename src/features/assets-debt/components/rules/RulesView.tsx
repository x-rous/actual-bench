"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FlaskConical, Pencil, Plus, Power, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { getTransport } from "@/lib/actual";
import { readMatchingHistory } from "@/lib/assets-debt/actual/ledgerPort";
import type { MatchRuleSave, MatchRuleView } from "@/lib/assets-debt/services/matchingService";
import type { DebtBacktestResult, MatchConditionsV1 } from "@/lib/financial-models/matching";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { createMatchRule, deleteMatchRule, getDebt, getSchedule, listMatchRules, runMatchBacktest, updateMatchRule } from "../../lib/debtsApi";
import { useAccountDirectory } from "../../lib/useAccountDirectory";
import { BacktestResultsTable } from "./BacktestResultsTable";
import { RuleEditorDialog, type RecommendationContext } from "./RuleEditorDialog";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function inDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function ruleLabel(rule: MatchRuleView): string {
  if (typeof rule.record.purpose !== "string") return "Unsupported purpose";
  if (rule.record.purpose === "interest-charge") return "Interest charge";
  if (rule.record.purpose === "lender-repayment-row") return "Lender repayment row";
  return "Scheduled repayment";
}

/**
 * Repayment matching for one loan (RD-084; the loan's Repayment matching tab).
 * Every rule belongs to a single loan, so the rules live with it, beside the
 * Tracking setup the recommendation comes from and the Activity that uses them.
 */
export function RulesView({ debtId }: { debtId: string }) {
  const connection = useConnectionStore(selectActiveInstance);
  const directory = useAccountDirectory();
  const queryClient = useQueryClient();
  const today = useMemo(isoToday, []);
  // The history defaults to the whole loan: from its start date to today.
  const [chosenFrom, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState(today);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MatchRuleView | null>(null);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [result, setResult] = useState<{ ruleId: string; value: DebtBacktestResult } | null>(null);

  const detail = useQuery({ queryKey: ["assets-debt", "debt", debtId], queryFn: () => getDebt(debtId), enabled: !!debtId });
  const rules = useQuery({ queryKey: ["assets-debt", "match-rules", debtId], queryFn: () => listMatchRules(debtId), enabled: !!debtId });
  const openingDate = detail.data?.config.ok ? detail.data.config.config.terms.openingDate : null;
  const from = chosenFrom ?? openingDate ?? today;
  const defaultSource = detail.data?.debt.paymentAccountId ?? directory.data?.accounts.find((account) => !account.closed)?.id ?? "";
  const contractualPaymentMinor = detail.data?.config.ok ? detail.data.config.config.terms.contractualPaymentMinor : null;
  // Without a contractual repayment, recommend the next projected one.
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
  }), [detail.data, contractualPaymentMinor, projectedPaymentMinor]);

  const refreshRules = () => queryClient.invalidateQueries({ queryKey: ["assets-debt", "match-rules", debtId] });

  /** The bounded, read-only history a backtest needs: every account the rule names. */
  const backtestFor = async (conditions: MatchConditionsV1) => {
    if (!connection) throw new Error("Connect to the budget first.");
    const named = conditions.items.filter((condition) => condition.kind === "source-account").map((condition) => condition.accountId);
    const accountIds = named.length ? named : [defaultSource].filter(Boolean);
    return { from, to, snapshots: await readMatchingHistory(getTransport(connection), { accountIds, from, to }) };
  };

  // Enabling always runs a fresh backtest over the chosen history; the server refuses a weak rule or
  // one with ambiguous or unsafe periods and says why.
  const save = async (value: MatchRuleSave) => {
    const enableBacktest = value.enabled ? await backtestFor(value.conditions as MatchConditionsV1) : undefined;
    if (editing) await updateMatchRule(debtId, editing.record.id, value, enableBacktest);
    else await createMatchRule(debtId, value, enableBacktest);
    await refreshRules();
    toast.success(value.enabled ? "Matching saved and enabled" : editing ? "Matching updated (draft)" : "Matching saved as a draft");
  };

  const setEnabled = async (rule: MatchRuleView, enabled: boolean) => {
    if (!rule.conditions || !rule.actions || typeof rule.record.purpose !== "string") return;
    try {
      setRunningRuleId(rule.record.id);
      const value: MatchRuleSave = { purpose: rule.record.purpose, conditions: rule.conditions, actions: rule.actions, enabled };
      await updateMatchRule(debtId, rule.record.id, value, enabled ? await backtestFor(rule.conditions) : undefined);
      await refreshRules();
      toast.success(enabled ? "Matching enabled. Proposed changes now use it." : "Matching disabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunningRuleId(null);
    }
  };

  const remove = async (rule: MatchRuleView) => {
    await deleteMatchRule(debtId, rule.record.id);
    if (result?.ruleId === rule.record.id) setResult(null);
    await refreshRules();
    toast.success("Matching rule removed");
  };

  const run = async (rule: MatchRuleView) => {
    if (!connection || !rule.conditions) return;
    try {
      setRunningRuleId(rule.record.id);
      const namedAccountIds = rule.conditions.items.filter((condition) => condition.kind === "source-account").map((condition) => condition.accountId);
      const accountIds = namedAccountIds.length ? namedAccountIds : [defaultSource].filter(Boolean);
      const snapshots = await readMatchingHistory(getTransport(connection), { accountIds, from, to });
      const value = await runMatchBacktest(debtId, { ruleId: rule.record.id, from, to, snapshots });
      setResult({ ruleId: rule.record.id, value });
      await refreshRules();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunningRuleId(null);
    }
  };

  return (
    <>
      {!connection ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Connect to a budget to backtest debt matching rules.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Repayment matching rules</h2>
              <p className="text-sm text-muted-foreground">Compare expected debt periods with a bounded, read-only Actual transaction history. Nothing is changed in Actual.</p>
            </div>
            <Button
              size="sm"
              disabled={!debtId || !defaultSource}
              onClick={() => { setEditing(null); setEditorOpen(true); }}
            ><Plus aria-hidden /> Set up matching</Button>
          </header>

          <section className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-[150px_150px]" aria-label="Backtest scope">
            <div className="grid gap-1.5"><Label htmlFor="backtest-from">History from</Label><DateInput id="backtest-from" value={from} onValueChange={setFrom} /></div>
            <div className="grid gap-1.5"><Label htmlFor="backtest-to">History to</Label><DateInput id="backtest-to" value={to} onValueChange={setTo} /></div>
          </section>

          {rules.isLoading ? <p className="text-sm text-muted-foreground">Loading matching rules…</p> : null}
          {rules.isError ? <p role="alert" className="text-sm text-destructive">{String(rules.error)}</p> : null}
          {detail.data?.blocked ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">This loan is blocked: {detail.data.blocked.message}</p> : null}

          <div className="grid gap-2" role="list" aria-label="Matching rules">
            {(rules.data ?? []).map((rule) => (
              <article key={rule.record.id} role="listitem" className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium">{ruleLabel(rule)}</p>
                  <p className="text-xs text-muted-foreground">
                    {rule.blocked ? `Blocked: ${rule.blocked}` : `${rule.conditions?.items.length ?? 0} conditions · ${rule.record.enabled ? "Enabled" : "Draft: not used by Proposed changes until enabled"}`}
                  </p>
                </div>
                {rule.conditions ? (
                  <Button size="sm" variant="outline" disabled={runningRuleId !== null || !from || !to || from > to} onClick={() => void run(rule)}>
                    <FlaskConical aria-hidden />{runningRuleId === rule.record.id ? "Running…" : "Run backtest"}
                  </Button>
                ) : null}
                {rule.conditions && !rule.blocked ? (
                  <Button size="sm" variant={rule.record.enabled ? "outline" : "default"} disabled={runningRuleId !== null || (!rule.record.enabled && (!from || !to || from > to))} onClick={() => void setEnabled(rule, !rule.record.enabled)}>
                    <Power aria-hidden />{rule.record.enabled ? "Disable" : "Enable"}
                  </Button>
                ) : null}
                <Button size="icon-sm" variant="ghost" disabled={!!rule.blocked || typeof rule.record.purpose !== "string"} aria-label={`Edit ${ruleLabel(rule)} rule`} onClick={() => { setEditing(rule); setEditorOpen(true); }}><Pencil aria-hidden /></Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${ruleLabel(rule)} rule`} onClick={() => void remove(rule)}><Trash2 aria-hidden /></Button>
              </article>
            ))}
          </div>
          {rules.data?.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No matching yet. Choose Set up matching for the recommended setup from Tracking setup, then backtest it against history.</p> : null}

          {result ? (
            <section className="grid gap-3" aria-labelledby="backtest-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 id="backtest-heading" className="text-sm font-semibold">Backtest results</h3>
                  <p className="text-xs text-muted-foreground">{result.value.summary.unique} unique · {result.value.summary.missing} missing · {result.value.summary.multiple} multiple · {result.value.summary.unsafe} unsafe</p>
                </div>
                <p className="text-xs text-muted-foreground">Read {result.value.read.transactions} transactions from {result.value.read.accounts} account{result.value.read.accounts === 1 ? "" : "s"}</p>
              </div>
              {result.value.warnings.length ? <div role="alert" className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden /><span>{result.value.warnings.join(" ")}</span></div> : null}
              <BacktestResultsTable result={result.value} minorDigits={detail.data?.debt.currencyMinorDigits ?? 2} />
              <p className="text-xs text-muted-foreground">Projected balance variance is a read-only matching counterfactual, not a lender-balance observation or reconciliation anchor.</p>
            </section>
          ) : null}
        </div>
      )}

      <RuleEditorDialog
        open={editorOpen}
        rule={editing}
        recommendation={recommendation}
        accounts={directory.data?.accounts ?? []}
        categories={directory.data?.categories ?? []}
        currency={detail.data?.debt.currency ?? ""}
        minorDigits={detail.data?.debt.currencyMinorDigits ?? 2}
        onOpenChange={setEditorOpen}
        onSave={save}
      />
    </>
  );
}
