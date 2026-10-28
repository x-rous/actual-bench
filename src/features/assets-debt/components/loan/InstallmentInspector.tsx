"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import { proposalContext, type Installment, type LedgerRow, type Payment } from "@/lib/assets-debt/tracking/plan";
import { adjustSplitProposal, splitProposal, undoSplitProposal, type Proposal } from "@/lib/assets-debt/tracking/proposals";
import type { RowSnapshot } from "@/lib/assets-debt/services/snapshot";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../lib/money";
import type { LoanTracking } from "../../lib/useLoanTracking";
import { MoneyField, TextField } from "../fields";
import { ENTRY_LABELS, StatusBadge, dt } from "./presentation";

/**
 * The docked panel beside Repayments (design spec 06 §7.2): what Bench calculated, what Actual holds now, and what Apply
 * would write, with every line's amount and Notes editable before it is applied. The table keeps its place.
 */

export type InspectorActions = {
  /** This payment isn't this loan's repayment: Bench ignores it from now on (saved in Bench only). */
  notThisPayment: (inst: Installment) => void;
  /** This payment pays this installment (saved in Bench only). */
  choosePayment: (inst: Installment, payment: Pick<Payment, "id" | "row" | "loanRows">) => void;
  /** Actual's balance is right from this installment: the calculation continues from it. */
  acceptActual: (inst: Installment) => void;
};

type InspectorRow = { kind: "installment"; inst: Installment } | { kind: "event"; ledger: LedgerRow } | { kind: "opening"; proposal: Proposal; amountMinor: number; date: string };

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs">{items.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums">{v}</dd></div>)}</dl>;
}

function Heading({ children, aside }: { children: React.ReactNode; aside?: string }) {
  return <h4 className="mb-1.5 flex justify-between text-[11.5px] font-medium text-muted-foreground"><span>{children}</span>{aside ? <span>{aside}</span> : null}</h4>;
}

