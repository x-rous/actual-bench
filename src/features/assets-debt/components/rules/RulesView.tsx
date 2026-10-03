"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FlaskConical, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getTransport } from "@/lib/actual";
import { readMatchingHistory } from "@/lib/assets-debt/actual/ledgerPort";
import type { MatchRuleSave, MatchRuleView } from "@/lib/assets-debt/services/matchingService";
import type { DebtBacktestResult } from "@/lib/financial-models/matching";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { createMatchRule, deleteMatchRule, getDebt, listDebts, listMatchRules, runMatchBacktest, updateMatchRule } from "../../lib/debtsApi";
import { useAccountDirectory } from "../../lib/useAccountDirectory";
import { AssetsDebtShell } from "../AssetsDebtViews";
import { BacktestResultsTable } from "./BacktestResultsTable";
import { RuleEditorDialog } from "./RuleEditorDialog";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function twoYearsBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 2);
  return date.toISOString().slice(0, 10);
}

function ruleLabel(rule: MatchRuleView): string {
  if (typeof rule.record.purpose !== "string") return "Unsupported purpose";
  if (rule.record.purpose === "interest-charge") return "Interest charge";
  if (rule.record.purpose === "lender-repayment-row") return "Lender repayment row";
  return "Scheduled repayment";
}

export function RulesView() {
  const connection = useConnectionStore(selectActiveInstance);
  const directory = useAccountDirectory();
  const queryClient = useQueryClient();
  const today = useMemo(isoToday, []);
  const [selectedId, setSelectedId] = useState("");
  const [from, setFrom] = useState(twoYearsBefore(today));
  const [to, setTo] = useState(today);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MatchRuleView | null>(null);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [result, setResult] = useState<{ ruleId: string; value: DebtBacktestResult } | null>(null);

  const debts = useQuery({
    queryKey: ["assets-debt", "debts", connection?.budgetSyncId],
    queryFn: () => listDebts(connection!.budgetSyncId),
    enabled: !!connection,
  });
  const debtId = selectedId || debts.data?.[0]?.id || "";
  const detail = useQuery({ queryKey: ["assets-debt", "debt", debtId], queryFn: () => getDebt(debtId), enabled: !!debtId });
  const rules = useQuery({ queryKey: ["assets-debt", "match-rules", debtId], queryFn: () => listMatchRules(debtId), enabled: !!debtId });
  const debt = debts.data?.find((item) => item.id === debtId);
  const defaultSource = detail.data?.debt.paymentAccountId ?? directory.data?.accounts.find((account) => !account.closed)?.id ?? "";

  const refreshRules = () => queryClient.invalidateQueries({ queryKey: ["assets-debt", "match-rules", debtId] });
  const save = async (value: MatchRuleSave) => {
    if (editing) await updateMatchRule(debtId, editing.record.id, value);
    else await createMatchRule(debtId, value);
    await refreshRules();
    toast.success(editing ? "Matching rule updated" : "Matching rule added");
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
    <AssetsDebtShell title="Assets & Debt" scrollManaged>
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
            ><Plus aria-hidden /> Add rule</Button>
          </header>

          <section className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-[minmax(220px,1fr)_150px_150px]" aria-label="Backtest scope">
            <div className="grid gap-1.5">
              <Label htmlFor="matching-debt">Debt</Label>
              <Select id="matching-debt" value={debtId} onValueChange={(value) => { setSelectedId(value); setResult(null); }} options={(debts.data ?? []).map((item) => ({ value: item.id, label: item.name }))} placeholder="Choose a debt" />
            </div>
            <div className="grid gap-1.5"><Label htmlFor="backtest-from">History from</Label><DateInput id="backtest-from" value={from} onValueChange={setFrom} /></div>
            <div className="grid gap-1.5"><Label htmlFor="backtest-to">History to</Label><DateInput id="backtest-to" value={to} onValueChange={setTo} /></div>
          </section>

          {debts.isLoading || rules.isLoading ? <p className="text-sm text-muted-foreground">Loading matching rules…</p> : null}
          {debts.isError || rules.isError ? <p role="alert" className="text-sm text-destructive">{String(debts.error ?? rules.error)}</p> : null}
          {debt?.blocked ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">This debt is blocked: {debt.blocked.message}</p> : null}

          <div className="grid gap-2" role="list" aria-label="Matching rules">
            {(rules.data ?? []).map((rule) => (
              <article key={rule.record.id} role="listitem" className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium">{ruleLabel(rule)}</p>
                  <p className="text-xs text-muted-foreground">
                    {rule.blocked ? `Blocked: ${rule.blocked}` : `${rule.conditions?.items.length ?? 0} conditions · ${rule.record.enabled ? "Enabled" : "Draft"}`}
                  </p>
                </div>
                {rule.conditions ? (
                  <Button size="sm" variant="outline" disabled={runningRuleId !== null || !from || !to || from > to} onClick={() => void run(rule)}>
                    <FlaskConical aria-hidden />{runningRuleId === rule.record.id ? "Running…" : "Run backtest"}
                  </Button>
                ) : null}
                <Button size="icon-sm" variant="ghost" disabled={!!rule.blocked || typeof rule.record.purpose !== "string"} aria-label={`Edit ${ruleLabel(rule)} rule`} onClick={() => { setEditing(rule); setEditorOpen(true); }}><Pencil aria-hidden /></Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${ruleLabel(rule)} rule`} onClick={() => void remove(rule)}><Trash2 aria-hidden /></Button>
              </article>
            ))}
          </div>
          {rules.data?.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No matching rules yet. Add a draft rule, then backtest it against history.</p> : null}

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
              <BacktestResultsTable result={result.value} minorDigits={debt?.currencyMinorDigits ?? 2} />
              <p className="text-xs text-muted-foreground">Projected balance variance is a read-only matching counterfactual, not a lender-balance observation or reconciliation anchor.</p>
            </section>
          ) : null}
        </div>
      )}

      <RuleEditorDialog open={editorOpen} rule={editing} sourceAccountId={defaultSource} onOpenChange={setEditorOpen} onSave={save} />
    </AssetsDebtShell>
  );
}
