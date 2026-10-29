"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getTransport } from "@/lib/actual";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import { adjustmentProposal, type Proposal } from "@/lib/assets-debt/tracking/proposals";
import { proposalContext, type Installment, type LedgerRow } from "@/lib/assets-debt/tracking/plan";
import type { LedgerChange } from "@/lib/app-db/debtTrackingRepository";
import { generateId } from "@/lib/uuid";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { formatAmount } from "../../lib/money";
import { createDebtAnchor, recordDebtObservation } from "../../lib/debtsApi";
import { finishWrite, saveLedgerChanges, startWrite } from "../../lib/trackingApi";
import { applyProposals, type WriteOutcome } from "../../lib/trackingWrites";
import { isUnresolved } from "@/lib/assets-debt/tracking/writes";
import { readWindowStart, type LoanTracking } from "../../lib/useLoanTracking";
import { DateField, MoneyField, SelectField, TextField } from "../fields";
import { LoanLedgerTab } from "./LoanLedgerTab";
import { PaymentRulesDialog } from "./PaymentRulesDialog";
import { RepaymentsTab, type RunState } from "./RepaymentsTab";
import type { InspectorActions } from "./InstallmentInspector";
import { dt } from "./presentation";

/**
 * The tracking tabs (Repayments, Loan Ledger) and what they share: the run of writes to Actual and its outcome, the
 * decisions saved in Bench, and the dialogs for payment rules, adjustments and lender statements.
 */

export function useTrackingWorkspace(maybeDetail: DebtDetail | undefined, tracking: LoanTracking, directory: AccountDirectory | undefined) {
  // Called before the loan has loaded (hooks run every render); every action below needs it and runs only after.
  const detail = maybeDetail as DebtDetail;
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const [run, setRun] = useState<RunState>(null);
  const [outcomes, setOutcomes] = useState<{ list: WriteOutcome[]; clearingProblem: string | null } | null>(null);

  const [dialog, setDialog] = useState<"rules" | "adjustment" | "statement" | null>(null);
  // A write whose outcome is unknown locks every other write until someone checked Actual and said what happened.
  const unresolved = (tracking.bundle?.writes ?? []).filter((w) => isUnresolved(w));
  const writesLocked = unresolved.length > 0;
  const debt = tracking.debt;
  const entryOf = (id: string) => tracking.bundle?.entries.find((e) => e.actualTransactionId === id);

  async function afterChange() {
    await tracking.reloadBundle();
    void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debts"] });
  }

  async function apply(proposals: Proposal[]) {
    if (!connection || !debt || !directory || !tracking.reads || !proposals.length) return;
    setOutcomes(null);
    setRun({ done: 0, total: proposals.length });
    try {
      const result = await applyProposals({
        connectionId: connection.id, debtId: debt.id, transport: getTransport(connection), liabilityAccountId: debt.liabilityAccountId,
        transferPayeeByAccount: tracking.reads.transferPayeeByAccount, offBudgetAccountIds: new Set(directory.accounts.filter((a) => a.offBudget).map((a) => a.id)),
      }, proposals, (done, total) => setRun({ done, total }));
      setOutcomes({ list: result.outcomes, clearingProblem: result.clearingProblem });
      await tracking.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The changes could not be applied");
    } finally {
      setRun(null);
    }
  }

  async function saveEntries(changes: LedgerChange[]) {
    await saveLedgerChanges(detail.debt.id, changes);
    await afterChange();
  }

  const actions: InspectorActions = {
    notThisPayment: (inst: Installment) => {
      const p = inst.payment;
      if (!p) return;
      void saveEntries([{ actualTransactionId: p.id, actualAccountId: p.row.accountId, entryType: "not-repayment", revision: entryOf(p.id)?.revision ?? 0 }])
        .then(() => toast.success("Bench no longer counts that payment as a repayment of this loan."), (e) => toast.error(e instanceof Error ? e.message : "Could not save"));
    },
    choosePayment: (inst, payment) => {
      const target = payment.loanRows[0] ?? payment.row;
      void saveEntries([{ actualTransactionId: target.id, actualAccountId: target.accountId, entryType: "principal-repayment", installmentDueDate: inst.dueDate, revision: entryOf(target.id)?.revision ?? 0 }])
        .then(() => toast.success(`That payment now pays installment ${inst.no}.`), (e) => toast.error(e instanceof Error ? e.message : "Could not save"));
    },
    acceptActual: (inst) => {
      const ledger = tracking.result?.ok ? tracking.result.ledger : [];
      const date = inst.payment?.date ?? inst.dueDate;
      const running = ledger.filter((l) => l.row.date <= date).at(-1)?.runningMinor ?? 0;
      void (async () => {
        try {
          const observation = await recordDebtObservation(detail.debt.id, { observedOn: date, recordedAt: new Date().toISOString(), principalMinor: Math.max(0, -running), accruedInterestMinor: null, note: `Actual's balance accepted at installment ${inst.no}` });
          await createDebtAnchor(detail.debt.id, observation.id);
          await afterChange();
          toast.success(`The calculation now continues from Actual's balance on ${dt(date)}.`);
        } catch (e) { toast.error(e instanceof Error ? e.message : "Could not accept Actual's balance"); }
      })();
    },
  };

  async function saveNotes(row: LedgerRow, notes: string) {
    if (!connection || !debt) throw new Error("Connect to this loan's budget first.");
    const write = await startWrite(detail.debt.id, { kind: "notes", targetIds: [row.row.id], before: { id: row.row.id, notes: row.row.notes }, after: { notes } });
    try {
      const transport = getTransport(connection);
      const saved = await transport.updateTransactionForSync({ transactionId: row.row.id, accountId: row.row.accountId, date: row.row.date, amount: row.row.amount, notes: notes || null, returnApplied: true });
      const ok = !saved || (saved.notes ?? "") === notes;
      await finishWrite(detail.debt.id, write.id, ok ? { status: "applied", actualIds: [row.row.id] } : { status: "failed", error: { message: "The Notes did not change in Actual." } });
      if (!ok) throw new Error("The Notes did not change in Actual.");
    } catch (error) {
      await finishWrite(detail.debt.id, write.id, { status: "uncertain", error: { message: error instanceof Error ? error.message : String(error) } }).catch(() => undefined);
      throw error;
    }
    await tracking.refresh();
  }

  /** The user checked Actual: the write is there (applied) or it isn't (nothing written). */
  async function resolveWrite(writeId: string, inActual: boolean) {
    await finishWrite(detail.debt.id, writeId, inActual ? { status: "applied" } : { status: "failed", error: { message: "Checked in Actual: not written" } });
    await tracking.refresh();
  }

  return { run, outcomes, setOutcomes, writesLocked, unresolved, resolveWrite, apply, actions, saveEntries, saveNotes, dialog, setDialog, afterChange };
}

