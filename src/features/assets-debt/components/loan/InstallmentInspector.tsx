"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import { proposalContext, type Installment, type LedgerRow, type Payment } from "@/lib/assets-debt/tracking/plan";
import { adjustSplitProposal, splitProposal, undoSplitProposal, type Proposal } from "@/lib/assets-debt/tracking/proposals";
import type { RowSnapshot } from "@/lib/assets-debt/services/snapshot";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../lib/money";
import type { LoanTracking } from "../../lib/useLoanTracking";
import { MoneyField } from "../fields";
import { ENTRY_LABELS, StatusBadge, dt } from "./presentation";

/**
 * The docked panel beside Repayments (design spec 06 §7.2): what Bench calculated, what Actual holds now, and what Apply
 * would write, with every line's amount and Notes editable before it is applied. The table keeps its place.
 */

export type InspectorActions = {
  /** This payment isn't this loan's repayment: Bench ignores it from now on (saved in Bench only). */
  notThisPayment: (inst: Installment) => void;
  /** Remove a saved exclusion so Bench can match the payment again. */
  restorePayment: (id: string) => void;
  /** This payment pays this installment (saved in Bench only). */
  choosePayment: (inst: Installment, payment: Pick<Payment, "id" | "row" | "loanRows">) => void;
  /** Actual's balance is right from this installment: the calculation continues from it. */
  acceptActual: (inst: Installment) => void;
};

type InspectorRow = { kind: "installment"; inst: Installment } | { kind: "event"; ledger: LedgerRow } | { kind: "opening"; proposal: Proposal; amountMinor: number; date: string };

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs">{items.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums">{v}</dd></div>)}</dl>;
}

/** One band of the panel: a small uppercase heading, full width, divided from the next by a line. */
function Sec({ title, aside, children }: { title?: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border/60 px-4 py-3 last:border-b-0">
      {title ? <h4 className="mb-2 flex justify-between gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"><span>{title}</span>{aside ? <span className="font-normal tracking-normal normal-case">{aside}</span> : null}</h4> : null}
      {children}
    </section>
  );
}

const LINE_DOT = { principal: "bg-chart-1", interest: "bg-chart-5", fee: "bg-chart-3" } as const;
type LineKind = keyof typeof LINE_DOT;

/** How the payment divides, at a glance: one bar in the lines' colours, with each line's share beneath it. */
function SplitBar({ parts }: { parts: { kind: LineKind; label: string; minor: number }[] }) {
  const shown = parts.filter((p) => p.minor > 0);
  const total = shown.reduce((s, p) => s + p.minor, 0);
  if (total <= 0) return null;
  return (
    <div className="mb-3">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>{shown.map((p) => <span key={p.kind} className={LINE_DOT[p.kind]} style={{ width: `${(p.minor / total) * 100}%` }} />)}</div>
      <p className="mt-1 flex gap-3 text-[11px] text-muted-foreground">{shown.map((p) => <span key={p.kind} className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-sm", LINE_DOT[p.kind])} aria-hidden />{p.label} {Math.round((p.minor / total) * 100)}%</span>)}</p>
    </div>
  );
}

type SplitLine = {
  kind: LineKind; label: string; goesTo: string;
  /** The amount, or its editor. */ amount: React.ReactNode;
  /** Under the amount: Bench's figure, or the difference from it. */ sub?: React.ReactNode;
  /** The line's Notes: editable while Apply is still to come, read-only once it is in Actual. */ notes?: { value: string; onChange?: (v: string) => void };
};

/** The split's lines, one block each (colour, where it goes, amount, Notes), then the total. No rules between rows. */
function SplitLines({ lines, total, money }: { lines: SplitLine[]; total: number; money: (m: number) => string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <li key={l.kind} className="relative rounded-md bg-muted/50 py-2 pr-2.5 pl-4">
            <span className={cn("absolute inset-y-2 left-1.5 w-1 rounded-full", LINE_DOT[l.kind])} aria-hidden />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-xs font-medium">{l.label}</p><p className="truncate text-[11px] text-muted-foreground">{l.goesTo}</p></div>
              <div className="shrink-0 text-right text-xs tabular-nums">{l.amount}{l.sub ? <div className="text-[11px] text-muted-foreground">{l.sub}</div> : null}</div>
            </div>
            {l.notes ? (l.notes.onChange
              ? <Input aria-label={`${l.label} line Notes`} value={l.notes.value} onChange={(e) => l.notes!.onChange!(e.target.value)} placeholder="Notes" className="mt-1.5 h-6 bg-background px-1.5 text-[11px]" />
              : l.notes.value ? <p className="mt-1 text-[11px] break-words text-muted-foreground">{l.notes.value}</p> : null) : null}
          </li>
        ))}
      </ul>
      <p className="flex justify-between px-1 pt-1 text-xs font-semibold"><span>Total</span><span className="tabular-nums">{money(total)}</span></p>
    </div>
  );
}

