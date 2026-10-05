"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { getTransport } from "@/lib/actual";
import type { DebtObservationRecord } from "@/lib/app-db/debtObservationRepository";
import { readDatedBalance, toDebtMagnitude } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import type { OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import { cn } from "@/lib/utils";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { acceptDebtDrift, createDebtAnchor, getDebtReconciliation, listDebtObservations, recordDebtObservation, removeDebtObservation, runConventionDiagnostic } from "../../lib/debtsApi";
import { formatAmount } from "../../lib/money";
import { MoneyField } from "../fields";

/**
 * Lender statements (RD-084 P1.5 rev 4, owner-approved mockup): what the lender says, compared with
 * Bench's calculation and with Actual, to see which side is off. The latest statement comes first
 * with a plain verdict and the actions that fit it, each explained; adding a statement is one form;
 * every statement is listed with the figures at its date. Nothing here writes to Actual.
 */

const today = () => new Date().toISOString().slice(0, 10);
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

type Ctx = { debt: DebtDetail; offsetHistories?: OffsetHistorySnapshot[] };

/** The lender's figure, Actual and the calculation on one date (read only). */
function useComparison({ debt, offsetHistories }: Ctx, date: string | null) {
  const connection = useConnectionStore(selectActiveInstance);
  const actual = useQuery({
    queryKey: ["assets-debt", "dated-liability-balance", connection?.id, debt.debt.liabilityAccountId, date],
    queryFn: async () => {
      if (!connection || !debt.debt.liabilityAccountId) throw new Error("Choose the loan account in Settings first.");
      return readDatedBalance(getTransport(connection), { accountId: debt.debt.liabilityAccountId, date: date! });
    },
    enabled: !!connection && !!debt.debt.liabilityAccountId && !!date,
  });
  const actualMinor = actual.data?.ok && typeof debt.debt.signConvention === "string" ? toDebtMagnitude(actual.data.balanceMinor, debt.debt.signConvention) : null;
  const reconciliation = useQuery({
    queryKey: ["assets-debt", "reconciliation", debt.debt.id, date, actualMinor, offsetHistories],
    queryFn: () => getDebtReconciliation(debt.debt.id, { comparisonDate: date!, actualBalanceMinor: actualMinor!, offsetHistories }),
    enabled: !!date && actualMinor !== null && actualMinor >= 0 && (!debt.offsets.some((offset) => offset.useActualBalance) || offsetHistories !== undefined),
  });
  return { actual, actualMinor, reconciliation };
}

type Verdict = { text: string; detail: string; calcOff: boolean; actualOff: boolean };

export function verdictOf(input: { lenderMinor: number; actualMinor: number | null; calculatedMinor: number | null; toleranceMinor: number; digits: number }): Verdict {
  const money = (minor: number) => formatAmount(Math.abs(minor), input.digits);
  const off = (value: number | null) => (value === null ? null : value - input.lenderMinor);
  const actualDiff = off(input.actualMinor);
  const calcDiff = off(input.calculatedMinor);
  const actualOff = actualDiff !== null && Math.abs(actualDiff) > input.toleranceMinor;
  const calcOff = calcDiff !== null && Math.abs(calcDiff) > input.toleranceMinor;
  if (!actualOff && !calcOff) return { text: "Actual and the calculation agree with the lender.", detail: "Nothing to fix.", calcOff, actualOff };
  if (!actualOff) return { text: `Actual agrees with the lender; the calculation is off by ${money(calcDiff!)}.`, detail: "Your transactions are right. The calculation usually differs because of how interest is worked out, or because repayments were paid at other times than scheduled.", calcOff, actualOff };
  if (!calcOff) return { text: `The calculation agrees with the lender; Actual is off by ${money(actualDiff!)}.`, detail: "Usually a missing, duplicate or wrong transaction in the loan account in Actual. Check the loan account around the statement date.", calcOff, actualOff };
  return { text: "Neither Actual nor the calculation matches the lender.", detail: "Check the loan account in Actual first, then the calculation method.", calcOff, actualOff };
}

function Figure({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "ok" | "off" | "ref" }) {
  return (
    <div className={cn("flex min-w-36 flex-1 flex-col gap-0.5 rounded-lg border px-3 py-2", tone === "off" ? "border-amber-500/60" : "border-border", tone === "ref" && "bg-muted/40")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-semibold tabular-nums">{value}</span>
      <span className={cn("text-[11px]", tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : tone === "off" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{note}</span>
    </div>
  );
}

export function LenderReconciliation({ debt, offsetHistories }: Ctx) {
  const queryClient = useQueryClient();
  const digits = debt.debt.currencyMinorDigits;
  const money = (minor: number | null) => (minor === null ? "Not available" : formatAmount(minor, digits));
  const observations = useQuery({ queryKey: ["assets-debt", "observations", debt.debt.id], queryFn: () => listDebtObservations(debt.debt.id) });
  const statements = observations.data?.observations ?? [];
  const latest = statements[0] ?? null;
  const latestLender = latest ? latest.principalMinor + (latest.accruedInterestMinor ?? 0) : null;
  const { actualMinor, reconciliation, actual } = useComparison({ debt, offsetHistories }, latest?.observedOn ?? null);
  const calculatedMinor = reconciliation.data?.comparison.modelMinor ?? null;
  const tolerance = debt.debt.driftToleranceMinor ?? 1;
  const verdict = latest && latestLender !== null ? verdictOf({ lenderMinor: latestLender, actualMinor, calculatedMinor, toleranceMinor: tolerance, digits }) : null;

  const [formOpen, setFormOpen] = useState(false);
  const [date, setDate] = useState(today());
  const [principalMinor, setPrincipalMinor] = useState<number | null>(null);
  const [interestMinor, setInterestMinor] = useState<number | null>(null);
  const [correction, setCorrection] = useState<DebtObservationRecord | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const refreshAll = () => void queryClient.invalidateQueries({ queryKey: ["assets-debt"] });

  const save = useMutation({
    mutationFn: () => recordDebtObservation(debt.debt.id, { observedOn: date, recordedAt: new Date().toISOString(), principalMinor: principalMinor!, accruedInterestMinor: interestMinor, supersedesObservationId: correction?.id ?? null, note: correction ? "Corrected statement observation" : null }),
    onSuccess: () => { setPrincipalMinor(null); setInterestMinor(null); setCorrection(null); setFormOpen(false); refreshAll(); },
  });
  const restart = useMutation({ mutationFn: (observationId: string) => createDebtAnchor(debt.debt.id, observationId), onSuccess: refreshAll });
  const diagnostic = useMutation({ mutationFn: (observationId: string) => runConventionDiagnostic(debt.debt.id, observationId) });
  const remove = useMutation({ mutationFn: (observationId: string) => removeDebtObservation(debt.debt.id, observationId), onSuccess: refreshAll });
  const askRemove = (statement: DebtObservationRecord) => setConfirm({
    title: "Remove this statement?",
    message: `The statement of ${shortDay(statement.observedOn)} is removed, with any corrections of it. If you restarted the calculation from it, that restart is removed too and the calculation goes back to how it was. Nothing in Actual changes.`,
    destructiveLabel: "Remove statement",
    onConfirm: () => remove.mutate(statement.id),
  });
  const accept = useMutation({ mutationFn: () => acceptDebtDrift(debt.debt.id, { comparisonDate: latest!.observedOn, actualBalanceMinor: actualMinor!, offsetHistories }), onSuccess: refreshAll });

  const openForm = (fix: DebtObservationRecord | null) => {
    setCorrection(fix);
    setDate(fix?.observedOn ?? today());
    setPrincipalMinor(fix?.principalMinor ?? null);
    setInterestMinor(fix?.accruedInterestMinor ?? null);
    setFormOpen(true);
  };
  const askRestart = (statement: DebtObservationRecord) => setConfirm({
    title: "Restart the calculation from this statement?",
    message: `From ${shortDay(statement.observedOn)} the calculation starts at the lender's ${money(statement.principalMinor + (statement.accruedInterestMinor ?? 0))}. Earlier differences stop carrying forward. Actual is not changed, and the restart is kept in the loan's history.`,
    destructiveLabel: "Restart from here",
    destructive: false,
    onConfirm: () => restart.mutate(statement.id),
  });

  return (
    <section aria-label="Lender statements" className="flex flex-col gap-4 px-4 pb-6 text-sm">
      {latest && latestLender !== null ? (
        <section aria-labelledby="latest-statement" className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 id="latest-statement" className="font-semibold">Latest statement</h2>
            <span className="text-xs text-muted-foreground">{shortDay(latest.observedOn)}</span>
            {!formOpen ? <Button type="button" size="sm" variant="outline" className="ml-auto h-7" onClick={() => openForm(null)}>+ Add a statement</Button> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Figure label="Lender" value={money(latestLender)} note="the reference" tone="ref" />
            <Figure label="Actual" value={money(actualMinor)} note={actualMinor === null ? (actual.isLoading ? "reading Actual…" : "not available") : verdict?.actualOff ? `${money(Math.abs(actualMinor - latestLender))} ${actualMinor > latestLender ? "above" : "below"} the lender` : "✓ matches the lender"} tone={actualMinor === null ? undefined : verdict?.actualOff ? "off" : "ok"} />
            <Figure label="Calculated" value={money(calculatedMinor)} note={calculatedMinor === null ? "calculating…" : verdict?.calcOff ? `${money(Math.abs(calculatedMinor - latestLender))} ${calculatedMinor > latestLender ? "above" : "below"} the lender` : "✓ matches the lender"} tone={calculatedMinor === null ? undefined : verdict?.calcOff ? "off" : "ok"} />
          </div>
          {verdict && calculatedMinor !== null && actualMinor !== null ? (
            <div role="status" className={cn("rounded-lg px-3 py-2 text-xs leading-relaxed", verdict.calcOff || verdict.actualOff ? "bg-amber-50 dark:bg-amber-950/30" : "bg-emerald-50 dark:bg-emerald-950/30")}>
              <p className="font-semibold">{reconciliation.data?.drift === "accepted" ? `Difference accepted. ${verdict.text}` : verdict.text}</p>
              <p>{verdict.detail}</p>
            </div>
          ) : null}
          {verdict?.calcOff ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">What you can do</p>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <Button type="button" size="sm" disabled={diagnostic.isPending} onClick={() => diagnostic.mutate(latest.id)}>{diagnostic.isPending ? "Trying methods…" : "Find which calculation method matches"}</Button>
                <span className="min-w-52 flex-1 text-[11px] text-muted-foreground">Tries other day counts, interest timing and rounding against this statement. Read only: it never changes your method.</span>
              </div>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <Button type="button" size="sm" variant="outline" disabled={restart.isPending} onClick={() => askRestart(latest)}>Restart the calculation from here</Button>
                <span className="min-w-52 flex-1 text-[11px] text-muted-foreground">From {shortDay(latest.observedOn)} the calculation starts at the lender&apos;s {money(latestLender)}. Earlier differences stop carrying forward.</span>
              </div>
              {reconciliation.data?.drift === "material" ? (
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <Button type="button" size="sm" variant="link" className="h-auto p-0 text-xs" disabled={accept.isPending || actualMinor === null} onClick={() => accept.mutate()}>Accept this difference</Button>
                  <span className="min-w-52 flex-1 text-[11px] text-muted-foreground">Stop flagging this exact difference until a new statement, a new balance in Actual or a changed loan.</span>
                </div>
              ) : null}
            </div>
          ) : null}
          {diagnostic.data ? (
            <div className="rounded-lg border border-border p-3 text-xs">
              <p className="font-medium">Calculation methods closest to this statement</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {diagnostic.data.slice(0, 3).map((c) => <li key={JSON.stringify(c.variant)}>{c.variant.dayCount} · {c.variant.timing} · {c.variant.interestPostingRounding}: {c.differenceMinor === null ? "could not be calculated" : `${money(Math.abs(c.differenceMinor))} from the lender`}{c.isCurrent ? " (your current method)" : ""}</li>)}
              </ul>
              <p className="mt-1 text-muted-foreground">Nothing was changed. To use one, open Schedule and choose Set calculation method.</p>
            </div>
          ) : null}
          {diagnostic.isError ? <p role="alert" className="text-xs text-destructive">{String((diagnostic.error as Error)?.message ?? diagnostic.error)}</p> : null}
        </section>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">No statements yet. Add the balance from your latest lender statement to see whether Actual and the calculation agree with it.</p>
      )}

      {formOpen || !latest ? (
        <section aria-labelledby="statement-form" className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <h2 id="statement-form" className="font-semibold">{correction ? `Correct the statement of ${shortDay(correction.observedOn)}` : "Add a statement"}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1"><Label htmlFor="statement-date" className="text-xs text-muted-foreground">Statement date</Label><DateInput id="statement-date" value={date} onValueChange={setDate} /></div>
            <MoneyField fixedDecimals label="Principal on the statement" valueMinor={principalMinor} minorDigits={digits} onChange={setPrincipalMinor} />
            <MoneyField fixedDecimals label="Accrued interest (optional)" valueMinor={interestMinor} minorDigits={digits} onChange={setInterestMinor} />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <p className="mr-auto text-[11px] text-muted-foreground">A saved statement is kept as evidence. A typing mistake is fixed with Correct, which keeps the original in the history.</p>
            {latest ? <Button type="button" size="sm" variant="outline" onClick={() => { setFormOpen(false); setCorrection(null); }}>Cancel</Button> : null}
            <Button type="button" size="sm" disabled={principalMinor === null || save.isPending} onClick={() => save.mutate()}>{correction ? "Save correction" : "Save statement"}</Button>
          </div>
          {save.isError ? <p role="alert" className="text-xs text-destructive">{String((save.error as Error)?.message ?? save.error)}</p> : null}
        </section>
      ) : null}

      {statements.length ? (
        <section aria-labelledby="all-statements" className="flex flex-col gap-1">
          <h2 id="all-statements" className="font-semibold">All statements</h2>
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr><th scope="col" className="py-1.5 font-normal">Date</th><th scope="col" className="py-1.5 text-right font-normal">Lender</th><th scope="col" className="py-1.5 text-right font-normal">Actual then</th><th scope="col" className="py-1.5 text-right font-normal">Calculated then</th><th scope="col" className="w-8"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {statements.map((statement) => (
                <StatementRow key={statement.id} statement={statement} ctx={{ debt, offsetHistories }} tolerance={tolerance}
                  onCorrect={() => openForm(statement)} onRestart={() => askRestart(statement)} onDiagnose={() => diagnostic.mutate(statement.id)} onRemove={() => askRemove(statement)} />
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <ConfirmDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)} state={confirm} />
    </section>
  );
}

function StatementRow({ statement, ctx, tolerance, onCorrect, onRestart, onDiagnose, onRemove }: { statement: DebtObservationRecord; ctx: Ctx; tolerance: number; onCorrect: () => void; onRestart: () => void; onDiagnose: () => void; onRemove: () => void }) {
  const digits = ctx.debt.debt.currencyMinorDigits;
  const lender = statement.principalMinor + (statement.accruedInterestMinor ?? 0);
  const { actualMinor, reconciliation } = useComparison(ctx, statement.observedOn);
  const calculated = reconciliation.data?.comparison.modelMinor ?? null;
  const cell = (value: number | null) => (
    <td className={cn("py-1.5 text-right tabular-nums", value === null ? "text-muted-foreground" : Math.abs(value - lender) > tolerance ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300")}>
      {value === null ? "…" : formatAmount(value, digits)}
    </td>
  );
  return (
    <tr className="border-t border-border/60">
      <td className="py-1.5">{shortDay(statement.observedOn)}{statement.supersedesObservationId ? <span className="text-muted-foreground"> (corrected)</span> : null}</td>
      <td className="py-1.5 text-right tabular-nums">{formatAmount(lender, digits)}</td>
      {cell(actualMinor)}
      {cell(calculated)}
      <td className="py-1.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Actions for the statement of ${shortDay(statement.observedOn)}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 px-1.5")}><MoreHorizontal aria-hidden="true" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onCorrect}>Correct this statement</DropdownMenuItem>
            <DropdownMenuItem onClick={onRestart}>Restart the calculation from this statement</DropdownMenuItem>
            <DropdownMenuItem onClick={onDiagnose}>Find which calculation method matches it</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onRemove}>Remove this statement</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