export type TrackingWorkspace = ReturnType<typeof useTrackingWorkspace>;

export function TrackingTab({ tab, detail, tracking, directory, digits, ws, onLinkToActual }: {
  tab: "repayments" | "ledger"; detail: DebtDetail; tracking: LoanTracking; directory: AccountDirectory | undefined; digits: number; ws: TrackingWorkspace; onLinkToActual: () => void;
}) {
  const content = tab === "repayments"
    ? <RepaymentsTab tracking={tracking} directory={directory} digits={digits} loanName={detail.debt.name} onLinkToActual={onLinkToActual} onPaymentRules={() => ws.setDialog("rules")} apply={(p) => void ws.apply(p)} run={ws.run} outcomes={ws.outcomes} onDismissOutcomes={() => ws.setOutcomes(null)} actions={ws.actions} writesLocked={ws.writesLocked} unresolved={ws.unresolved} onResolve={(id, inActual) => void ws.resolveWrite(id, inActual).catch((e) => toast.error(e instanceof Error ? e.message : "Could not save"))} />
    : <LoanLedgerTab tracking={tracking} digits={digits} onLinkToActual={onLinkToActual} onSaveEntries={ws.saveEntries} onSaveNotes={ws.saveNotes} onAddAdjustment={() => ws.setDialog("adjustment")} onStatement={() => ws.setDialog("statement")} writesLocked={ws.writesLocked} />;
  return <>{content}<TrackingDialogs detail={detail} tracking={tracking} directory={directory} digits={digits} ws={ws} /></>;
}