export function InstallmentInspector({ row, tracking, directory, digits, busy, writesLocked, onApply, actions, onClose, onPrev, onNext }: {
  row: InspectorRow; tracking: LoanTracking; directory: AccountDirectory | undefined; digits: number; busy: boolean; writesLocked: boolean;
  onApply: (proposal: Proposal) => void; actions: InspectorActions; onClose: () => void;
  /** Step to the row above or below in the table, keeping the panel open; absent at either end. */ onPrev?: () => void; onNext?: () => void;
}) {
  const money = (minor: number) => formatAmount(minor, digits);
  const accountName = (id: string) => directory?.accounts.find((a) => a.id === id)?.name ?? "-";
  const categoryName = (id: string | null) => (id ? directory?.categories.find((c) => c.id === id)?.name ?? "Unknown category" : "-");
  const ctx = tracking.debt && directory && tracking.reads ? proposalContext(tracking.debt, directory.accounts, tracking.reads.transferPayeeByAccount) : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector('[role="listbox"], [data-slot="popover-content"]')) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const inst = row.kind === "installment" ? row.inst : null;
  const payment = inst?.payment ?? null;
  const split = inst?.proposal?.output.kind === "restructure" ? inst.proposal.output : null;
  // Editable lines of the split Apply would write.
  const [principal, setPrincipal] = useState<number | null>(inst ? inst.principalMinor : null);
  const [principalNotes, setPrincipalNotes] = useState(split?.operations.find((c) => c.economicKind === "principal")?.notes ?? "");
  const [interestNotes, setInterestNotes] = useState(split?.operations.find((c) => c.economicKind === "interest")?.notes ?? "");
  const [editingRecorded, setEditingRecorded] = useState(false);
  const fees = inst?.feesMinor ?? 0;
  const interest = payment && principal !== null ? payment.amountMinor - principal - fees : null;
  const edited = inst && (principal !== inst.principalMinor || principalNotes !== (split?.operations.find((c) => c.economicKind === "principal")?.notes ?? "") || interestNotes !== (split?.operations.find((c) => c.economicKind === "interest")?.notes ?? ""));

  const rebuilt = useMemo((): { proposal: Proposal } | { problem: string } | null => {
    if (!inst || !payment || !ctx) return null;
    if (inst.status === "unrecorded" && inst.proposal?.kind === "split") {
      if (interest === null || interest < 0 || principal === null || principal <= 0) return { problem: "Principal must be more than zero and no more than the payment." };
      const built = splitProposal(ctx, payment.row, { interestMinor: interest, feesMinor: fees, notes: { principal: principalNotes, interest: interestNotes } }, { dueDate: inst.dueDate, loanSide: payment.kind === "transfer" ? payment.loanRows[0] ?? null : null });
      return "ok" in built ? { problem: built.reason } : { proposal: built };
    }
    if (payment.kind === "split" && payment.split && (editingRecorded || inst.checkKind === "drift")) {
      if (!payment.split.interestLineId) return { problem: "This split has no interest line to change." };
      const p = editingRecorded ? principal ?? 0 : payment.amountMinor - inst.calculatedInterestMinor - payment.split.feesMinor;
      const built = adjustSplitProposal(payment.row, { dueDate: inst.dueDate, principalLineId: payment.split.principalLineId, interestLineId: payment.split.interestLineId, principalMinor: p, interestMinor: payment.amountMinor - p - payment.split.feesMinor, loanSide: payment.loanRows[0] ?? null, calculatedInterestMinor: inst.calculatedInterestMinor });
      return "ok" in built ? { problem: built.reason } : { proposal: built };
    }
    return null;
  }, [inst, payment, ctx, interest, principal, fees, principalNotes, interestNotes, editingRecorded]);

  const undo = useMemo(() => {
    if (!inst || !payment || payment.kind !== "split" || !ctx) return null;
    // What Bench split, from the journal: the payment goes back exactly to it.
    const journal = tracking.bundle?.writes.find((w) => w.kind === "split" && w.status === "applied" && (w.before as { before?: RowSnapshot } | null)?.before?.id === payment.id);
    const before = journal?.before as { before: RowSnapshot; replacesCounterpart?: RowSnapshot | null } | undefined;
    return undoSplitProposal(ctx, payment.row, { dueDate: inst.dueDate, original: before ? { before: before.before, replacesCounterpart: before.replacesCounterpart ?? null } : null });
  }, [inst, payment, ctx, tracking.bundle]);

  const result = tracking.result?.ok ? tracking.result : null;
  const nearby = inst && result ? result.ledger.filter((l) => l.type === "extra-principal" && Math.abs(Date.parse(l.row.date) - Date.parse(inst.dueDate)) <= 45 * 86_400_000) : [];
  const ignored = inst ? (tracking.bundle?.entries ?? []).filter((e) => e.entryType === "not-repayment").flatMap((entry) => {
    const row = [...(tracking.reads?.bankRows ?? []), ...(tracking.reads?.loanRows ?? [])].find((r) => r.id === entry.actualTransactionId);
    return row && Math.abs(Date.parse(row.date) - Date.parse(inst.dueDate)) <= 45 * 86_400_000 ? [row] : [];
  }) : [];
  const [chosen, setChosen] = useState<string | null>(payment?.id ?? null);
  const disabled = busy || writesLocked;

  const loanName = accountName(tracking.debt?.liabilityAccountId ?? "");
  const interestCategory = categoryName(tracking.debt?.interestCategoryId ?? null);
  const title = row.kind === "installment" ? <>Installment {row.inst.no} <span className="font-normal text-muted-foreground">· {dt(row.inst.dueDate)}</span></> : row.kind === "event" ? <>{ENTRY_LABELS[row.ledger.type]} <span className="font-normal text-muted-foreground">· {dt(row.ledger.row.date)}</span></> : "Opening adjustment";
  let body: React.ReactNode = null;
  let footer: React.ReactNode = <Button variant="outline" size="sm" onClick={onClose}>Close</Button>;
  const alert = (text: string | null, tone: "attention" | "info" = "attention") => (text ? <Sec><p className={cn("rounded px-2.5 py-2 text-xs", tone === "attention" ? "bg-amber-400/15 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground")}>{text}</p></Sec> : null);

  if (row.kind === "opening") {
    body = <>
      {alert("Actual's loan account differs from the opening position at the tracking start. One row in the loan account sets it right.", "info")}
      <Sec title="The row Apply adds"><Facts items={[["Date", dt(row.date)], ["Amount", money(Math.abs(row.amountMinor))], ["Notes", "Opening adjustment"], ["Category", "None (the loan account is off budget)"]]} /></Sec>
      {result ? <Sec title="Opening position"><Facts items={[["Bench", money(result.opening.principalMinor)], ["Actual's loan account then", money(result.opening.actualMinor)], ["Difference", money(result.opening.differenceMinor)]]} /></Sec> : null}
    </>;
    footer = <><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={disabled} onClick={() => onApply(row.proposal)}>Apply</Button></>;
  } else if (row.kind === "event") {
    const l = row.ledger;
    body = <>
      <Sec title="In the loan account">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3"><span className="font-medium">{l.row.payeeName ?? "-"}</span><span className="text-[15px] font-semibold tabular-nums">{money(l.row.amount)}</span><span className="text-xs text-muted-foreground">{dt(l.row.date)} · {ENTRY_LABELS[l.type]}{l.suggested ? " (suggested)" : ""}</span></div>
        {l.row.notes ? <p className="mt-2 rounded bg-muted px-2 py-1.5 text-xs break-words text-muted-foreground">{l.row.notes}</p> : null}
      </Sec>
      <Sec><p className="text-xs text-muted-foreground">The calculation includes it from its date. Change its type or Notes in the Loan Ledger.</p></Sec>
    </>;
  } else if (inst) {
    const benchInterest = inst.calculatedInterestMinor;
    const benchPrincipal = payment ? payment.amountMinor - benchInterest - (payment.split?.feesMinor ?? fees) : inst.principalMinor;
    const kindWord = payment?.kind === "split" ? "Split" : payment?.kind === "rule" ? "Expense" : "Transfer";
    const paymentSec = payment ? (
      <Sec title="The payment in Actual">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
          <span className="font-medium">{accountName(payment.row.accountId)} → {payment.kind === "rule" ? payment.row.payeeName ?? "-" : loanName}</span>
          <span className="text-[15px] font-semibold tabular-nums">{money(payment.amountMinor)}</span>
          <span className="text-xs text-muted-foreground">Paid {dt(payment.date)} · {kindWord}{payment.kind === "rule" ? ` · ${categoryName(payment.row.categoryId)}` : ""} · {payment.row.cleared ? "Cleared" : "Not cleared"}</span>
        </div>
        {payment.row.notes ? <p className="mt-2 rounded bg-muted px-2 py-1.5 text-xs break-words text-muted-foreground">{payment.row.notes}</p> : null}
      </Sec>
    ) : null;
    const loanSec = (balanceLabel = "Balance after") => <Sec title="Loan"><Facts items={[[balanceLabel, money(inst.balanceAfterMinor)], ["Scheduled payment", money(inst.scheduledMinor)]]} /></Sec>;
    const calcSec = <Sec title="Bench's calculation"><Facts items={[["Scheduled payment", money(inst.scheduledMinor)], ["Interest", money(benchInterest)], ["Principal", inst.status === "missing" ? "-" : money(inst.principalMinor)], ["Balance after", money(inst.balanceAfterMinor)]]} /></Sec>;
    const lineNotesOf = (p: Payment, id: string | null | undefined) => ({ value: (id ? p.row.splitLines.find((l) => l.id === id)?.notes : null) ?? "" });
    // Bench's figure under Actual's, with the difference, only where they part.
    const versus = (actual: number, bench: number) => (actual === bench ? undefined : <>Bench {money(bench)} · <span className="text-amber-700 dark:text-amber-400">{actual > bench ? "+" : "−"}{money(Math.abs(actual - bench))}</span></>);
    const recordedLines = (p: Payment): SplitLine[] => p.split ? [
      { kind: "principal", label: "Principal", goesTo: `Transfer to ${loanName}`, amount: money(p.split.principalMinor), sub: versus(p.split.principalMinor, benchPrincipal), notes: lineNotesOf(p, p.split.principalLineId) },
      { kind: "interest", label: "Interest", goesTo: interestCategory, amount: money(p.split.interestMinor), sub: versus(p.split.interestMinor, benchInterest), notes: lineNotesOf(p, p.split.interestLineId) },
      ...(p.split.feesMinor ? [{ kind: "fee" as const, label: "Fees", goesTo: "Fee category", amount: money(p.split.feesMinor) }] : []),
    ] : [];
    const recordedParts = (p: Payment) => p.split ? [{ kind: "principal" as const, label: "Principal", minor: p.split.principalMinor }, { kind: "interest" as const, label: "Interest", minor: p.split.interestMinor }, { kind: "fee" as const, label: "Fees", minor: p.split.feesMinor }] : [];

    if (inst.status === "unrecorded" && inst.proposal?.kind === "split" && payment) {
      const resetLines = () => { setPrincipal(inst.principalMinor); setPrincipalNotes(split?.operations.find((c) => c.economicKind === "principal")?.notes ?? ""); setInterestNotes(split?.operations.find((c) => c.economicKind === "interest")?.notes ?? ""); };
      const problem = rebuilt && "problem" in rebuilt ? rebuilt.problem : null;
      body = <>
        {alert(inst.note)}
        {paymentSec}
        <Sec title="Split this payment into" aside="Edit the principal to change both">
          <p className="mb-2 text-xs text-muted-foreground">One transaction becomes a split with {fees ? "three" : "two"} lines. The bank account total does not change.</p>
          <SplitBar parts={[{ kind: "principal", label: "Principal", minor: principal ?? 0 }, { kind: "interest", label: "Interest", minor: interest ?? 0 }, { kind: "fee", label: "Fees", minor: fees }]} />
          <SplitLines money={money} total={payment.amountMinor} lines={[
            { kind: "principal", label: "Principal", goesTo: `Transfer to ${loanName}`, amount: <span className="block w-28"><MoneyField label="Principal amount" hideLabel valueMinor={principal} minorDigits={digits} fixedDecimals onChange={setPrincipal} /></span>, notes: { value: principalNotes, onChange: setPrincipalNotes } },
            { kind: "interest", label: "Interest", goesTo: interestCategory, amount: interest === null ? "-" : money(interest), sub: interest === benchInterest ? "Bench's calculation" : `Bench: ${money(benchInterest)}`, notes: { value: interestNotes, onChange: setInterestNotes } },
            ...(fees ? [{ kind: "fee" as const, label: "Fees", goesTo: "Fee category", amount: money(fees) }] : []),
          ]} />
          {problem ? <p role="alert" className="mt-2 text-xs text-destructive">{problem}</p> : <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">✓ Adds up to the payment</p>}
          {edited ? <button type="button" className="mt-1 text-xs underline underline-offset-2" onClick={resetLines}>Reset to Bench&apos;s calculation</button> : null}
        </Sec>
        <Sec title="After Apply">
          <Facts items={[
            ["Loan account goes down by", <>{money(principal ?? 0)}{payment.kind === "transfer" ? <span className="text-muted-foreground"> (was {money(payment.amountMinor)})</span> : null}</>],
            ["Interest recorded", interest === null ? "-" : money(interest)],
            ["Loan balance after", money(inst.balanceAfterMinor + inst.principalMinor - (principal ?? inst.principalMinor))],
          ]} />
        </Sec>
      </>;
      footer = <><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={disabled || !rebuilt || "problem" in rebuilt} onClick={() => rebuilt && "proposal" in rebuilt && onApply(rebuilt.proposal)}>Apply split</Button></>;
    } else if (inst.status === "unrecorded" && inst.proposal) {
      body = <>{alert(inst.note)}{paymentSec}<Sec title="After Apply"><p className="text-xs">The payment becomes a transfer to {loanName}. This loan charges no interest, so there is nothing to split.</p></Sec>{loanSec()}</>;
      footer = <><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={disabled} onClick={() => onApply(inst.proposal!)}>Apply</Button></>;
    } else if (inst.status === "check" && inst.checkKind === "competing" && payment) {
      const options = [payment, ...(inst.alternatives ?? [])];
      body = <>{alert(inst.note)}
        <Sec title="Payments found">
          <div role="radiogroup" aria-label="Payments found" className="flex flex-col gap-1.5">
            {options.map((p) => <button key={p.id} type="button" role="radio" aria-checked={chosen === p.id} onClick={() => setChosen(p.id)} className={cn("rounded border px-3 py-2 text-left text-xs", chosen === p.id && "border-primary bg-accent/40")}><span className="block font-medium">{dt(p.date)} · {money(p.amountMinor)}</span><span className="text-muted-foreground">{accountName(p.row.accountId)} · {p.row.payeeName ?? "Transfer"}{p.row.notes ? ` · ${p.row.notes}` : ""}</span></button>)}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Your choice is saved in Bench only. Applying the split afterwards is one write to Actual.</p>
        </Sec>{calcSec}
      </>;
      const pick = options.find((p) => p.id === chosen);
      footer = <><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={!pick} onClick={() => pick && actions.choosePayment(inst, pick)}>Use this payment</Button></>;
    } else if (inst.status === "check" && inst.checkKind === "drift" && payment) {
      body = <>{alert(inst.note)}{paymentSec}
        <Sec title="Split in Actual"><SplitBar parts={recordedParts(payment)} /><SplitLines money={money} total={payment.amountMinor} lines={recordedLines(payment)} /></Sec>
        <Sec><div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          <p><strong className="text-foreground">Accept Actual:</strong> the calculation continues from Actual&apos;s loan balance after this installment. Nothing is written to Actual.</p>
          <p><strong className="text-foreground">Adjust to Bench:</strong> the split takes Bench&apos;s amounts. One write to Actual.</p>
        </div></Sec>
        {loanSec("Balance after, Bench")}
      </>;
      footer = <>
        <Button variant="ghost" size="sm" className="mr-auto" disabled={disabled || !undo || "ok" in undo} onClick={() => undo && !("ok" in undo) && onApply(undo)}>Undo split</Button>
        <Button variant="outline" size="sm" onClick={() => actions.acceptActual(inst)}>Accept Actual</Button>
        <Button size="sm" disabled={disabled || !rebuilt || "problem" in rebuilt} onClick={() => rebuilt && "proposal" in rebuilt && onApply(rebuilt.proposal)}>Adjust to Bench</Button>
      </>;
    } else if (inst.status === "missing") {
      body = <>{alert(inst.note)}
        <Sec title="Payments near this date">
          {nearby.length === 0 ? <p className="text-xs text-muted-foreground">No unmatched payment into the loan account near {dt(inst.dueDate)}. If it was paid as an expense from a bank account, add a payment rule that finds it.</p>
            : <div role="radiogroup" aria-label="Payments near this date" className="flex flex-col gap-1.5">{nearby.map((l) => <button key={l.row.id} type="button" role="radio" aria-checked={chosen === l.row.id} onClick={() => setChosen(l.row.id)} className={cn("rounded border px-3 py-2 text-left text-xs", chosen === l.row.id && "border-primary bg-accent/40")}><span className="block font-medium">{dt(l.row.date)} · {money(l.row.amount)}</span><span className="text-muted-foreground">{l.row.payeeName ?? "Transfer"}{l.row.notes ? ` · ${l.row.notes}` : ""}</span></button>)}</div>}
        </Sec>
        {ignored.length ? <Sec title="Previously marked not this payment">
          <p className="mb-2 text-xs text-muted-foreground">Restore a payment to let Bench match it again. This only changes Bench&apos;s saved decision.</p>
          <div className="flex flex-col gap-2">{ignored.map((r) => <div key={r.id} className="flex items-center gap-2 rounded border p-2 text-xs"><div className="min-w-0 flex-1"><span className="block font-medium">{dt(r.date)} · {money(Math.abs(r.amount))}</span><span className="break-words text-muted-foreground">{accountName(r.accountId)} · {r.payeeName ?? "Transfer"}{r.notes ? ` · ${r.notes}` : ""}</span></div><Button size="xs" variant="outline" onClick={() => actions.restorePayment(r.id)}>Restore</Button></div>)}</div>
        </Sec> : null}{calcSec}
      </>;
      const pick = nearby.find((l) => l.row.id === chosen);
      footer = <><Button variant="outline" size="sm" onClick={onClose}>Close</Button>{nearby.length ? <Button size="sm" disabled={!pick} onClick={() => pick && actions.choosePayment(inst, { id: pick.row.id, row: pick.row, loanRows: [pick.row] })}>This is the payment</Button> : null}</>;
    } else if (inst.status === "recorded" && payment?.kind === "split" && payment.split) {
      const lines = recordedLines(payment);
      const matches = payment.split.principalMinor === benchPrincipal && payment.split.interestMinor === benchInterest;
      body = <>{alert(inst.note, "info")}{paymentSec}
        <Sec title={editingRecorded ? "Change the split in Actual" : "Split in Actual"}>
          {editingRecorded ? <>
            <SplitBar parts={[{ kind: "principal", label: "Principal", minor: principal ?? 0 }, { kind: "interest", label: "Interest", minor: interest ?? 0 }, { kind: "fee", label: "Fees", minor: payment.split.feesMinor }]} />
            <SplitLines money={money} total={payment.amountMinor} lines={[
              { kind: "principal", label: "Principal", goesTo: `Transfer to ${loanName}`, amount: <span className="block w-28"><MoneyField label="Principal" hideLabel valueMinor={principal} minorDigits={digits} fixedDecimals onChange={setPrincipal} /></span> },
              { kind: "interest", label: "Interest", goesTo: interestCategory, amount: interest === null ? "-" : money(interest), sub: `Bench: ${money(benchInterest)}` },
              ...(payment.split.feesMinor ? [{ kind: "fee" as const, label: "Fees", goesTo: "Fee category", amount: money(payment.split.feesMinor) }] : []),
            ]} />
            <p className="mt-2 text-xs text-muted-foreground">Every line keeps its id; the loan-side row follows the principal.</p>
            {rebuilt && "problem" in rebuilt ? <p role="alert" className="mt-1 text-xs text-destructive">{rebuilt.problem}</p> : null}
          </> : <>
            <SplitBar parts={recordedParts(payment)} />
            <SplitLines money={money} total={payment.amountMinor} lines={lines} />
            {matches ? <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">✓ Matches Bench&apos;s calculation</p> : null}
          </>}
        </Sec>
        {loanSec()}
        {undo && "ok" in undo ? <Sec><p className="text-xs text-muted-foreground">Undo isn&apos;t available: {undo.reason}</p></Sec> : null}
      </>;
      footer = editingRecorded
        ? <><Button variant="outline" size="sm" onClick={() => setEditingRecorded(false)}>Back</Button><Button size="sm" disabled={disabled || !rebuilt || "problem" in rebuilt} onClick={() => rebuilt && "proposal" in rebuilt && onApply(rebuilt.proposal)}>Update in Actual</Button></>
        : <><Button variant="ghost" size="sm" className="mr-auto" disabled={disabled || !undo || "ok" in undo} onClick={() => undo && !("ok" in undo) && onApply(undo)}>Undo split</Button><Button variant="outline" size="sm" disabled={disabled} onClick={() => { setPrincipal(payment.split?.principalMinor ?? null); setEditingRecorded(true); }}>Edit split</Button></>;
    } else {
      body = <>{alert(inst.note, inst.status === "check" ? "attention" : "info")}{paymentSec}{calcSec}</>;
    }
  }

  return (
    <aside aria-label="Repayment details" className="flex min-h-0 w-[410px] shrink-0 flex-col border-l border-border/60 bg-background">
      <header className="flex h-[45px] shrink-0 items-center gap-1.5 border-b border-border/60 px-4">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
        {inst ? <StatusBadge status={inst.status} /> : null}
        <Button variant="ghost" size="icon" className="size-7" aria-label="Previous row" disabled={!onPrev} onClick={onPrev}><ChevronLeft className="size-4" /></Button>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Next row" disabled={!onNext} onClick={onNext}><ChevronRight className="size-4" /></Button>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Close details" onClick={onClose}><X className="size-4" /></Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{body}</div>
      <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t p-3">{footer}</footer>
    </aside>
  );
}
