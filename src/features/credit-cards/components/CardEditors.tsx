"use client";

import { CARD_DATE_FORMAT } from "../lib/displayDates";

import { useId, useState, type FormEvent } from "react";
import { CreditCard, CalendarDays, SlidersHorizontal } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { minorToMajorText, parseMajorToMinor } from "@/features/assets-debt/lib/money";
import type { Account } from "@/types/entities";
import { creditCardStore } from "../lib/memory";
import type { Card, Statement } from "../lib/models";

function readAmount(value: string, required = false, signed = false): number | null {
  const negative = signed && value.trim().startsWith("-");
  const parsed = parseMajorToMinor(negative ? value.trim().slice(1) : value, 2);
  if (!parsed.ok) throw new Error(parsed.message);
  if (required && parsed.value === null) throw new Error("Enter all required amounts");
  return parsed.value === null ? null : negative ? -parsed.value : parsed.value;
}
function validationMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join(". ");
  return error instanceof Error ? error.message : "Could not save these values";
}
function Field({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor: string }) {
  return <div className="space-y-1.5"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>;
}
const dialogClass = "flex flex-col overflow-hidden h-auto max-h-[90dvh] p-4 sm:h-auto sm:max-h-[90dvh] sm:max-w-lg";

export function CardEditor({ budgetSyncId, card, accounts, categories = [], categoriesLoading = false, categoriesError = false, onRetryCategories, canRegister, onClose, onSaved }: {
  budgetSyncId: string; card?: Card; accounts: Account[]; categories?: { id: string; name: string }[]; categoriesLoading?: boolean; categoriesError?: boolean; onRetryCategories?: () => void; canRegister: boolean; onClose: () => void; onSaved: (id: string) => void;
}) {
  const prefix = useId();
  const [initialCard] = useState(card);
  const [accountId, setAccountId] = useState(card?.accountId ?? accounts[0]?.id ?? "");
  const [nickname, setNickname] = useState(card?.nickname ?? accounts[0]?.name ?? "");
  const [issuer, setIssuer] = useState(card?.issuer ?? "");
  const [last4, setLast4] = useState(card?.last4 ?? "");
  const [limit, setLimit] = useState(minorToMajorText(card?.creditLimitMinor ?? null, 2));
  const [apr, setApr] = useState(minorToMajorText(card?.purchaseAprBps ?? null, 2));
  const [timeZone, setTimeZone] = useState(card?.bankTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  const [extra, setExtra] = useState({
    closingDay: card?.closingDay?.toString() ?? "", dueKind: card?.dueRule?.kind ?? "days-after-close",
    dueValue: card?.dueRule ? String(card.dueRule.kind === "days-after-close" ? card.dueRule.days : card.dueRule.day) : "21",
    minimumPercent: minorToMajorText(card ? card.minimumPercentBps : 200, 2), minimumFloor: minorToMajorText(card ? card.minimumFloorMinor : 2500, 2),
    interestCategoryId: card?.interestCategoryId ?? "", feeCategoryId: card?.feeCategoryId ?? "",
    status: card?.status ?? "active", autoPay: card?.autoPay ?? "unknown",
    cashApr: minorToMajorText(card?.cashAdvanceAprBps ?? null, 2), transferApr: minorToMajorText(card?.balanceTransferAprBps ?? null, 2),
    annualFee: minorToMajorText(card?.annualFeeMinor ?? null, 2), renewalDate: card?.renewalDate ?? "", openedDate: card?.openedDate ?? "",
    interestModel: card?.interestModel ?? "daily-simple-365", firstTrackedStatementDate: card?.firstTrackedStatementDate ?? "",
  });
  const change = (key: keyof typeof extra, value: string) => setExtra((current) => ({ ...current, [key]: value }));
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState("");
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (event.currentTarget.querySelector('[aria-invalid="true"]')) throw new Error("Correct the invalid date before saving");
      if (!initialCard && (!canRegister || !accounts.some((account) => account.id === accountId))) throw new Error("This account is no longer eligible. Refresh its classification and try again.");
      const input = { budgetSyncId, accountId, nickname, issuer, last4, creditLimitMinor: readAmount(limit), purchaseAprBps: readAmount(apr), bankTimeZone: timeZone, status: extra.status, network: initialCard?.network ?? "unknown",
        closingDay: extra.closingDay.trim() ? Number(extra.closingDay) : null,
        dueRule: extra.dueKind === "days-after-close" ? { kind: extra.dueKind, days: Number(extra.dueValue) } : { kind: extra.dueKind, day: Number(extra.dueValue) },
        minimumPercentBps: readAmount(extra.minimumPercent), minimumFloorMinor: readAmount(extra.minimumFloor),
        cashAdvanceAprBps: readAmount(extra.cashApr), balanceTransferAprBps: readAmount(extra.transferApr), annualFeeMinor: readAmount(extra.annualFee),
        renewalDate: extra.renewalDate || null, openedDate: extra.openedDate || null, firstTrackedStatementDate: extra.firstTrackedStatementDate || null,
        interestCategoryId: extra.interestCategoryId || null, feeCategoryId: extra.feeCategoryId || null, rewards: initialCard?.rewards ?? "", authorizedUsers: initialCard?.authorizedUsers ?? "", autoPay: extra.autoPay, appearance: initialCard?.appearance ?? "default", interestModel: extra.interestModel };
      const actions = creditCardStore.getState();
      if (initialCard) actions.updateCard(budgetSyncId, initialCard.id, initialCard.revision, input);
      const savedId = initialCard?.id ?? actions.register(input).id;
      onSaved(savedId);
    } catch (cause) { setError(validationMessage(cause)); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className={`${dialogClass} sm:max-w-4xl`}>
      <DialogHeader><div className="flex items-center gap-3"><span className="rounded-md bg-muted p-2 text-muted-foreground"><CreditCard className="size-5" aria-hidden="true" /></span><div className="space-y-1"><DialogTitle>{card ? "Card settings" : "Add credit card"}</DialogTitle><DialogDescription>Link your Actual account and set the billing cycle. Terms are optional.</DialogDescription></div></div></DialogHeader>
      <form onSubmit={save} className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 space-y-3 overflow-auto">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Actual account" htmlFor={`${prefix}-account`}><Select size="default" id={`${prefix}-account`} disabled={Boolean(card)} value={accountId} options={accounts.map((account) => ({ value: account.id, label: account.name }))} onValueChange={(value) => { setAccountId(value); setNickname(accounts.find((account) => account.id === value)?.name ?? ""); }} /></Field>
        <Field label="Nickname" htmlFor={`${prefix}-name`}><Input size="default" id={`${prefix}-name`} value={nickname} onChange={(event) => setNickname(event.target.value)} required maxLength={100} /></Field>
          <Field label="Issuer (optional)" htmlFor={`${prefix}-issuer`}><Input size="default" id={`${prefix}-issuer`} value={issuer} onChange={(event) => setIssuer(event.target.value)} maxLength={100} /></Field>
          <Field label="Last four digits (optional)" htmlFor={`${prefix}-last4`}><Input size="default" id={`${prefix}-last4`} value={last4} onChange={(event) => setLast4(event.target.value)} inputMode="numeric" maxLength={4} /></Field>
          <Field label="Credit limit (optional)" htmlFor={`${prefix}-limit`}><Input size="default" id={`${prefix}-limit`} value={limit} onChange={(event) => setLimit(event.target.value)} inputMode="decimal" /></Field>
          <Field label="Purchase APR % (optional)" htmlFor={`${prefix}-apr`}><Input size="default" id={`${prefix}-apr`} value={apr} onChange={(event) => setApr(event.target.value)} inputMode="decimal" /></Field>
        </div>
        <div className="rounded-md border border-border bg-background p-3 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-medium"><CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />Statement defaults</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Statement closing day" htmlFor={`${prefix}-closing-day`}><Input size="default" id={`${prefix}-closing-day`} value={extra.closingDay} onChange={(event) => change("closingDay", event.target.value)} type="number" min={1} max={31} placeholder="e.g. 4" /></Field>
            <Field label="Due date rule" htmlFor={`${prefix}-due-kind`}><Select size="default" id={`${prefix}-due-kind`} value={extra.dueKind} onValueChange={(value) => change("dueKind", value)} options={[{ value: "days-after-close", label: "Days after closing" }, { value: "day-of-month", label: "Day of month" }]} /></Field>
            <Field label={extra.dueKind === "days-after-close" ? "Days until payment due" : "Payment due day"} htmlFor={`${prefix}-due-value`}><Input size="default" id={`${prefix}-due-value`} type="number" min={extra.dueKind === "days-after-close" ? 0 : 1} max={extra.dueKind === "days-after-close" ? 90 : 31} value={extra.dueValue} onChange={(event) => change("dueValue", event.target.value)} required /></Field>
            <Field label="Minimum payment %" htmlFor={`${prefix}-min-percent`}><Input size="default" id={`${prefix}-min-percent`} inputMode="decimal" value={extra.minimumPercent} onChange={(event) => change("minimumPercent", event.target.value)} /></Field>
            <Field label="Minimum payment floor" htmlFor={`${prefix}-min-floor`}><Input size="default" id={`${prefix}-min-floor`} inputMode="decimal" value={extra.minimumFloor} onChange={(event) => change("minimumFloor", event.target.value)} /></Field>
          <Field label="Interest illustration" htmlFor={`${prefix}-interest-model`}><Select size="default" id={`${prefix}-interest-model`} value={extra.interestModel} onValueChange={(value) => change("interestModel", value)} options={[{ value: "off", label: "Off" }, { value: "daily-simple-365", label: "Daily simple Actual/365" }, { value: "daily-simple-360", label: "Daily simple Actual/360" }]} /></Field>
          <Field label="First tracked statement" htmlFor={`${prefix}-tracking-start`}><DateInput dateFormat={CARD_DATE_FORMAT} size="default" id={`${prefix}-tracking-start`} value={extra.firstTrackedStatementDate} onValueChange={(value) => change("firstTrackedStatementDate", value)} /></Field>
          </div><p className="text-xs text-muted-foreground">Choose the first statement’s closing date. It establishes the opening anchor; earlier cycles are not tracked. Leave blank to use the first saved statement. The toolbar range only controls loading and viewing. Delete earlier saved statements before moving this date forward.</p><p className="text-xs text-muted-foreground">Bank values override estimates. Short months use their last calendar day.</p>
        </div>
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {([["interestCategoryId", "Interest category in Actual"], ["feeCategoryId", "Fees category in Actual"]] as const).map(([key, label]) => <Field key={key} label={label} htmlFor={`${prefix}-${key}`}><Select size="default" id={`${prefix}-${key}`} disabled={categoriesLoading || categoriesError} value={extra[key]} onValueChange={(value) => change(key, value)} options={[{ value: "", label: "Classify individually" }, ...categories.map((category) => ({ value: category.id, label: category.name })), ...(extra[key] && !categories.some((category) => category.id === extra[key]) ? [{ value: extra[key], label: "Saved category (unavailable)" }] : [])]} /></Field>)}
          {categoriesLoading && <p role="status" className="sm:col-span-3 text-xs text-muted-foreground">Loading Actual categories…</p>}
          {categoriesError && <div role="status" className="sm:col-span-3 flex items-center gap-2 text-xs"><span>Actual categories unavailable. Existing mappings are retained.</span><Button type="button" variant="outline" size="xs" onClick={onRetryCategories}>Retry categories</Button></div>}
        </section>
        <section className="rounded-md border border-border p-3"><Button variant="outline" size="sm" type="button" aria-expanded={showMore} aria-controls={`${prefix}-more`} onClick={() => setShowMore(!showMore)}><SlidersHorizontal className="size-3.5 text-muted-foreground" aria-hidden="true" />{showMore ? "Hide extra card details" : "More card details"}</Button>{showMore && <div id={`${prefix}-more`} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {([
            ["status", "Card status", ["active", "frozen", "closed", "lost-stolen"]],
            ["autoPay", "Auto-pay", ["unknown", "off", "minimum", "full", "fixed"]],
          ] as const).map(([key, label, values]) => <Field key={key} label={label} htmlFor={`${prefix}-${key}`}><Select size="default" id={`${prefix}-${key}`} value={extra[key]} onValueChange={(value) => change(key, value)} options={values.map((value) => ({ value, label: value.replaceAll("-", " ") }))} /></Field>)}
          {([["cashApr", "Cash advance APR %"], ["transferApr", "Balance transfer APR %"], ["annualFee", "Annual fee"]] as const).map(([key, label]) => <Field key={key} label={label} htmlFor={`${prefix}-${key}`}><Input size="default" id={`${prefix}-${key}`} value={extra[key]} onChange={(event) => change(key, event.target.value)} inputMode="decimal" /></Field>)}
          {([["renewalDate", "Fee renewal date"], ["openedDate", "Date opened"]] as const).map(([key, label]) => <Field key={key} label={label} htmlFor={`${prefix}-${key}`}><DateInput dateFormat={CARD_DATE_FORMAT} size="default" id={`${prefix}-${key}`} value={extra[key]} onValueChange={(value) => change(key, value)} /></Field>)}


          <Field label="Bank time zone" htmlFor={`${prefix}-zone`}><Input size="default" id={`${prefix}-zone`} value={timeZone} onChange={(event) => setTimeZone(event.target.value)} required title="Determines today for statement closing and overdue status; does not convert Actual transaction dates" /></Field>
          <p className="sm:col-span-3 text-xs text-muted-foreground">Categories identify posted charges; unmapped charges can be classified individually. The time zone determines today for closing and overdue status, without converting transaction dates.</p>
          <p className="sm:col-span-3 text-xs text-muted-foreground">Interest illustrations use the Loans & Debt engine. They assume purchase APR applies to all current debt, monthly capitalization, no grace period, no new spending and no repayments. They are not a forecast of your bank’s charge.</p>
        </div>}</section>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div><div className="mt-3 flex shrink-0 justify-end gap-2 border-t pt-3"><Button variant="outline" type="button" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!card && !canRegister}>Save card</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function StatementEditor({ budgetSyncId, card, statement, suggested, canRecord, onClose, onSaved }: { budgetSyncId: string; card: Card; statement?: Statement; suggested?: import("../lib/cycles").StatementDraft; canRecord: boolean; onClose: () => void; onSaved?: (id: string) => void }) {
  const prefix = useId();
  const [initial] = useState({ card, statement });
  const [periodStart, setPeriodStart] = useState(statement?.periodStart ?? suggested?.periodStart ?? "");
  const [closingDate, setClosingDate] = useState(statement?.closingDate ?? suggested?.closingDate ?? "");
  const [dueDate, setDueDate] = useState(statement?.dueDate ?? suggested?.dueDate ?? "");
  const [balance, setBalance] = useState(minorToMajorText(statement?.officialBalanceMinor ?? suggested?.officialBalanceMinor ?? null, 2));
  const [minimum, setMinimum] = useState(minorToMajorText(statement?.minimumDueMinor ?? (suggested?.minimumKnown ? suggested.minimumDueMinor : null), 2));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (event.currentTarget.querySelector('[aria-invalid="true"]')) throw new Error("Correct the invalid date before saving");
      if (!initial.statement && !canRecord) throw new Error("Refresh the card account and its classification before recording a statement");
      const facts = { periodStart, closingDate, dueDate, officialBalanceMinor: readAmount(balance, true, true), minimumDueMinor: readAmount(minimum, true) };
      let savedId = initial.statement?.id;
      if (initial.statement) creditCardStore.getState().correctStatement(budgetSyncId, initial.statement.id, initial.statement.revision, facts, reason);
      else savedId = creditCardStore.getState().recordStatement(budgetSyncId, initial.card.id, initial.card.revision, facts, true).id;
      if (onSaved && savedId) onSaved(savedId);
      else onClose();
    } catch (cause) { setError(validationMessage(cause)); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className={dialogClass}>
      <DialogHeader><DialogTitle>{statement ? "Correct bank facts" : "Add latest statement"}</DialogTitle><DialogDescription>{card.nickname} · Enter values from your official bank statement.</DialogDescription></DialogHeader>
      <form onSubmit={save} className="mt-4 flex min-h-0 flex-1 flex-col"><div className="min-h-0 space-y-4 overflow-auto">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Period start" htmlFor={`${prefix}-start`}><DateInput dateFormat={CARD_DATE_FORMAT} size="default" id={`${prefix}-start`} value={periodStart} onValueChange={setPeriodStart} /></Field>
          <Field label="Closing date" htmlFor={`${prefix}-close`}><DateInput dateFormat={CARD_DATE_FORMAT} size="default" id={`${prefix}-close`} value={closingDate} onValueChange={setClosingDate} /></Field>
          <Field label="Statement balance" htmlFor={`${prefix}-balance`}><Input size="default" id={`${prefix}-balance`} value={balance} onChange={(event) => setBalance(event.target.value)} inputMode="decimal" required /></Field>
          <Field label="Minimum due" htmlFor={`${prefix}-minimum`}><Input size="default" id={`${prefix}-minimum`} value={minimum} onChange={(event) => setMinimum(event.target.value)} inputMode="decimal" required /></Field>
          <Field label="Payment due date" htmlFor={`${prefix}-due`}><DateInput dateFormat={CARD_DATE_FORMAT} size="default" id={`${prefix}-due`} value={dueDate} onValueChange={setDueDate} /><p className="mt-1 text-xs text-muted-foreground">Use the bank’s due date, including holiday adjustments. Overrides card defaults.</p></Field>
        </div>
        <p className="text-xs text-muted-foreground">Use the statement balance and minimum due from your official bank statement. A negative statement balance means card credit. Bank values override estimates. Bank statements anchor the optional debt breakdown; repayments are linked independently by date.</p>
        {statement && <Field label="Correction reason" htmlFor={`${prefix}-reason`}><Input size="default" id={`${prefix}-reason`} value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} /></Field>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div><div className="mt-3 flex shrink-0 justify-end gap-2 border-t pt-3"><Button variant="outline" type="button" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!statement && !canRecord}>{statement ? "Save correction" : "Save statement"}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