export function TrackingDialogs({ detail, tracking, directory, digits, ws }: { detail: DebtDetail; tracking: LoanTracking; directory: AccountDirectory | undefined; digits: number; ws: TrackingWorkspace }) {
  const debt = tracking.debt;
  const loanAccountId = debt?.liabilityAccountId ?? detail.debt.liabilityAccountId;
  if (ws.dialog === "rules" && loanAccountId) {
    // Before tracking starts, a rule is checked against the last year of payments.
    const from = debt ? readWindowStart(debt.trackingStartDueDate) : new Date(Date.parse(`${tracking.today}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
    return <PaymentRulesDialog debtId={detail.debt.id} loanName={detail.debt.name} loanAccountId={loanAccountId} rules={tracking.bundle?.rules ?? []} from={from} today={tracking.today} onSaved={() => tracking.refresh()} onClose={() => ws.setDialog(null)} />;
  }
  if (ws.dialog === "adjustment" && debt && directory && tracking.reads) {
    const ctx = proposalContext(debt, directory.accounts, tracking.reads.transferPayeeByAccount);
    return <AdjustmentDialog digits={digits} today={tracking.today} onClose={() => ws.setDialog(null)} onApply={(date, ledgerAmountMinor, notes) => { ws.setDialog(null); void ws.apply([adjustmentProposal(ctx, { date, ledgerAmountMinor, notes, key: `manual-${generateId()}` })]); }} />;
  }
  if (ws.dialog === "statement" && debt && directory && tracking.reads) {
    const ctx = proposalContext(debt, directory.accounts, tracking.reads.transferPayeeByAccount);
    return <StatementDialog detail={detail} tracking={tracking} digits={digits} onClose={() => ws.setDialog(null)} onAdjust={(date, amount) => { ws.setDialog(null); void ws.apply([adjustmentProposal(ctx, { date, ledgerAmountMinor: amount, notes: "Lender statement adjustment", key: `statement-${date}` })]); }} onRestarted={async () => { ws.setDialog(null); await ws.afterChange(); }} />;
  }
  return null;
}

function AdjustmentDialog({ digits, today, onClose, onApply }: { digits: number; today: string; onClose: () => void; onApply: (date: string, ledgerAmountMinor: number, notes: string) => void }) {
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState<number | null>(null);
  const [direction, setDirection] = useState<"reduce" | "increase">("reduce");
  const [notes, setNotes] = useState("Loan adjustment");
  const valid = !!date && amount !== null && amount > 0;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Adjustment</DialogTitle><DialogDescription>One row in the loan account that corrects its balance. It is off budget, so it has no category.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <DateField label="Date" value={date} onChange={setDate} />
          <SelectField label="It" value={direction} onChange={(v) => setDirection(v as "reduce" | "increase")} options={[{ value: "reduce", label: "Reduces the debt" }, { value: "increase", label: "Increases the debt" }]} />
          <MoneyField label="Amount" valueMinor={amount} minorDigits={digits} fixedDecimals onChange={setAmount} />
          <TextField label="Notes" value={notes} onChange={setNotes} />
        </div>
        <p className="text-xs text-muted-foreground">One write to Actual when you apply it.</p>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} onClick={() => valid && onApply(date, direction === "reduce" ? amount! : -amount!, notes)}>Apply</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Check against a lender statement (design spec 06 §7.8): Calculated, Actual and Lender on one date, and at most two fixes. */
function StatementDialog({ detail, tracking, digits, onClose, onAdjust, onRestarted }: { detail: DebtDetail; tracking: LoanTracking; digits: number; onClose: () => void; onAdjust: (date: string, ledgerAmountMinor: number) => void; onRestarted: () => Promise<void> }) {
  const money = (minor: number) => formatAmount(minor, digits);
  const [date, setDate] = useState(tracking.today);
  const [lender, setLender] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const result = tracking.result?.ok ? tracking.result : null;
  const actual = result ? -(result.ledger.filter((l) => l.row.date <= date).at(-1)?.runningMinor ?? 0) : null;
  const calculated = result ? (result.installments.filter((i) => (i.payment?.date ?? i.dueDate) <= date && i.status !== "upcoming").at(-1)?.balanceAfterMinor ?? result.opening.principalMinor) : null;
  const tolerance = tracking.debt?.toleranceMinor ?? 100;
  const actualOff = lender !== null && actual !== null && Math.abs(actual - lender) > tolerance;
  const calcOff = lender !== null && calculated !== null && Math.abs(calculated - lender) > tolerance;
  async function restart() {
    if (lender === null) return;
    setBusy(true); setError("");
    try {
      const observation = await recordDebtObservation(detail.debt.id, { observedOn: date, recordedAt: new Date().toISOString(), principalMinor: lender, accruedInterestMinor: null, note: "Lender statement" });
      await createDebtAnchor(detail.debt.id, observation.id);
      await onRestarted();
      toast.success(`The calculation now continues from the statement of ${dt(date)}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not record the statement"); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Check against a lender statement</DialogTitle><DialogDescription>{detail.debt.name} · the principal your lender says you owe on a date.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3"><DateField label="Statement date" value={date} onChange={setDate} /><MoneyField label="Principal owed (lender)" valueMinor={lender} minorDigits={digits} fixedDecimals onChange={setLender} /></div>
        <dl className="grid grid-cols-3 divide-x rounded-lg border text-sm">
          <div className="px-3 py-2"><dt className="text-xs text-muted-foreground">Calculated</dt><dd className="font-semibold tabular-nums">{calculated === null ? "-" : money(calculated)}</dd></div>
          <div className="px-3 py-2"><dt className="text-xs text-muted-foreground">Actual</dt><dd className="font-semibold tabular-nums">{actual === null ? "-" : money(actual)}</dd></div>
          <div className="px-3 py-2"><dt className="text-xs text-muted-foreground">Lender</dt><dd className="font-semibold tabular-nums">{lender === null ? "-" : money(lender)}</dd></div>
        </dl>
        {lender !== null ? <ul className="flex list-disc flex-col gap-1 pl-5 text-xs">
          <li>{actualOff ? `Actual differs from the lender by ${money(Math.abs(actual! - lender))}: one adjustment in the loan account sets it right.` : "Actual agrees with the lender."}</li>
          <li>{calcOff ? `The calculation differs from the lender by ${money(Math.abs(calculated! - lender))}: restart the calculation from the statement so it follows the lender from here.` : "The calculation agrees with the lender."}</li>
        </ul> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Close</Button>
          {calcOff ? <Button variant="outline" disabled={busy} onClick={() => void restart()}>Restart the calculation</Button> : null}
          {actualOff ? <Button disabled={busy} onClick={() => onAdjust(date, actual! - lender!)}>Adjust Actual</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
