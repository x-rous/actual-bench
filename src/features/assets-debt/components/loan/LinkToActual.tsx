"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";
import { Switch } from "@/components/ui/switch";
import { getTransport } from "@/lib/actual";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import { contractSchedule } from "@/lib/assets-debt/tracking/plan";
import { describeRule } from "@/lib/transactions/conditions";
import type { DebtPaymentRule } from "@/lib/app-db/debtTrackingRepository";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { useTransactionReference } from "@/components/transactions/useTransactionReference";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../lib/money";
import { reconcileTrackingComponents, simulationToModel, switchToDayByDay, type SaveIssue, type SimulationState, type TrackingComponent, type TrackingState } from "../../lib/simulatorModel";
import { DEBT_TYPE_OPTIONS } from "../../lib/vocabulary";
import { AccountField, CategoryField, DateField, IntegerField, MoneyField, SelectField, TextField } from "../fields";

/**
 * Link to Actual (design spec 06 §7.1): the loan's account, how repayments are found, how interest is recorded, and
 * where tracking starts. Prefilled from a scan of the loan account, with the evidence beside the form. Saved with the
 * loan by the header's Save; saving never writes to Actual.
 */

const dt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const RECEIVABLE = "loan-receivable";

function Section({ n, done, title, lead, children }: { n: string; done?: boolean; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3">
      <span aria-hidden className={cn("mt-0.5 flex size-6 items-center justify-center rounded-full border text-xs font-semibold", done && "border-transparent bg-emerald-600 text-white dark:bg-emerald-500")}>{done ? <Check className="size-3.5" /> : n}</span>
      <div className="flex min-w-0 flex-col gap-2">
        <div><h2 className="text-sm font-semibold">{title}</h2>{lead ? <p className="text-xs text-muted-foreground">{lead}</p> : null}</div>
        {children}
      </div>
    </section>
  );
}

/** What the loan account already holds, to explain and prefill the defaults. */
export type Scan = {
  rows: SyncSourceTransaction[];
  openingRow: SyncSourceTransaction | null;
  transfersIn: number;
  lenderCharges: number;
  firstDate: string | null;
};

export function scanLoanAccount(rows: SyncSourceTransaction[], loanStart: string): Scan {
  const sorted = [...rows].filter((r) => !r.isChild).sort((a, b) => a.date.localeCompare(b.date));
  // The row that brings the loan into the account is its first: a transfer of the loan, or an opening balance.
  // A later row that adds to the debt is a draw or a charge, never the opening.
  const openingRow = sorted[0] && sorted[0].amount < 0 ? sorted[0] : null;
  const after = openingRow?.date ?? loanStart;
  return {
    rows: sorted, openingRow,
    transfersIn: sorted.filter((r) => r.amount > 0 && r.transferId).length,
    lenderCharges: sorted.filter((r) => r.amount < 0 && !r.transferId && r !== openingRow && r.date > after).length,
    firstDate: sorted[0]?.date ?? null,
  };
}

