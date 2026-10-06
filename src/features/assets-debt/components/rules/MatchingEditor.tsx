"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DebtMatchPurpose } from "@/lib/app-db/types";
import { getTransport } from "@/lib/actual";
import { readFreshMatchingHistory } from "../../lib/freshHistory";
import type { MatchRuleView } from "@/lib/assets-debt/services/matchingService";
import type { DebtBacktestResult } from "@/lib/financial-models/matching";
import { cn } from "@/lib/utils";
import { checkDraftMatchRule, createMatchRule, updateMatchRule } from "../../lib/debtsApi";
import { conditionsToSettings, defaultActions, recommendedSettings, settingsToConditions, type AmountFilter, type MatchingSettings } from "../../lib/matchingRuleBuilder";
import { DateField, IntegerField, MoneyField, SelectField, TextField } from "../fields";
import { formatAmount } from "../../lib/money";
import { isHandled } from "./BacktestResultsTable";
import { PURPOSE_LABEL } from "./MatchingCard";
import { useMatchingContext, type RecommendationContext } from "./useMatchingContext";

/**
 * The repayment matching editor (RD-084 T280 rev 2; FR-075a, FR-206). Its own page inside the
 * loan's Settings tab: the rule on the left, written as one editable sentence suggested from the
 * loan's settings, with optional extra conditions; on the right, a live read-only check of the
 * rule against the loan's history. "Save and turn on" is offered only when every due date found
 * exactly one payment or is already handled; the server re-checks before it turns the rule on.
 * Nobody edits the matching DSL; the generated rule is shown read-only under Technical details.
 */

const PURPOSE_HINT: Record<DebtMatchPurpose, string> = {
  repayment: "How to recognise your repayments when they are not transfers into the loan account. Bench lines them up with the due dates itself: no day window, and amounts only need to be roughly right.",
  "lender-repayment-row": "Only if your lender's own transactions are imported into the loan account. Bench links them to your payments so the money counts once.",
  "interest-charge": "Only if your lender charges interest as its own transaction in the loan account. Bench links each charge to the period it belongs to.",
};

export function MatchingEditor({ debtId, ruleId, onClose }: { debtId: string; /** A rule id, or "new". */ ruleId: string; onClose: () => void }) {
  const ctx = useMatchingContext(debtId);
  const rule = ruleId === "new" ? null : ctx.rules.data?.find((r) => r.record.id === ruleId) ?? null;
  const ready = !!ctx.detail.data && !!ctx.directory.data && (ruleId === "new" || !!ctx.rules.data);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4">
      <div>
        <Button type="button" variant="link" size="sm" className="h-auto gap-1 p-0 text-xs" onClick={onClose}><ArrowLeft aria-hidden="true" className="size-3.5" /> Back to Link to Actual</Button>
        <h2 className="mt-2 text-lg font-semibold">{rule ? "Edit repayment matching" : "Set up repayment matching"}</h2>
        <p className="text-xs text-muted-foreground">Bench uses this to find each repayment of {ctx.detail.data?.debt.name ?? "this loan"} among your Actual transactions. It only reads Actual; it never creates an Actual rule or changes a transaction.</p>
      </div>
      {!ctx.connection ? <p className="text-sm text-muted-foreground">Connect to the budget to set up matching.</p> : null}
      {ruleId !== "new" && ctx.rules.data && !rule ? <p role="alert" className="text-sm text-destructive">That matching rule no longer exists.</p> : null}
      {ready && ctx.connection && (ruleId === "new" || rule) ? <EditorBody key={ruleId} debtId={debtId} rule={rule} ctx={ctx} onClose={onClose} /> : null}
    </div>
  );
}

type Ctx = ReturnType<typeof useMatchingContext>;

function initialState(rule: MatchRuleView | null, recommendation: RecommendationContext): { purpose: DebtMatchPurpose; settings: MatchingSettings | null; unrepresentable: string | null } {
  const purpose = rule && typeof rule.record.purpose === "string" ? rule.record.purpose : "repayment";
  if (rule?.conditions) {
    const read = conditionsToSettings(rule.conditions);
    return { purpose, settings: read.ok ? read.settings : null, unrepresentable: read.ok ? null : read.reason };
  }
  return { purpose, settings: recommendedSettings({ ...recommendation, purpose }), unrepresentable: null };
}

