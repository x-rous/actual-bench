"use client";

import { CardMark } from "./CardIdentity";
import { cardNetworkLabel, CARD_NETWORK_OPTIONS } from "./CardNetwork";
import { BillingCyclePreview } from "./BillingCyclePreview";

import { CARD_DATE_FORMAT } from "../lib/displayDates";

import { useId, useRef, useState, type FormEvent } from "react";
import { Info, Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatAmount, minorToMajorText, parseMajorToMinor } from "@/features/assets-debt/lib/money";
import type { Account } from "@/types/entities";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { addMonths, dateInMonth, parseIsoDate } from "@/lib/financial-models/calendar/dates";
import { bankToday, cycleDates } from "../lib/cycles";
import { useDiscardChanges } from "../hooks/useDiscardChanges";
import { creditCardStore } from "../lib/memory";
import type { Card, Statement } from "../lib/models";

function readAmount(value: string, required = false, signed = false): number | null {
  if (value.includes(",") && !/^-?\d{1,3}(,\d{3})*(\.\d{0,2})?$/.test(value.trim())) throw new Error("Use standard thousands grouping, for example 1,234.56");
  value = value.replaceAll(",", "");
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
const FIELD_HELP: Record<string, string> = {
  "Actual account": "Uses this Actual account’s name, transactions and balance. The linked account cannot be changed after registration.",
  "Credit limit (optional)": "Used for available credit and utilization. It does not change the amount owed.",
  "Purchase APR % (optional)": "Used only in optional interest illustrations, applying this APR to all modeled debt. No grace period or separate APR buckets are modeled; Actual interest charges remain authoritative.",
  "Statement closing day": "Generates billing cycles and projected interest posting dates. Short months use their last calendar day. Bank-entered dates override estimates.",
  "Due date rule": "Choose days after closing or a day of the month. Bank-confirmed statement deadlines override estimates.",
  "Days until payment due": "Number of days after closing. This is an editable assumption, not a bank-confirmed term.",
  "Payment due day": "Day of the month, clamped in shorter months and moved to the next month when necessary.",
  "Minimum payment %": "Percentage-of-balance minimum estimate, combined with the floor. Defaults to 5%; bank-confirmed minimums override estimates.",
  "Minimum payment floor": "Floor for estimated minimum payments, capped at the amount owed. The initial 100.00 is an editable assumption.",
  "Interest illustration": "Uses the Loans & Debt engine with daily simple Actual/365 or Actual/360 and monthly capitalization. Illustrations are hypothetical; grace periods and separate APR buckets are not modeled. Off disables projections, not observed interest reporting.",
  "First tracked statement": "Choose the first statement’s closing date. Earlier cycles are not tracked. Leave blank to use the first saved statement. All history from this statement loads automatically. Delete earlier saved statements before moving this date forward.",
  "Interest category in Actual": "Identifies posted interest charges. Leave unmapped to classify individually; individual classifications take precedence.",
  "Cashback category in Actual": "Identifies cashback credits separately from refunds and payments. Cashback reduces the card balance but is not assumed to satisfy the issuer’s minimum payment.",
  "Fees category in Actual": "Identifies posted fees separately from interest and purchases. Leave unmapped to classify individually.",
  "Card status": "Active or Inactive is a workspace label. Inactive does not remove outstanding debt or stop history tracking, and does not change the Actual account.",
  "Auto-pay": "Informational only. This setting does not generate payments or mark obligations paid; recorded Actual transfers determine repayment status.",
  "Annual fee": "Informational only. Does not schedule charges or add fees to projections; Actual posted fees determine observed totals.",
  "Fee renewal date": "Informational only. No reminder or automatic charge is generated.",
  "Date opened": "Prevents automatic statement drafts before this date. Leave blank if the first tracked statement is sufficient.",
  "Bank time zone": "Determines today for closing, loading and overdue status. Defaults to your browser time zone and does not convert Actual transaction dates.",
  "Balance brought forward (optional)": "Previous statement balance before this cycle’s transactions. Enter 0 if none was owed, or a negative amount for credit. Leave blank to confirm transactions without reconciling the balance.",
  "Statement balance": "Closing balance from the official bank statement. A negative balance means card credit; this is not the remaining amount after later payments.",
  "Minimum due": "Bank-confirmed minimum for this statement, overriding the card’s estimated percentage and floor.",
  "Payment due date": "Use the bank’s due date, including holiday adjustments. Overrides card defaults.",
  "Period start": "First date in the bank statement’s billing period, including any bank-specific closing exceptions.",
  "Closing date": "Official statement closing date; this identifies the tracked cycle.",
};
function Field({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor: string }) {
  const help = FIELD_HELP[label];
  return <div className="flex min-w-0 flex-col gap-1"><div className="flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground"><Label className="text-xs leading-4" htmlFor={htmlFor}>{label}{label === "Statement closing day" && <span aria-hidden="true"> *</span>}</Label>{help && <Popover><PopoverTrigger type="button" aria-label={`About ${label}`} className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><Info className="size-3.5" aria-hidden="true" /></PopoverTrigger><PopoverContent align="start" aria-label={`Help for ${label}`} className="max-w-[min(22rem,90vw)] p-3 text-xs leading-relaxed">{help}</PopoverContent></Popover>}</div>{children}</div>;
}
const dialogClass = "flex flex-col overflow-hidden rounded-2xl h-auto max-h-[90dvh] p-5 sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl";

export function CardEditor({ budgetSyncId, card, accounts, categories = [], categoriesLoading = false, categoriesError = false, onRetryCategories, canRegister, onClose, onSaved, onDeleted }: {
  budgetSyncId: string; card?: Card; accounts: Account[]; categories?: { id: string; name: string }[]; categoriesLoading?: boolean; categoriesError?: boolean; onRetryCategories?: () => void; canRegister: boolean; onClose: () => void; onSaved: (id: string) => void; onDeleted?: () => void;
}) {
  const prefix = useId();
  const [initialCard] = useState(card);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const [appearance, setAppearance] = useState(card?.appearance ?? "default");
  const [customColor, setCustomColor] = useState(card?.customColor ?? null);
  const [network, setNetwork] = useState(card?.network ?? "unknown");
  const [accountId, setAccountId] = useState(card?.accountId ?? accounts[0]?.id ?? "");
  const [limit, setLimit] = useState(minorToMajorText(card?.creditLimitMinor ?? null, 2));
  const [apr, setApr] = useState(minorToMajorText(card?.purchaseAprBps ?? null, 2));
  const [timeZone, setTimeZone] = useState(card?.bankTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  const [extra, setExtra] = useState({
    closingDay: card?.closingDay?.toString() ?? (card ? "" : "8"), dueKind: card?.dueRule?.kind ?? (card ? "days-after-close" : "day-of-month"),
    dueValue: card?.dueRule ? String(card.dueRule.kind === "days-after-close" ? card.dueRule.days : card.dueRule.day) : card ? "21" : "2",
    minimumPercent: minorToMajorText(card ? card.minimumPercentBps : 500, 2), minimumFloor: minorToMajorText(card ? card.minimumFloorMinor : 10000, 2),
    interestCategoryId: card?.interestCategoryId ?? "", feeCategoryId: card?.feeCategoryId ?? "", cashbackCategoryId: card?.cashbackCategoryId ?? "",
    status: card?.status === "active" || !card ? "active" : "inactive", autoPay: card?.autoPay ?? "unknown",
    annualFee: minorToMajorText(card?.annualFeeMinor ?? null, 2), renewalDate: card?.renewalDate ?? "", openedDate: card?.openedDate ?? "",
    interestModel: card?.interestModel ?? "daily-simple-365", firstTrackedStatementDate: card?.firstTrackedStatementDate ?? "",
  });
  const change = (key: keyof typeof extra, value: string) => setExtra((current) => ({ ...current, [key]: value }));
  const [error, setError] = useState("");
  const signature = JSON.stringify({ accountId, limit, apr, timeZone, extra, appearance, customColor, network });
  const [initialSignature] = useState(signature);
  const { requestClose, discardDialog } = useDiscardChanges(signature !== initialSignature, onClose);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const invalid = event.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (invalid) { invalid.focus(); throw new Error("Correct the invalid date before saving"); }
      if (!extra.closingDay.trim() || !Number.isInteger(Number(extra.closingDay)) || Number(extra.closingDay) < 1 || Number(extra.closingDay) > 31) throw new Error("Enter a statement closing day from 1 to 31");
      if (!initialCard && (!canRegister || !accounts.some((account) => account.id === accountId))) throw new Error("This account is no longer eligible. Refresh its classification and try again.");
      const input = { budgetSyncId, accountId, nickname: accounts.find((account) => account.id === accountId)?.name ?? initialCard?.nickname ?? accountId, issuer: "", last4: "", creditLimitMinor: readAmount(limit), purchaseAprBps: readAmount(apr), bankTimeZone: timeZone, status: extra.status, network,
        closingDay: extra.closingDay.trim() ? Number(extra.closingDay) : null,
        dueRule: extra.dueKind === "days-after-close" ? { kind: extra.dueKind, days: Number(extra.dueValue) } : { kind: extra.dueKind, day: Number(extra.dueValue) },
        minimumPercentBps: readAmount(extra.minimumPercent), minimumFloorMinor: readAmount(extra.minimumFloor),
        cashAdvanceAprBps: null, balanceTransferAprBps: null, annualFeeMinor: readAmount(extra.annualFee),
        renewalDate: extra.renewalDate || null, openedDate: extra.openedDate || null, firstTrackedStatementDate: extra.firstTrackedStatementDate || null,
        interestCategoryId: extra.interestCategoryId || null, feeCategoryId: extra.feeCategoryId || null, cashbackCategoryId: extra.cashbackCategoryId || null, rewards: initialCard?.rewards ?? "", authorizedUsers: initialCard?.authorizedUsers ?? "", autoPay: extra.autoPay, appearance, customColor, interestModel: extra.interestModel };
      const actions = creditCardStore.getState();
      if (initialCard) actions.updateCard(budgetSyncId, initialCard.id, initialCard.revision, input);
      const savedId = initialCard?.id ?? actions.register(input).id;
      onSaved(savedId);
    } catch (cause) { setError(validationMessage(cause)); }
  }
  function deleteCard() {
    if (!initialCard) return;
    try {
      creditCardStore.getState().deleteCard(budgetSyncId, initialCard.id, initialCard.revision);
      setDeleting(false);
      (onDeleted ?? onClose)();
    } catch (cause) { setDeleteError(validationMessage(cause)); }
  }
  const categoriesFields = ([["feeCategoryId", "Fees category in Actual"], ["interestCategoryId", "Interest category in Actual"], ["cashbackCategoryId", "Cashback category in Actual"]] as const).map(([key, label]) => <Field key={key} label={label} htmlFor={`${prefix}-${key}`}><Select id={`${prefix}-${key}`} disabled={categoriesLoading || categoriesError} value={extra[key]} onValueChange={(value) => change(key, value)} options={[{ value: "", label: "Classify individually" }, ...categories.map((category) => ({ value: category.id, label: category.name })), ...(extra[key] && !categories.some((category) => category.id === extra[key]) ? [{ value: extra[key], label: "Saved category (unavailable)" }] : [])]} /></Field>);
  const accountFields = <><Field label="Actual account" htmlFor={`${prefix}-account`}><Select id={`${prefix}-account`} disabled={Boolean(card)} value={accountId} options={accounts.map((account) => ({ value: account.id, label: account.name }))} onValueChange={setAccountId} /></Field><Field label="First tracked statement" htmlFor={`${prefix}-tracking-start`}><DateInput dateFormat={CARD_DATE_FORMAT} id={`${prefix}-tracking-start`} value={extra.firstTrackedStatementDate} onValueChange={(value) => change("firstTrackedStatementDate", value)} /></Field><Field label="Network" htmlFor={`${prefix}-network`}><Select id={`${prefix}-network`} value={network} onValueChange={(value) => setNetwork(value as Card["network"])} options={CARD_NETWORK_OPTIONS} /></Field></>;
  const appearanceFields = <div className="col-span-full"><div className="space-y-2"><Label className="text-xs leading-4 text-muted-foreground">Card color</Label><div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5" role="group" aria-label="Card color">{Object.entries({ default: "#262626", navy: "#233a83", blue: "#2563eb", teal: "#0f766e", green: "#166534", red: "#991b1b", purple: "#6b21a8", amber: "#b08b34", gray: "#a3a3a3" }).map(([name, color]) => <button key={name} type="button" aria-label={`Card color ${name}`} aria-pressed={!customColor && appearance === name} className={`size-6 shrink-0 rounded-md border focus-visible:outline-2 focus-visible:outline-ring ${!customColor && appearance === name ? "ring-2 ring-foreground ring-offset-2" : ""}`} style={{ backgroundColor: color }} onClick={() => { setAppearance(name as Card["appearance"]); setCustomColor(null); }} />)}<label className="relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed focus-within:outline-2 focus-within:outline-ring" style={customColor ? { backgroundColor: customColor } : undefined}><Plus className="size-3.5" aria-hidden /><input type="color" aria-label="Custom card color" className="absolute inset-0 size-full cursor-pointer opacity-0" value={customColor ?? "#262626"} onChange={(event) => setCustomColor(event.target.value)} /></label><Button type="button" variant="ghost" size="xs" onClick={() => { setAppearance("default"); setCustomColor(null); }}>Clear</Button></div></div></div>;
  const billingFields = <><Field label="Statement closing day" htmlFor={`${prefix}-closing-day`}><Input id={`${prefix}-closing-day`} value={extra.closingDay} onChange={(event) => change("closingDay", event.target.value)} type="number" min={1} max={31} placeholder="e.g. 4" required aria-required="true" /></Field><Field label="Due date rule" htmlFor={`${prefix}-due-kind`}><Select id={`${prefix}-due-kind`} value={extra.dueKind} onValueChange={(value) => change("dueKind", value)} options={[{ value: "days-after-close", label: "Days after closing" }, { value: "day-of-month", label: "Day of month" }]} /></Field><Field label={extra.dueKind === "days-after-close" ? "Days until payment due" : "Payment due day"} htmlFor={`${prefix}-due-value`}><Input id={`${prefix}-due-value`} type="number" min={extra.dueKind === "days-after-close" ? 0 : 1} max={extra.dueKind === "days-after-close" ? 90 : 31} value={extra.dueValue} onChange={(event) => change("dueValue", event.target.value)} required /></Field></>;
  let preview: { closingDate: string; dueDate: string } | null = null;
  let followingPreview: { closingDate: string; dueDate: string } | null = null;
  try { if (Number(extra.closingDay) >= 1 && Number(extra.closingDay) <= 31) { const today = bankToday(timeZone); const current = parseIsoDate(today); let close = dateInMonth(current.year, current.month, Number(extra.closingDay)); if (close <= today) close = addMonths(close, 1, Number(extra.closingDay)); preview = cycleDates({ ...card, closingDay: Number(extra.closingDay), dueRule: extra.dueKind === "days-after-close" ? { kind: "days-after-close", days: Number(extra.dueValue) } : { kind: "day-of-month", day: Number(extra.dueValue) } } as Card, close); followingPreview = cycleDates({ ...card, closingDay: Number(extra.closingDay), dueRule: extra.dueKind === "days-after-close" ? { kind: "days-after-close", days: Number(extra.dueValue) } : { kind: "day-of-month", day: Number(extra.dueValue) } } as Card, addMonths(close, 1, Number(extra.closingDay))); } } catch { preview = null; followingPreview = null; }
  const termsFields = <><Field label="Credit limit (optional)" htmlFor={`${prefix}-limit`}><Input id={`${prefix}-limit`} value={limit} onChange={(event) => setLimit(event.target.value)} inputMode="decimal" /></Field><Field label="Purchase APR % (optional)" htmlFor={`${prefix}-apr`}><Input id={`${prefix}-apr`} value={apr} onChange={(event) => setApr(event.target.value)} inputMode="decimal" /></Field><Field label="Interest illustration" htmlFor={`${prefix}-interest-model`}><Select id={`${prefix}-interest-model`} value={extra.interestModel} onValueChange={(value) => change("interestModel", value)} options={[{ value: "off", label: "Off" }, { value: "daily-simple-365", label: "Daily simple Actual/365" }, { value: "daily-simple-360", label: "Daily simple Actual/360" }]} /></Field></>;
  const paymentFields = <><Field label="Minimum payment %" htmlFor={`${prefix}-min-percent`}><Input id={`${prefix}-min-percent`} inputMode="decimal" value={extra.minimumPercent} onChange={(event) => change("minimumPercent", event.target.value)} /></Field><Field label="Minimum payment floor" htmlFor={`${prefix}-min-floor`}><Input id={`${prefix}-min-floor`} inputMode="decimal" value={extra.minimumFloor} onChange={(event) => change("minimumFloor", event.target.value)} /></Field><Field label="Auto-pay" htmlFor={`${prefix}-autoPay`}><Select id={`${prefix}-autoPay`} value={extra.autoPay} onValueChange={(value) => change("autoPay", value)} options={["unknown", "off", "minimum", "full", "fixed"].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} /></Field></>;
  const detailsFields = <><Field label="Card status" htmlFor={`${prefix}-status`}><Select id={`${prefix}-status`} value={extra.status} onValueChange={(value) => change("status", value)} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} /></Field><Field label="Bank time zone" htmlFor={`${prefix}-zone`}><Input id={`${prefix}-zone`} value={timeZone} onChange={(event) => setTimeZone(event.target.value)} required /></Field><Field label="Annual fee" htmlFor={`${prefix}-annualFee`}><Input id={`${prefix}-annualFee`} value={extra.annualFee} onChange={(event) => change("annualFee", event.target.value)} inputMode="decimal" /></Field>{([["renewalDate", "Fee renewal date"], ["openedDate", "Date opened"]] as const).map(([key, label]) => <Field key={key} label={label} htmlFor={`${prefix}-${key}`}><DateInput dateFormat={CARD_DATE_FORMAT} id={`${prefix}-${key}`} value={extra[key]} onValueChange={(value) => change(key, value)} /></Field>)}</>;
  const group = (title: string, content: React.ReactNode) => (
    <fieldset className="min-w-0 rounded-lg border border-border px-4 pt-2 pb-4">
      <legend className="px-2 text-sm font-semibold">{title}</legend>
      <div className="grid grid-cols-3 gap-x-4 gap-y-3">{content}</div>
    </fieldset>
  );
  return <>
    <Sheet open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <SheetContent className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:w-[min(48.4rem,85vw)] data-[side=right]:sm:max-w-none">
        <SheetHeader className="shrink-0 border-b p-4 pr-12">
          <div className="flex items-center gap-3">
            <CardMark card={{ appearance, customColor, network }} preview />
            <div>
              <SheetTitle>{card ? "Card settings" : "Add credit card"}</SheetTitle>
              <SheetDescription>{accounts.find((account) => account.id === accountId)?.name ?? card?.nickname ?? "Choose an Actual account"}{network !== "unknown" && <span className="text-xs"> · {cardNetworkLabel(network)}</span>}</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            {group("Account setup", <>{accountFields}{categoriesFields}
              {categoriesLoading && <p role="status" className="col-span-full text-xs text-muted-foreground">Loading Actual categories…</p>}
              {categoriesError && <div role="status" className="col-span-full flex items-center gap-2 text-xs"><span>Actual categories unavailable. Existing mappings are retained.</span><Button type="button" variant="outline" size="xs" onClick={onRetryCategories}>Retry categories</Button></div>}
              {appearanceFields}
            </>)}
            {group("Billing & payments", <>{billingFields}{preview && <BillingCyclePreview today={bankToday(timeZone)} cycle={preview} next={followingPreview} />}{paymentFields}</>)}
            {group("Credit & interest", termsFields)}
            {group("Additional details", detailsFields)}
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-muted/10 p-4">
            <div>{card && <Button ref={deleteTrigger} variant="destructive" type="button" onClick={() => { setDeleteError(""); setDeleting(true); }}><Trash2 className="size-3.5" aria-hidden="true" />Delete card</Button>}</div>
            <div className="flex gap-2"><Button variant="outline" type="button" onClick={requestClose}>Cancel</Button><Button type="submit" disabled={!card && !canRegister}>Save card</Button></div>
          </div>
        </form>
      </SheetContent>
      {card && <Dialog open={deleting} onOpenChange={setDeleting}><DialogContent initialFocus={cancelDelete} finalFocus={deleteTrigger} showCloseButton={false}>
        <DialogHeader><DialogTitle>Delete credit card?</DialogTitle><DialogDescription>Delete {card.nickname} from Credit Cards? This removes its saved settings, statements, review decisions, payment allocations, activity classifications and repayment plans from this workspace. Any unsaved settings will be discarded. Your Actual account and transactions stay unchanged. You can restore this deletion with Undo.</DialogDescription></DialogHeader>
        {deleteError && <p role="alert" className="text-xs text-destructive">{deleteError}</p>}
        <DialogFooter><Button ref={cancelDelete} variant="outline" type="button" onClick={() => setDeleting(false)}>Cancel</Button><Button variant="destructive" type="button" onClick={deleteCard}>Delete card</Button></DialogFooter>
      </DialogContent></Dialog>}
    </Sheet>
    {discardDialog}
  </>;
}