export function InstallmentInspector({ row, tracking, directory, digits, busy, writesLocked, onApply, actions, onClose }: {
  row: InspectorRow; tracking: LoanTracking; directory: AccountDirectory | undefined; digits: number; busy: boolean; writesLocked: boolean;
  onApply: (proposal: Proposal) => void; actions: InspectorActions; onClose: () => void;
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
  const [chosen, setChosen] = useState<string | null>(payment?.id ?? null);
  const disabled = busy || writesLocked;

  const title = row.kind === "installment" ? `Installment ${row.inst.no} · ${dt(row.inst.dueDate)}` : row.kind === "event" ? `${ENTRY_LABELS[row.ledger.type]} · ${dt(row.ledger.row.date)}` : "Opening adjustment";
  let body: React.ReactNode = null;
  let footer: React.ReactNode = <Button variant="outline" size="sm" onClick={onClose}>Close</Button>;

  if (row.kind === "opening") {
    body = <>
      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">Actual&apos;s loan account differs from the opening position at the tracking start. One row in the loan account sets it right: {money(Math.abs(row.amountMinor))}, dated {dt(row.date)}, Notes &quot;Opening adjustment&quot;. The loan account is off budget, so it has no category.</div>
      {result ? <Facts items={[["Opening position", money(result.opening.principalMinor)], ["Actual's loan account then", money(result.opening.actualMinor)], ["Difference", money(result.opening.differenceMinor)]]} /> : null}
    </>;
    footer = <><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={disabled} onClick={() => onApply(row.proposal)}>Apply</Button></>;
  } else if (row.kind === "event") {
    const l = row.ledger;
    body = <>
      <Facts items={[["Date", dt(l.row.date)], ["Payee", l.row.payeeName ?? "-"], ["Amount in the loan account", money(l.row.amount)], ["Type", `${ENTRY_LABELS[l.type]}${l.suggested ? " (suggested)" : ""}`], ["Notes", l.row.notes ?? "-"]]} />
      <p className="text-xs text-muted-foreground">The calculation includes it from its date. Change its type or Notes in the Loan Ledger.</p>
    </>;
  } else if (inst) {
    const calc = <section><Heading aside="From Bench">Calculation</Heading><Facts items={[["Scheduled payment", money(inst.scheduledMinor)], ["Interest", money(inst.calculatedInterestMinor)], ["Principal", inst.status === "missing" ? "-" : money(inst.principalMinor)], ["Balance after", money(inst.balanceAfterMinor)]]} /></section>;
    const now = payment ? <section><Heading>In Actual now</Heading><Facts items={[
      ["Date", dt(payment.date)], ["Account", accountName(payment.row.accountId)], ["Payee", payment.kind === "rule" ? payment.row.payeeName ?? "-" : `Transfer to ${accountName(tracking.debt?.liabilityAccountId ?? "")}`],
      ["Amount", money(-payment.amountMinor)], ...(payment.kind === "split" && payment.split ? [["Principal (transfer)", money(payment.split.principalMinor)], ["Interest", money(payment.split.interestMinor)]] as [string, string][] : payment.kind === "rule" ? [["Category", categoryName(payment.row.categoryId)]] as [string, string][] : []),
      ["Cleared", payment.row.cleared ? "Yes" : "No"], ["Notes", payment.row.notes ?? "-"],
    ]} /></section> : null;
    const reason = inst.note ? <div className={cn("rounded-lg border px-3 py-2 text-xs", inst.status === "check" || inst.status === "missing" ? "border-amber-500/40 bg-amber-400/10" : "bg-muted/30")}>{inst.note}</div> : null;
    if (inst.status === "unrecorded" && inst.proposal?.kind === "split" && payment) {
      body = <>{reason}{calc}{now}
        <section className="flex flex-col gap-2">
          <Heading aside="Edit before applying">After Apply</Heading>
          <div className="flex flex-col gap-2 rounded-lg border p-2.5">
            <p className="flex justify-between text-xs font-medium"><span>Principal</span><span className="font-normal text-muted-foreground">Transfer to {accountName(tracking.debt?.liabilityAccountId ?? "")}</span></p>
            <MoneyField label="Principal amount" hideLabel valueMinor={principal} minorDigits={digits} fixedDecimals onChange={setPrincipal} />
            <TextField label="Principal line Notes" value={principalNotes} onChange={setPrincipalNotes} />
          </div>
          <div className="flex flex-col gap-2 rounded-lg border p-2.5">
            <p className="flex justify-between text-xs font-medium"><span>Interest</span><span className="font-normal text-muted-foreground">{categoryName(tracking.debt?.interestCategoryId ?? null)}</span></p>
            <p className="text-right text-sm tabular-nums">{interest === null ? "-" : money(interest)}</p>
            <TextField label="Interest line Notes" value={interestNotes} onChange={setInterestNotes} />
          </div>
          {fees ? <p className="text-xs text-muted-foreground">Plus a fee line of {money(fees)}.</p> : null}
          <p className="text-xs text-muted-foreground">Lines add up to the payment, {money(payment.amountMinor)}. Changing the principal changes the interest.{edited ? <> <button type="button" className="underline" onClick={() => { setPrincipal(inst.principalMinor); setPrincipalNotes(split?.operations.find((c) => c.economicKind === "principal")?.notes ?? ""); setInterestNotes(split?.operations.find((c) => c.economicKind === "interest")?.notes ?? ""); }}>Reset to calculated</button></> : null}</p>
          {rebuilt && "problem" in rebuilt ? <p role="alert" className="text-xs text-destructive">{rebuilt.problem}</p> : null}
        </section>
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">One write to Actual: the payment becomes a split. The loan account goes down by {money(principal ?? 0)}{payment.kind === "transfer" ? ` instead of ${money(payment.amountMinor)}` : ""}.</div>
      </>;
      footer = <><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={disabled || !rebuilt || "problem" in rebuilt} onClick={() => rebuilt && "proposal" in rebuilt && onApply(rebuilt.proposal)}>Apply</Button></>;
    } else if (inst.status === "unrecorded" && inst.proposal) {
      body = <>{reason}{calc}{now}<div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">One write to Actual: the payment becomes a transfer to the loan account (this loan charges no interest).</div></>;
      footer = <><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={disabled} onClick={() => onApply(inst.proposal!)}>Apply</Button></>;
    } else if (inst.status === "check" && inst.checkKind === "competing" && payment) {
      const options = [payment, ...(inst.alternatives ?? [])];
      body = <>{reason}
        <section role="radiogroup" aria-label="Payments found" className="flex flex-col gap-1.5">
          <Heading>Payments found</Heading>
          {options.map((p) => <button key={p.id} type="button" role="radio" aria-checked={chosen === p.id} onClick={() => setChosen(p.id)} className={cn("rounded-lg border px-3 py-2 text-left text-xs", chosen === p.id && "border-primary bg-accent/40")}><span className="block font-medium">{dt(p.date)} · {money(p.amountMinor)}</span><span className="text-muted-foreground">{accountName(p.row.accountId)} · {p.row.payeeName ?? "Transfer"}{p.row.notes ? ` · ${p.row.notes}` : ""}</span></button>)}
        </section>{calc}
        <p className="text-xs text-muted-foreground">Your choice is saved in Bench only. Applying the split afterwards is one write to Actual.</p>
      </>;
      const pick = options.find((p) => p.id === chosen);
      footer = <><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={!pick} onClick={() => pick && actions.choosePayment(inst, pick)}>Use this payment</Button></>;
    } else if (inst.status === "check" && inst.checkKind === "drift") {
      body = <>{reason}{calc}{now}
        <div className="flex flex-col gap-2 text-xs">
          <p><strong>Accept Actual&apos;s balance from here:</strong> the calculation continues from Actual&apos;s loan balance after this installment. Nothing is written to Actual.</p>
          <p><strong>Adjust this split to the calculation:</strong> principal {money(payment ? payment.amountMinor - inst.calculatedInterestMinor - (payment.split?.feesMinor ?? 0) : 0)}, interest {money(inst.calculatedInterestMinor)}. One write to Actual.</p>
        </div>
      </>;
      footer = <><Button variant="outline" size="sm" onClick={() => actions.acceptActual(inst)}>Accept Actual&apos;s balance</Button><Button size="sm" disabled={disabled || !rebuilt || "problem" in rebuilt} onClick={() => rebuilt && "proposal" in rebuilt && onApply(rebuilt.proposal)}>Adjust split</Button></>;
    } else if (inst.status === "missing") {
      body = <>{reason}{calc}
        <section className="flex flex-col gap-1.5">
          <Heading>Payments near this date</Heading>
          {nearby.length === 0 ? <p className="text-xs text-muted-foreground">No unmatched payment into the loan account near {dt(inst.dueDate)}. If it was paid as an expense from a bank account, add a payment rule that finds it.</p>
            : nearby.map((l) => <button key={l.row.id} type="button" role="radio" aria-checked={chosen === l.row.id} onClick={() => setChosen(l.row.id)} className={cn("rounded-lg border px-3 py-2 text-left text-xs", chosen === l.row.id && "border-primary bg-accent/40")}><span className="block font-medium">{dt(l.row.date)} · {money(l.row.amount)}</span><span className="text-muted-foreground">{l.row.payeeName ?? "Transfer"}{l.row.notes ? ` · ${l.row.notes}` : ""}</span></button>)}
        </section>
      </>;
      const pick = nearby.find((l) => l.row.id === chosen);
      footer = <><Button variant="outline" size="sm" onClick={onClose}>Close</Button>{nearby.length ? <Button size="sm" disabled={!pick} onClick={() => pick && actions.choosePayment(inst, { id: pick.row.id, row: pick.row, loanRows: [pick.row] })}>This is the payment</Button> : null}</>;
    } else if (inst.status === "recorded" && payment?.kind === "split") {
      body = <>{reason}{calc}{now}
        {editingRecorded ? <section className="flex flex-col gap-2"><Heading>Change the split in Actual</Heading>
          <MoneyField label="Principal" valueMinor={principal} minorDigits={digits} fixedDecimals onChange={setPrincipal} />
          <p className="text-xs text-muted-foreground">Interest becomes {interest === null ? "-" : money(interest)}. Every line keeps its id; the loan-side row follows the principal.</p>
          {rebuilt && "problem" in rebuilt ? <p role="alert" className="text-xs text-destructive">{rebuilt.problem}</p> : null}
        </section> : null}
        {undo && "ok" in undo ? <p className="text-xs text-muted-foreground">Undo isn&apos;t available: {undo.reason}</p> : null}
      </>;
      footer = editingRecorded
        ? <><Button variant="outline" size="sm" onClick={() => setEditingRecorded(false)}>Back</Button><Button size="sm" disabled={disabled || !rebuilt || "problem" in rebuilt} onClick={() => rebuilt && "proposal" in rebuilt && onApply(rebuilt.proposal)}>Update in Actual</Button></>
        : <><Button variant="outline" size="sm" disabled={disabled || !undo || "ok" in undo} onClick={() => undo && !("ok" in undo) && onApply(undo)}>Undo split</Button><Button variant="outline" size="sm" disabled={disabled} onClick={() => { setPrincipal(payment.split?.principalMinor ?? null); setEditingRecorded(true); }}>Edit split</Button></>;
    } else {
      body = <>{reason}{calc}{now}</>;
    }
  }

  return (
    <aside aria-label="Repayment details" className="flex min-h-0 w-[410px] shrink-0 flex-col border-l border-border/60 bg-background">
      <header className="flex h-[45px] shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
        {inst ? <StatusBadge status={inst.status} /> : null}
        <Button variant="ghost" size="icon" className="size-7" aria-label="Close details" onClick={onClose}><X className="size-4" /></Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{body}</div>
      <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t p-3">{footer}</footer>
    </aside>
  );
}