function EditorBody({ debtId, rule, ctx, onClose }: { debtId: string; rule: MatchRuleView | null; ctx: Ctx; onClose: () => void }) {
  const [initial] = useState(() => initialState(rule, ctx.recommendation));
  const [purpose, setPurpose] = useState<DebtMatchPurpose>(initial.purpose);
  const [settings, setSettings] = useState<MatchingSettings | null>(initial.settings);
  const [unrepresentable, setUnrepresentable] = useState<string | null>(initial.unrepresentable);
  const [moreOpen, setMoreOpen] = useState(false);
  const [from, setFrom] = useState(ctx.historyFrom);
  const [to, setTo] = useState(ctx.today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = ctx.minorDigits;
  const accounts = ctx.directory.data?.accounts ?? [];
  const categories = ctx.directory.data?.categories ?? [];
  const suggest = (p: DebtMatchPurpose) => recommendedSettings({ ...ctx.recommendation, purpose: p });
  const update = (patch: Partial<MatchingSettings>) => setSettings((current) => (current ? { ...current, ...patch } : current));
  const setAmount = (amount: AmountFilter) => update({ amount });

  const generated = useMemo(() => {
    if (!settings) return { ok: false as const, message: "" };
    try {
      return { ok: true as const, conditions: settingsToConditions(settings) };
    } catch (cause) {
      return { ok: false as const, message: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [settings]);

  // The history is read once per account and range; the check re-runs on the server as the rule changes.
  const accountIds = generated.ok ? generated.conditions.items.filter((c) => c.kind === "source-account").map((c) => c.accountId) : [];
  // The loan account too: every transfer into it is one of the loan's payments (owner decision 2026-10-07).
  const liabilityId = ctx.detail.data?.debt.liabilityAccountId ?? null;
  const readIds = [...new Set([...(accountIds.length ? accountIds : [ctx.defaultSource]), ...(liabilityId ? [liabilityId] : [])])].filter(Boolean);
  const history = useQuery({
    queryKey: ["assets-debt", "match-history", ctx.connection?.id, readIds.join("|"), from, to],
    queryFn: () => readFreshMatchingHistory(getTransport(ctx.connection!), { accountIds: readIds, from, to }),
    enabled: !!ctx.connection && readIds.length > 0 && !!from && !!to && from <= to,
    staleTime: 5 * 60_000,
  });
  const ruleBody = generated.ok ? { purpose, conditions: generated.conditions, actions: rule?.actions ?? defaultActions() } : null;
  const check = useQuery({
    queryKey: ["assets-debt", "match-check", debtId, JSON.stringify(ruleBody), from, to, history.dataUpdatedAt],
    queryFn: () => checkDraftMatchRule(debtId, { rule: ruleBody!, from, to, snapshots: history.data! }),
    enabled: !!ruleBody && !!history.data,
    placeholderData: keepPreviousData,
  });
  const result = check.data;
  // A missed due date does not stop matching (it shows on Sync Repayments, where the payment can be
  // chosen); only a payment Bench could never change does (owner decision 2026-10-07).
  const clean = !!result && !check.isFetching && result.summary.unsafe === 0;

  const save = async (enabled: boolean) => {
    if (!ruleBody) return;
    try {
      setSaving(true);
      setError(null);
      const value = { ...ruleBody, enabled };
      const backtest = enabled && history.data ? { from, to, snapshots: history.data } : undefined;
      if (rule) await updateMatchRule(debtId, rule.record.id, value, backtest);
      else await createMatchRule(debtId, value, backtest);
      await ctx.refreshRules();
      toast.success(enabled ? "Matching saved and turned on" : "Matching saved (off)");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const purposes: DebtMatchPurpose[] = ["repayment", "lender-repayment-row", ...(ctx.lenderPattern === "separate-interest" ? ["interest-charge" as const] : [])];
  // Off-budget rows carry no category in Actual: a category condition there can never match.
  const offBudgetCategory = settings?.category.mode === "exact" && !!accounts.find((a) => a.id === settings?.sourceAccountId)?.offBudget;
  const accountOptions = accounts.filter((a) => !a.closed).map((a) => ({ value: a.id, label: `${a.name}${a.offBudget ? " (off budget)" : ""}` }));
  const categoryOptions = [{ value: "", label: "Any category" }, { value: "__empty", label: "Uncategorized only" }, ...categories.filter((c) => !c.hidden).map((c) => ({ value: c.id, label: `${c.groupName}: ${c.name}` }))];
  const amount = settings?.amount;
  const loanAccountName = accounts.find((a) => a.id === ctx.detail.data?.debt.liabilityAccountId)?.name ?? null;
  const inline = "inline-flex w-auto align-middle";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span id="purpose-label" className="text-xs font-medium text-muted-foreground">What should Bench find?</span>
            <div role="group" aria-labelledby="purpose-label" className="inline-flex w-fit flex-wrap gap-0.5 rounded-lg border border-border p-0.5">
              {purposes.map((p) => (
                <button key={p} type="button" aria-pressed={purpose === p} className={cn("rounded-md px-3 py-1.5 text-xs", purpose === p ? "bg-foreground text-background" : "hover:bg-muted")}
                  onClick={() => { setPurpose(p); if (!rule) { setSettings(suggest(p)); setUnrepresentable(null); } }}>
                  {PURPOSE_LABEL[p]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{PURPOSE_HINT[purpose]}</p>
          </div>

          {unrepresentable ? (
            <div role="alert" className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
              <p>{unrepresentable}</p>
              <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => { setSettings(suggest(purpose)); setUnrepresentable(null); }}>Replace with the suggested rule</Button>
            </div>
          ) : null}

          {settings ? (
            <section aria-label="Bench will look for" className="flex flex-col gap-2 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="text-sm font-semibold">Bench will look for</p>
                {!rule ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">Suggested from your loan settings</span> : null}
                <Button type="button" variant="ghost" size="sm" className="ml-auto h-auto px-2 py-1 text-xs" onClick={() => setSettings(suggest(purpose))}>Reset to suggestion</Button>
              </div>
              {purpose === "repayment" && loanAccountName ? (
                <p className="rounded-md bg-muted/60 px-3 py-2 text-xs">Transfers into <span className="font-medium">{loanAccountName}</span> are found on their own, on any date and for any amount. This rule adds repayments that are not transfers.</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm leading-8">
                <span>a payment</span>
                <SelectField hideLabel label="Direction" className={inline} value={settings.direction} options={[{ value: "outflow", label: "out of" }, { value: "inflow", label: "into" }, { value: "either", label: "in or out of" }]} onChange={(v) => update({ direction: v as MatchingSettings["direction"] })} />
                <SelectField hideLabel label="Account" className={inline} value={settings.sourceAccountId} options={accountOptions} onChange={(v) => update({ sourceAccountId: v })} />
                <span>of</span>
                <SelectField hideLabel label="Amount" className={inline} value={settings.amount.mode} options={[{ value: "approximate", label: "about" }, { value: "exact", label: "exactly" }, { value: "between", label: "between" }, { value: "any", label: "any amount" }]}
                  onChange={(v) => {
                    const previous = settings.amount;
                    const known = previous.mode === "exact" || previous.mode === "approximate" ? previous.amountMinor : ctx.recommendation.expectedPaymentMinor ?? 0;
                    setAmount(v === "exact" ? { mode: "exact", amountMinor: known }
                      : v === "approximate" ? { mode: "approximate", amountMinor: known, tolerance: { kind: "absolute", amountMinor: ctx.recommendation.toleranceMinor } }
                        : v === "between" ? { mode: "between", minMinor: known, maxMinor: known }
                          : { mode: "any" });
                  }} />
                {amount?.mode === "exact" || amount?.mode === "approximate" ? <MoneyField fixedDecimals hideLabel label="Expected amount" className="w-32" valueMinor={amount.amountMinor} minorDigits={digits} onChange={(v) => setAmount({ ...amount, amountMinor: v ?? 0 })} /> : null}
                {amount?.mode === "approximate" && amount.tolerance.kind === "absolute" ? (
                  <><span>give or take</span><MoneyField fixedDecimals hideLabel label="Amount tolerance" className="w-24" valueMinor={amount.tolerance.amountMinor} minorDigits={digits} onChange={(v) => setAmount({ ...amount, tolerance: { kind: "absolute", amountMinor: v ?? 0 } })} /></>
                ) : null}
                {amount?.mode === "between" ? (
                  <><MoneyField fixedDecimals hideLabel label="From amount" className="w-32" valueMinor={amount.minMinor} minorDigits={digits} onChange={(v) => setAmount({ ...amount, minMinor: v ?? 0 })} /><span>and</span><MoneyField fixedDecimals hideLabel label="To amount" className="w-32" valueMinor={amount.maxMinor} minorDigits={digits} onChange={(v) => setAmount({ ...amount, maxMinor: v ?? 0 })} /></>
                ) : null}
              </div>
              <p className="text-[11px] text-muted-foreground">Payments Bench already changed, or linked to another loan, are never matched again.</p>
            </section>
          ) : null}

          {settings ? (
            <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <Button type="button" variant="ghost" size="sm" className="-ml-2 h-auto w-fit gap-1 px-2 py-0 text-sm font-semibold" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                {moreOpen ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
                More conditions (optional)
              </Button>
              {moreOpen ? (
                <div role="region" aria-label="More conditions" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SelectField label="Category is" issue={offBudgetCategory ? "This account is off budget, and Actual keeps no category on its rows, so this condition never matches. Set it to any category, or look in the account the payment comes from." : undefined} value={settings.category.mode === "exact" ? settings.category.categoryId : settings.category.mode === "empty" ? "__empty" : ""} options={categoryOptions} onChange={(v) => update({ category: v === "" ? { mode: "any" } : v === "__empty" ? { mode: "empty" } : { mode: "exact", categoryId: v } })} />
                  <TextField label="Bank text contains" value={settings.importedPayeeContains} onChange={(v) => update({ importedPayeeContains: v })} placeholder="For example LOAN REPAYMENT" />
                  <TextField label="Notes contain" value={settings.notesContains} onChange={(v) => update({ notesContains: v })} />
                  <IntegerField label="Only on day of month" hint="Empty uses the due dates alone." value={settings.dayOfMonth} min={1} onChange={(v) => update({ dayOfMonth: v === null ? null : Math.min(31, Math.max(1, v)) })} />
                  <IntegerField label="Days before a due date" hint="Only used when nothing above says what the payment looks like (any amount, no payee or text)." value={settings.daysEarly} min={0} onChange={(v) => update({ daysEarly: v ?? 0 })} />
                  <IntegerField label="Days after a due date" value={settings.daysLate} min={0} onChange={(v) => update({ daysLate: v ?? 0 })} />
                  <SelectField label="Already a transfer" value={settings.transfer} options={[{ value: "any", label: "Either" }, { value: "present", label: "Yes" }, { value: "none", label: "No" }]} onChange={(v) => update({ transfer: v as MatchingSettings["transfer"] })} />
                  <SelectField label="Split" value={settings.split} options={[{ value: "any", label: "Either" }, { value: "single", label: "Not split" }, { value: "child", label: "A split line" }]} onChange={(v) => update({ split: v as MatchingSettings["split"] })} />
                  <SelectField label="Cleared" value={settings.cleared} options={[{ value: "any", label: "Either" }, { value: "cleared", label: "Cleared" }, { value: "uncleared", label: "Not cleared" }]} onChange={(v) => update({ cleared: v as MatchingSettings["cleared"] })} />
                  <SelectField label="Reconciled" value={settings.reconciled} options={[{ value: "any", label: "Either" }, { value: "unreconciled", label: "Not reconciled" }]} onChange={(v) => update({ reconciled: v as MatchingSettings["reconciled"] })} />
                  {settings.preserved.length ? <p className="text-xs text-muted-foreground sm:col-span-2">{settings.preserved.length} more condition{settings.preserved.length === 1 ? " is" : "s are"} kept from the existing rule.</p> : null}
                </div>
              ) : null}
              <details className="text-[11px] text-muted-foreground">
                <summary className="cursor-pointer">Technical details</summary>
                {generated.ok ? <pre aria-label="Generated matching rule" className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2">{JSON.stringify(generated.conditions, null, 2)}</pre> : <p className="text-destructive">{generated.message}</p>}
              </details>
            </section>
          ) : null}
        </div>

        <section aria-label="Check against your history" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-[1_1_200px]">
              <p className="text-sm font-semibold">Check against your history</p>
              <p className="text-[11px] text-muted-foreground">Bench tries the rule on every due date in this range. Read only.</p>
            </div>
            <DateField label="From" value={from} onChange={setFrom} />
            <DateField label="To" value={to} onChange={setTo} />
            <Button type="button" size="sm" variant="outline" disabled={history.isFetching || check.isFetching} onClick={() => { void history.refetch(); }}>Check again</Button>
          </div>
          {history.isError || check.isError ? <p role="alert" className="text-xs text-destructive">{String(((history.error ?? check.error) as Error)?.message ?? "The check failed.")}</p> : null}
          {history.isFetching && !history.data ? <p className="text-xs text-muted-foreground">Reading your history from Actual…</p> : null}
          {result ? <CheckResult result={result} digits={digits} refreshing={check.isFetching} /> : null}
        </section>
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="outline" disabled={saving || !generated.ok} onClick={() => void save(false)}>Save without turning on</Button>
        <Button type="button" disabled={saving || !generated.ok || !clean} title={clean ? undefined : "A matched payment cannot be changed by Bench; see the check"} onClick={() => void save(true)}>Save and turn on</Button>
      </div>
    </div>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div className="flex min-w-24 flex-col rounded-lg border border-border px-3 py-2">
      <span className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function CheckResult({ result, digits, refreshing }: { result: DebtBacktestResult; digits: number; refreshing: boolean }) {
  const handled = result.periods.filter(isHandled).length;
  const review = result.periods.filter((p) => !isHandled(p) && p.status === "unique" && p.reviewReasons.length).length;
  const problems = result.summary.unsafe + result.summary.multiple;
  return (
    <div className={cn("flex flex-col gap-3", refreshing && "opacity-60")} aria-busy={refreshing}>
      <div className="flex flex-wrap gap-2">
        <Stat value={result.summary.unique} label="found one payment" tone="text-emerald-700 dark:text-emerald-300" />
        <Stat value={handled} label="already handled" />
        <Stat value={result.summary.missing} label="missed" tone={result.summary.missing ? "text-amber-700 dark:text-amber-300" : undefined} />
        {result.summary.multiple ? <Stat value={result.summary.multiple} label="more than one" tone="text-amber-700 dark:text-amber-300" /> : null}
        {review ? <Stat value={review} label="to look at" tone="text-amber-700 dark:text-amber-300" /> : null}
        {result.summary.unsafe ? <Stat value={result.summary.unsafe} label="cannot be changed" tone="text-destructive" /> : null}
      </div>
      <p role="status" className={cn("rounded-lg border px-3 py-2 text-sm", problems ? "border-amber-500/50 bg-amber-50/60 dark:bg-amber-950/20" : "border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-950/20")}>
        {problems
          ? `${problems} matched payment${problems === 1 ? "" : "s"} cannot be changed by Bench (see below). Fix ${problems === 1 ? "it" : "them"} in Actual, or save the rule without turning it on meanwhile.`
          : result.summary.missing
            ? `Ready to turn on. ${result.summary.missing} due date${result.summary.missing === 1 ? " has" : "s have"} no payment: ${result.summary.missing === 1 ? "it shows" : "they show"} on Sync Repayments, where you can choose the payment.`
            : "Ready to turn on: every due date has its payment or is already handled."}
      </p>
      {result.warnings.length ? <p className="text-xs text-amber-800 dark:text-amber-300">{result.warnings.join(" ")}</p> : null}
      <CheckTable result={result} digits={digits} />
    </div>
  );
}

const RESULT: Record<string, { label: string; tone: string }> = {
  unique: { label: "Found", tone: "text-emerald-700 dark:text-emerald-300" },
  missing: { label: "Missed", tone: "text-amber-700 dark:text-amber-300" },
  multiple: { label: "More than one", tone: "text-amber-700 dark:text-amber-300" },
  unsafe: { label: "Cannot be changed", tone: "text-destructive" },
};

/** The check per due date, sized for half the page: what was found in Actual and how early or late. */
function CheckTable({ result, digits }: { result: DebtBacktestResult; digits: number }) {
  const timing = (days: number) => (days === 0 ? "on the day" : days < 0 ? `${-days} day${days === -1 ? "" : "s"} early` : `${days} day${days === 1 ? "" : "s"} late`);
  return (
    <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-border">
      <table aria-label="Check per due date" className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
          <tr><th scope="col" className="px-2 py-1.5 font-normal">Due</th><th scope="col" className="px-2 py-1.5 font-normal">Result</th><th scope="col" className="px-2 py-1.5 font-normal">Found in Actual</th></tr>
        </thead>
        <tbody>
          {result.periods.map((period) => {
            const handled = isHandled(period);
            const toLook = !handled && period.status === "unique" && period.reviewReasons.length > 0;
            const look = handled ? { label: "Already handled", tone: "text-muted-foreground" } : toLook ? { label: "Found, to look at", tone: "text-amber-700 dark:text-amber-300" } : RESULT[period.status] ?? { label: period.status, tone: "" };
            const found = period.candidates[0];
            const detail = handled
              ? "Bench already applied a change for this date"
              : period.status === "missing" ? period.reviewReasons[0] ?? "No payment to this loan was found for this due date."
                : period.status === "multiple" ? `${period.candidates.length} payments match`
                  : found ? `${found.candidate.date} · ${formatAmount(Math.abs(found.candidate.amountMinor), digits)} · ${timing(found.deviation.days)}` : "";
            return (
              <tr key={period.expected.periodKey} className="border-t border-border/60">
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{period.expected.date}</td>
                <td className={cn("whitespace-nowrap px-2 py-1.5 font-medium", look.tone)}>{look.label}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{detail}{toLook ? <span className="block text-amber-800 dark:text-amber-300">{period.reviewReasons.join(" ")}</span> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