export function LinkToActual({ sim, setSimulation, tracking, setTracking, directory, issues, rules, onEditRules, saved }: {
  sim: SimulationState; /** Changes the calculation (an offset's "track from Actual"); absent when read-only. */ setSimulation?: (sim: SimulationState) => void;
  tracking: TrackingState; setTracking: (t: TrackingState) => void; directory: AccountDirectory | undefined; issues: SaveIssue[];
  /** Payment rules (saved separately), or null for a loan not saved yet. */ rules: DebtPaymentRule[] | null; onEditRules: () => void;
  /** The loan is saved, so a lender statement can be recorded for it. */ saved: boolean;
}) {
  const connection = useConnectionStore(selectActiveInstance);
  const set = (patch: Partial<TrackingState>) => setTracking({ ...tracking, ...patch });
  const issue = (field: string) => issues.find((i) => i.field === field)?.message;
  const digits = sim.minorDigits;
  const money = (minor: number) => formatAmount(minor, digits);
  const loan = directory?.accounts.find((a) => a.id === tracking.liabilityAccountId) ?? null;
  const scanQuery = useQuery({
    queryKey: ["assets-debt", "loan-scan", connection?.id, tracking.liabilityAccountId],
    queryFn: () => getTransport(connection!).listTransactionsForSync({ accountId: tracking.liabilityAccountId! }),
    enabled: !!connection && !!tracking.liabilityAccountId,
    staleTime: 60_000,
  });
  const built = useMemo(() => simulationToModel(sim), [sim]);
  const dues = useMemo(() => {
    if (!built.ok) return [];
    const run = contractSchedule(built.model, "2200-01-01");
    return run.ok ? run.dues : [];
  }, [built]);
  const scan = useMemo(() => (scanQuery.data && built.ok ? scanLoanAccount(scanQuery.data, built.model.terms.openingDate) : null), [scanQuery.data, built]);
  // The suggested start: the first installment after an opening balance well after the loan began; otherwise the first.
  const suggested = useMemo(() => {
    if (!dues.length || !built.ok) return null;
    const opening = scan?.openingRow?.date;
    const late = opening && Date.parse(opening) - Date.parse(built.model.terms.openingDate) > 31 * 86_400_000;
    return late ? dues.find((d) => d.date >= opening) ?? dues[0] : dues[0];
  }, [dues, scan, built]);
  const start = dues.find((d) => d.date === tracking.trackingStartDueDate) ?? null;
  const chosen = start ?? suggested;
  const before = chosen ? dues[chosen.no - 2] ?? null : null;
  const calculatedOpening = chosen && built.ok ? (before ? before.balanceAfterMinor : built.model.terms.openingPrincipalMinor) : null;
  // Each row counts once, as in the tracking plan: a transfer into the account after the previous installment is a
  // payment of a tracked installment (possibly made early), not part of the opening.
  const windowFrom = before?.date ?? (built.ok ? built.model.terms.openingDate : "");
  const actualOpening = scan && chosen
    ? -scan.rows.filter((r) => (r.date < chosen.date || r === scan.openingRow) && !(r.amount > 0 && r.transferId && r.date > windowFrom)).reduce((s, r) => s + r.amount, 0)
    : null;
  const statement = tracking.openingStatementDraft;
  const opening = statement ? statement.principalMinor : calculatedOpening;
  const difference = opening !== null && actualOpening !== null ? actualOpening - opening : null;
  const tolerance = tracking.driftToleranceMinor ?? 10 ** digits;
  const components = reconcileTrackingComponents(sim, tracking);
  const setComponent = (key: string, patch: Partial<TrackingComponent>) => set({ components: components.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const interest = components.find((c) => c.economicKind === "interest");
  const fees = components.filter((c) => c.economicKind !== "principal" && c.economicKind !== "interest" && c.economicKind !== "draw");
  const lenderCharged = tracking.lenderPattern === "separate-interest";
  const termLoan = sim.shape === "term-loan" && tracking.direction === "owed-by-me";
  const accountProps = { accounts: directory?.accounts ?? [], closed: "disable", allowNone: true, noneLabel: "Not chosen yet", placeholder: "Choose the loan account" } as const;
  const categoryProps = { categories: directory?.categories ?? [], side: "expense", hidden: "exclude", allowNone: true, placeholder: "Choose a category" } as const;
  const [startMode, setStartMode] = useState<"number" | "date">("number");
  const noOffBudget = directory && !directory.accounts.some((a) => a.offBudget && !a.closed);
  const ref = useTransactionReference();

  if (!termLoan) {
    return <p className="m-4 rounded-md border px-3 py-2 text-sm text-muted-foreground">Only loans you owe with a repayment schedule can be tracked in Actual. This loan stays a calculation in Terms &amp; Schedule.</p>;
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="flex flex-col gap-6 px-6 py-5">
        <Section n="1" done={!!loan?.offBudget && !!tracking.name.trim() && sim.offsets.every((o) => !!tracking.offsetAccountMap[o.placeholderAccountId])} title="Loan and its account" lead="The off-budget Actual account that holds this debt. One loan per account.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <TextField label="Name" value={tracking.name} onChange={(v) => set({ name: v })} issue={issue("name")} placeholder="Home loan" />
            <SelectField label="Kind of loan" value={tracking.debtType} options={DEBT_TYPE_OPTIONS.filter((o) => o.value !== RECEIVABLE && o.value !== "heloc")} onChange={(v) => set({ debtType: v as TrackingState["debtType"] })} />
            <AccountField {...accountProps} label="Loan account" filter={(a: { offBudget?: boolean }) => !!a.offBudget} value={tracking.liabilityAccountId ?? ""} onChange={(v) => set({ liabilityAccountId: v || null, trackingStartDueDate: null })} issue={issue("liabilityAccountId")} hint={noOffBudget ? "There is no off-budget account yet. Create one in Accounts, then choose it here." : "Off-budget accounts only: Actual keeps a loan off the budget."} />
          </div>
          {sim.profile.accrual === "per-period" && tracking.liabilityAccountId && setSimulation ? (
            <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <p className="min-w-0 flex-1">
                This loan works out interest once per repayment period. Payments made between repayment dates, which are normal when a loan is tracked from Actual, cannot be followed that way.
                Calculating day by day can; if your lender works interest out per period, the figures may differ slightly from its statements. Nothing is saved until you save the loan.
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => setSimulation(switchToDayByDay(sim))}>Calculate interest day by day</Button>
            </div>
          ) : null}
          {sim.offsets.map((o, i) => {
            const name = sim.offsets.length > 1 ? `Offset account ${i + 1}` : "Offset account";
            return (
              <div key={o.key} className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
                <AccountField {...accountProps} placeholder="Choose the offset account" label={name} value={tracking.offsetAccountMap[o.placeholderAccountId] ?? ""} exclude={[tracking.liabilityAccountId]}
                  onChange={(v) => set({ offsetAccountMap: { ...tracking.offsetAccountMap, [o.placeholderAccountId]: v } })} issue={issue(`offset:${o.key}`)} hint="The account whose balance you simulated as the offset. Required even for a draft." />
                <label className="flex items-center justify-between gap-3 text-xs md:col-span-2">
                  <span><span className="font-medium">Track offset balance from Actual</span><span className="block text-muted-foreground">Terms &amp; Schedule reads this account&apos;s balances from Actual. Nothing is written.</span></span>
                  <Switch aria-label={`Track ${name.toLowerCase()} balance from Actual`} checked={o.useActualBalance} disabled={!setSimulation}
                    onCheckedChange={(checked) => setSimulation?.({ ...sim, offsets: sim.offsets.map((item) => (item.key === o.key ? { ...item, useActualBalance: checked } : item)) })} />
                </label>
                {issue(`offsets.${i}.useActualBalance`) ? <p className="text-[11px] font-medium text-destructive md:col-span-3">{issue(`offsets.${i}.useActualBalance`)}</p> : null}
              </div>
            );
          })}
        </Section>

        <Section n="2" done={!!loan} title="Repayments" lead="Transfers into the loan account count automatically. Add a payment rule only for repayments recorded as an expense in a bank account.">
          <div className="flex flex-wrap items-center gap-2">
            {rules === null ? <p className="text-xs text-muted-foreground">Payment rules can be added once the loan is saved.</p>
              : rules.length === 0 ? <p className="text-xs text-muted-foreground">No payment rules. {scan && scan.transfersIn === 0 ? "No transfers into the loan account were found yet, so you may need one." : null}</p>
                : <ul className="flex min-w-0 flex-1 flex-col gap-1 text-xs">{rules.map((r) => <li key={r.id} className="truncate rounded-md border px-2 py-1.5"><span className="font-medium">{r.name}</span><span className="text-muted-foreground"> · {describeRule(r, ref.names)}</span></li>)}</ul>}
            {rules !== null ? <Button type="button" size="sm" variant="outline" onClick={onEditRules}><Pencil className="size-3.5" aria-hidden />{rules.length ? "Edit rules" : "Add a rule"}</Button> : null}
          </div>
        </Section>

        <Section n="3" done={!!interest?.categoryId} title="Interest" lead="How interest reaches Actual.">
          <div role="radiogroup" aria-label="How interest is recorded" className="flex w-fit flex-wrap gap-1 rounded-lg border p-1">
            {([["embedded-interest", "Split each repayment"], ["separate-interest", "Lender charges interest into the loan account"]] as const).map(([value, label]) => {
              const disabled = value === "separate-interest" && !lenderCharged && !(scan && scan.lenderCharges > 0);
              return <button key={value} type="button" role="radio" aria-checked={tracking.lenderPattern === value} disabled={disabled} title={disabled ? "Needs the lender's own interest rows in the loan account" : undefined}
                onClick={() => set({ lenderPattern: value })} className={cn("rounded-md px-3 py-1.5 text-xs", tracking.lenderPattern === value ? "bg-primary text-primary-foreground" : "text-muted-foreground disabled:opacity-50")}>{label}</button>;
            })}
          </div>
          <p className="text-xs text-muted-foreground">{lenderCharged ? "Repayments stay whole transfers; the lender's interest rows in the loan account carry the interest." : "Bench splits each repayment into a principal transfer to the loan account and an interest line."}</p>
          {!lenderCharged ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <CategoryField {...categoryProps} label="Interest category" value={interest?.categoryId ?? ""} onChange={(v) => interest && setComponent(interest.key, { categoryId: v || null })} issue={issue("config.components.1.categoryId")} />
              <CategoryField {...categoryProps} label="Loan payment category" value={tracking.loanPaymentCategoryId ?? ""} onChange={(v) => set({ loanPaymentCategoryId: v || null })} issue={issue("loanPaymentCategoryId")} hint="Actual needs a category on a transfer from a budget account to an off-budget one." />
              <TextField label="Added to the interest line" value={tracking.interestNoteSuffix} onChange={(v) => set({ interestNoteSuffix: v })} hint={`Example: ${["Mortgage payment", tracking.interestNoteSuffix.trim()].filter(Boolean).join(" ")}`} />
              <TextField label="Added to the principal line" value={tracking.principalNoteSuffix} onChange={(v) => set({ principalNoteSuffix: v })} placeholder="Nothing" hint="Each line keeps the payment's own Notes first." />
              {fees.map((f) => <CategoryField key={f.key} {...categoryProps} label={`${f.label || "Fee"} category`} value={f.categoryId ?? ""} onChange={(v) => setComponent(f.key, { categoryId: v || null })} />)}
            </div>
          ) : null}
        </Section>

        <Section n="4" done={!!start} title="Tracking start" lead="The first installment Bench tracks. Earlier installments are assumed paid as contracted, and are never matched or reported missing.">
          {!dues.length ? <p className="text-xs text-muted-foreground">Complete Terms &amp; Schedule first: the installments come from the loan&apos;s terms.</p> : (
            <>
              <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
                <div className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">Choose the first installment by</span>
                  <PillGroup<"number" | "date"> className="h-8 w-fit items-center" value={startMode} onChange={setStartMode} options={[{ value: "number", label: "Installment no." }, { value: "date", label: "Due date" }]} />
                </div>
                {startMode === "number"
                  ? <IntegerField label="First installment" min={1} value={chosen?.no ?? null} onChange={(n) => set({ trackingStartDueDate: n && dues[n - 1] ? dues[n - 1].date : null })} />
                  : <DateField label="First installment on or after" value={chosen?.date ?? ""} onChange={(d) => set({ trackingStartDueDate: dues.find((x) => x.date >= d)?.date ?? null })} />}
                <div className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">{startMode === "number" ? `Due on (installments 1 to ${dues.length})` : "Installment"}</span>
                  <span className="flex h-8 items-center font-medium">{chosen ? (startMode === "number" ? dt(chosen.date) : `No. ${chosen.no} of ${dues.length}`) : "-"}</span>
                </div>
                <div className="flex h-8 items-center">
                  {suggested && (!start || start.no !== suggested.no) ? <Button type="button" size="sm" variant="outline" onClick={() => set({ trackingStartDueDate: suggested.date })}>Use installment {suggested.no}</Button> : null}
                </div>
              </div>
              {suggested ? <p className="text-xs text-muted-foreground">{suggested.no > 1 && scan?.openingRow ? `Suggested: your loan account starts with ${scan.openingRow.transferId ? "the loan" : "an opening balance"} on ${dt(scan.openingRow.date)}, so installment ${suggested.no} (${dt(suggested.date)}) is the first one recorded there.` : "Suggested: the first installment, because the loan account holds the loan from the start."}{!start ? " Choose it to start tracking." : null}</p> : null}
              {chosen ? (
                <>
                  <div role="radiogroup" aria-label="Opening position" className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <button type="button" role="radio" aria-checked={!statement} onClick={() => set({ openingStatementDraft: null, openingObservationId: null })} className={cn("rounded-lg border px-3 py-2 text-left text-xs", !statement && "border-primary bg-accent/40")}>
                      <span className="block text-sm font-medium">Opening position from the calculation</span>
                      <span className="text-muted-foreground">The principal owed after installment {chosen.no - 1 || "0"}, if every earlier installment was paid on time.</span>
                    </button>
                    <button type="button" role="radio" aria-checked={!!statement} disabled={!saved} title={saved ? undefined : "Save the loan first"} onClick={() => set({ openingStatementDraft: statement ?? { date: before?.date ?? chosen.date, principalMinor: calculatedOpening ?? 0 } })} className={cn("rounded-lg border px-3 py-2 text-left text-xs disabled:opacity-60", statement && "border-primary bg-accent/40")}>
                      <span className="block text-sm font-medium">Use a lender statement</span>
                      <span className="text-muted-foreground">The balance and date from your lender. It&apos;s kept as a lender statement.</span>
                    </button>
                  </div>
                  {statement ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                      <DateField label="Statement date" value={statement.date} onChange={(d) => set({ openingStatementDraft: { ...statement, date: d } })} issue={statement.date > chosen.date ? "The statement must be on or before the first tracked installment" : undefined} />
                      <MoneyField label="Principal owed on that date" valueMinor={statement.principalMinor} minorDigits={digits} fixedDecimals onChange={(m) => set({ openingStatementDraft: { ...statement, principalMinor: m ?? 0 } })} />
                    </div>
                  ) : null}
                  <dl className="grid grid-cols-3 divide-x rounded-lg border text-sm">
                    <div className="px-3 py-2"><dt className="text-xs text-muted-foreground">Opening position</dt><dd className="text-base font-semibold tabular-nums">{opening === null ? "-" : money(opening)}</dd></div>
                    <div className="px-3 py-2"><dt className="text-xs text-muted-foreground">Actual&apos;s loan account before installment {chosen.no}</dt><dd className="text-base font-semibold tabular-nums">{actualOpening === null ? (scanQuery.isLoading ? "Reading…" : "-") : money(actualOpening)}</dd></div>
                    <div className="px-3 py-2"><dt className="text-xs text-muted-foreground">Difference</dt><dd className={cn("text-base font-semibold tabular-nums", difference !== null && Math.abs(difference) > tolerance && "text-amber-700 dark:text-amber-400")}>{difference === null ? "-" : money(difference)}</dd></div>
                  </dl>
                  {statement && calculatedOpening !== null && Math.abs(calculatedOpening - statement.principalMinor) > tolerance ? (
                    <p className="text-xs text-muted-foreground">
                      The original schedule expected {money(calculatedOpening)} by then, so {calculatedOpening > statement.principalMinor
                        ? <>you&apos;ve repaid about {money(calculatedOpening - statement.principalMinor)} more principal than scheduled before tracking.</>
                        : <>about {money(statement.principalMinor - calculatedOpening)} less principal than scheduled was repaid before tracking.</>}
                    </p>
                  ) : null}
                  {difference !== null ? <p className="text-xs text-muted-foreground">{Math.abs(difference) <= tolerance ? "Within the tolerance: nothing to write." : `Above the tolerance of ${money(tolerance)}. Repayments will start with one opening adjustment of ${money(Math.abs(difference))} that you can apply or skip.`}</p> : null}
                </>
              ) : null}
            </>
          )}
        </Section>

        <Section n="–" title="Advanced">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <MoneyField label="Ignore differences up to" valueMinor={tolerance} minorDigits={digits} fixedDecimals onChange={(m) => set({ driftToleranceMinor: m })} hint="In a payment amount or the loan balance (rounding)." />
            <IntegerField label="Mark missing after" suffix="days late" value={tracking.missingGraceDays} onChange={(n) => set({ missingGraceDays: n ?? 5 })} hint="With no payment found. A later payment is still matched." />
          </div>
        </Section>
      </div>

      <aside aria-label="What Bench found in Actual" className="flex flex-col gap-3 border-l px-5 py-5 text-xs">
        <h2 className="text-sm font-semibold">What Bench found in Actual</h2>
        {!loan ? <p className="text-muted-foreground">Choose the loan account to see what it holds.</p>
          : scanQuery.isLoading ? <p className="text-muted-foreground">Reading {loan.name}…</p>
            : scanQuery.isError ? <div className="flex flex-col gap-2"><p className="text-destructive">{scanQuery.error instanceof Error ? scanQuery.error.message : "The account could not be read."}</p><Button size="sm" variant="outline" className="w-fit" onClick={() => void scanQuery.refetch()}>Retry</Button></div>
              : scan ? (
                <ul className="flex list-disc flex-col gap-2 pl-4">
                  <li>{scan.rows.length} transactions in {loan.name}{scan.firstDate ? `, the first on ${dt(scan.firstDate)}` : ""}.</li>
                  {scan.openingRow ? <li>{scan.openingRow.transferId ? "The loan arrived as a transfer of" : "An opening balance of"} {money(-scan.openingRow.amount)} on {dt(scan.openingRow.date)}.</li> : <li>The account does not start with the loan: Bench compares from the first tracked installment.</li>}
                  <li>{scan.transfersIn ? `${scan.transfersIn} transfers into the loan account: these count as repayments by themselves.` : "No transfers into the loan account. If repayments are expenses in a bank account, add a payment rule."}</li>
                  <li>{scan.lenderCharges ? `${scan.lenderCharges} rows charged into the account after the opening: the lender may charge interest there.` : "No rows charged by the lender, so interest is split from each repayment."}</li>
                </ul>
              ) : null}
        <h3 className="mt-2 text-sm font-semibold">What happens next</h3>
        <ul className="flex list-disc flex-col gap-2 pl-4 text-muted-foreground">
          <li>Repayments lists each installment from the tracking start, with Apply on the ones to record.</li>
          <li>Each Apply is one write to Actual. Nothing is written until you Apply.</li>
        </ul>
      </aside>
    </div>
  );
}