export function StatementEditor({ budgetSyncId, card, statement, suggested, canRecord, onClose, onSaved }: { budgetSyncId: string; card: Card; statement?: Statement; suggested?: import("../lib/cycles").StatementDraft; canRecord: boolean; onClose: () => void; onSaved?: (id: string) => void }) {
  const prefix = useId();
  const [initial] = useState({ card, statement });
  const [periodStart, setPeriodStart] = useState(statement?.periodStart ?? suggested?.periodStart ?? "");
  const [closingDate, setClosingDate] = useState(statement?.closingDate ?? suggested?.closingDate ?? "");
  const [dueDate, setDueDate] = useState(statement?.dueDate ?? suggested?.dueDate ?? "");
  const [balance, setBalance] = useState((statement?.officialBalanceMinor ?? suggested?.officialBalanceMinor) == null ? "" : formatAmount((statement?.officialBalanceMinor ?? suggested?.officialBalanceMinor)!, 2));
  const [minimum, setMinimum] = useState((statement?.minimumDueMinor ?? (suggested?.minimumKnown ? suggested.minimumDueMinor : null)) == null ? "" : formatAmount((statement?.minimumDueMinor ?? suggested?.minimumDueMinor)!, 2));
  const [openingBalance, setOpeningBalance] = useState(minorToMajorText(statement?.openingBalanceMinor ?? null, 2));
  const isFirstStatement = Boolean(statement?.openingAnchor || (!statement && !initial.card.firstTrackedStatementDate) || closingDate === initial.card.firstTrackedStatementDate);
  const [error, setError] = useState("");
  const signature = JSON.stringify({ periodStart, closingDate, dueDate, balance, minimum, openingBalance });
  const [initialSignature] = useState(signature);
  const { requestClose, discardDialog } = useDiscardChanges(signature !== initialSignature, onClose);
  function formatInput(value: string, set: (value: string) => void) { try { const amount = readAmount(value, false, true); if (amount !== null) set(formatAmount(amount, 2)); } catch { /* Preserve invalid input for correction. */ } }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (event.currentTarget.querySelector('[aria-invalid="true"]')) throw new Error("Correct the invalid date before saving");
      if (!initial.statement && !canRecord) throw new Error("Refresh the card account and its classification before recording a statement");
      const facts = { periodStart, closingDate, dueDate, officialBalanceMinor: readAmount(balance, true, true), minimumDueMinor: readAmount(minimum, true), openingBalanceMinor: isFirstStatement ? readAmount(openingBalance, false, true) : initial.statement?.openingBalanceMinor ?? null };
      let savedId = initial.statement?.id;
      if (initial.statement) creditCardStore.getState().correctStatement(budgetSyncId, initial.statement.id, initial.statement.revision, facts);
      else savedId = creditCardStore.getState().recordStatement(budgetSyncId, initial.card.id, initial.card.revision, facts, true).id;
      if (onSaved && savedId) onSaved(savedId);
      else onClose();
    } catch (cause) { setError(validationMessage(cause)); }
  }
  return <><Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
    <DialogContent className={dialogClass}>
      <DialogHeader><DialogTitle>{statement ? "Correct bank facts" : "Add latest statement"}</DialogTitle><DialogDescription>{card.nickname} · Enter values from your official bank statement.</DialogDescription></DialogHeader>
      <form onSubmit={save} className="mt-4 flex min-h-0 flex-1 flex-col"><div className="min-h-0 space-y-4 overflow-auto">
        <fieldset className="rounded-xl border p-4"><legend className="px-1 text-sm font-semibold">Statement dates</legend><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Period start" htmlFor={`${prefix}-start`}><DateInput dateFormat={CARD_DATE_FORMAT} size="default" id={`${prefix}-start`} value={periodStart} onValueChange={setPeriodStart} /></Field>
          <Field label="Closing date" htmlFor={`${prefix}-close`}><DateInput dateFormat={CARD_DATE_FORMAT} size="default" id={`${prefix}-close`} value={closingDate} onValueChange={setClosingDate} /></Field>
          <Field label="Payment due date" htmlFor={`${prefix}-due`}><DateInput dateFormat={CARD_DATE_FORMAT} size="default" id={`${prefix}-due`} value={dueDate} onValueChange={setDueDate} /></Field>
        </div></fieldset>
        <fieldset className="rounded-xl border p-4"><legend className="px-1 text-sm font-semibold">Bank figures</legend><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Statement balance" htmlFor={`${prefix}-balance`}><Input size="default" id={`${prefix}-balance`} value={balance} onBlur={() => formatInput(balance, setBalance)} onChange={(event) => setBalance(event.target.value)} inputMode="decimal" required /></Field>
          <Field label="Minimum due" htmlFor={`${prefix}-minimum`}><Input size="default" id={`${prefix}-minimum`} value={minimum} onBlur={() => formatInput(minimum, setMinimum)} onChange={(event) => setMinimum(event.target.value)} inputMode="decimal" required /></Field>
          {isFirstStatement && <Field label="Balance brought forward (optional)" htmlFor={`${prefix}-opening-balance`}><Input size="default" id={`${prefix}-opening-balance`} value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} inputMode="decimal" /></Field>}
        </div></fieldset>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div><p className="mt-4 rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground">Saving updates bank values and opens transaction review. Later statements may need review again.</p><div className="mt-3 flex shrink-0 justify-end gap-2 border-t pt-3"><Button variant="outline" type="button" onClick={requestClose}>Cancel</Button><Button type="submit" disabled={!statement && !canRecord}>{onSaved ? "Save and review" : "Save statement"}</Button></div>
      </form>
    </DialogContent>
  </Dialog>{discardDialog}</>;
}
