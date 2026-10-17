"use client";
import { useId, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { generateId } from "@/lib/uuid";
import { formatAmount, minorToMajorText, parseMajorToMinor } from "@/features/assets-debt/lib/money";
import { addMonths } from "@/lib/financial-models/calendar/dates";
import { CARD_DATE_FORMAT, formatCardDate } from "../lib/displayDates";
import { bankToday } from "../lib/cycles";
import { creditCardStore } from "../lib/memory";
import { repaymentPlanSchema, type Card, type PlanLink, type RepaymentPlan, type Workspace } from "../lib/models";
import { financingCostKind } from "../lib/planTracking";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import { sumMinor } from "../lib/statements";
import { planForTransaction, planProgress, planProjection, planSchedule, planSources } from "../lib/plans";
import { useDiscardChanges } from "../hooks/useDiscardChanges";
import { PlanTransactions } from "./PlanTransactions";
import { PlanRefundReview } from "./PlanRefundReview";

function minor(value: string, optional = false) { const parsed = parseMajorToMinor(value, 2); if (!parsed.ok || !optional && parsed.value === null) throw new Error(parsed.ok ? "Enter the required amounts" : parsed.message); return parsed.value; }
export function PlanEditor({ budget, card, row, plan, workspace, snapshot, available, onClose, focusTransactionId, initialTab = "terms" }: { budget: string; card: Card; row?: ActivityRow; plan?: RepaymentPlan; workspace: Workspace; snapshot: ActivitySnapshot; available: boolean; onClose: () => void; focusTransactionId?: string; initialTab?: "terms" | "transactions" }) {
  const prefix = useId();
  const [initial] = useState(() => ({ id: plan?.id ?? generateId(), revision: plan?.revision ?? 1, cardRevision: card.revision }));
  const [expectedCardRevision, setExpectedCardRevision] = useState(initial.cardRevision);
  const [tab, setTab] = useState(initialTab);
  const [mode, setMode] = useState<"new" | "existing">(plan?.sourceMode ?? (plan?.opening || !plan && !row ? "existing" : "new"));
  const [sources, setSources] = useState(plan ? planSources(plan) : row ? [{ transactionId: row.id, fingerprint: row.fingerprint }] : []);
  const [reference, setReference] = useState(plan?.reference ?? "");
  const [amount, setAmount] = useState(minorToMajorText(plan ? plan.amountMinor : row ? -row.amountMinor : null, 2));
  const [start, setStart] = useState(plan?.startDate ?? row?.date ?? bankToday(card.bankTimeZone));
  const [recording, setRecording] = useState<"tracking" | "instalments" | "retained">(plan?.recording ?? (plan?.tracking ? "tracking" : "instalments"));
  const [balanceOnly, setBalanceOnly] = useState(plan?.balanceOnly ?? (!row && !plan));
  const [trackingId, setTrackingId] = useState(plan?.tracking?.accountId ?? "");
  const [tag, setTag] = useState(plan?.tracking?.tag ?? "");
  const [openingDate, setOpeningDate] = useState(plan?.opening?.date ?? "");
  const [openingPrincipal, setOpeningPrincipal] = useState(minorToMajorText(plan?.opening?.principalMinor ?? null, 2));
  const [arrangement, setArrangement] = useState<RepaymentPlan["arrangement"]>(plan?.arrangement ?? "fixed");
  const [months, setMonths] = useState(String(plan?.months ?? 6));
  const [monthly, setMonthly] = useState(minorToMajorText(plan?.monthlyMinor ?? (row ? Math.floor(-row.amountMinor / 6) : null), 2));
  const [firstDue, setFirstDue] = useState(plan?.firstDueDate ?? addMonths(start, 1, card.dueRule?.kind === "day-of-month" ? card.dueRule.day : 2));
  const [apr, setApr] = useState(minorToMajorText(plan?.aprBps ?? 0, 2));
  const [upfront, setUpfront] = useState(minorToMajorText(plan?.upfrontFeeMinor ?? 0, 2));
  const [fee, setFee] = useState(minorToMajorText(plan?.monthlyFeeMinor ?? 0, 2));
  const [includesCosts, setIncludesCosts] = useState(plan?.includesCosts ?? true);
  const [minimumPercent, setMinimumPercent] = useState(minorToMajorText(plan?.minimumPercentBps ?? card.minimumPercentBps ?? 500, 2));
  const [minimumFloor, setMinimumFloor] = useState(minorToMajorText(plan?.minimumFloorMinor ?? card.minimumFloorMinor ?? 10000, 2));
  const [expiry, setExpiry] = useState(plan?.expiryDate ?? "");
  const [conditions, setConditions] = useState(plan?.conditions ?? "");
  const [status, setStatus] = useState<RepaymentPlan["status"]>(plan?.status ?? "active");
  const [settledDate, setSettledDate] = useState(plan?.settledDate ?? "");
  const [refundReview, setRefundReview] = useState(plan?.refundReview);
  const [refundDirty, setRefundDirty] = useState(false);
  const [links, setLinks] = useState<PlanLink[]>(workspace.planLinks?.filter((link) => link.planId === plan?.id) ?? []);
  const [error, setError] = useState("");
  const parsed = (() => {
    try {
      const opening = openingDate || openingPrincipal ? { date: openingDate, principalMinor: minor(openingPrincipal) } : undefined;
      return { value: repaymentPlanSchema.parse({ id: initial.id, revision: initial.revision, cardId: card.id, sourceTransactions: sources, sourceMode: mode, reference, recording, balanceOnly, arrangement, amountMinor: minor(amount, mode === "existing"), startDate: start, firstDueDate: balanceOnly ? null : firstDue || null, months: balanceOnly ? null : Number(months), monthlyMinor: balanceOnly ? null : minor(monthly, true), aprBps: minor(apr), upfrontFeeMinor: minor(upfront), monthlyFeeMinor: minor(fee), includesCosts, minimumPercentBps: minor(minimumPercent, true), minimumFloorMinor: minor(minimumFloor, true), expiryDate: expiry || null, afterAprBps: plan?.afterAprBps ?? null, conditions, status, settledDate: status === "active" ? undefined : settledDate || undefined, opening: mode === "existing" ? opening : undefined, tracking: recording === "tracking" && trackingId ? { accountId: trackingId, tag } : undefined, refundReview: links.some((link) => link.role === "refund") ? refundReview : undefined }), error: "" };
    } catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : "Review the plan details" }; }
  })();
  const value = parsed.value;
  const projection = value ? planProjection(value, card) : null;
  const progress = value ? planProgress(value, card, links) : null;
  const signature = JSON.stringify({ sources, mode, reference, amount, start, recording, balanceOnly, trackingId, tag, openingDate, openingPrincipal, arrangement, months, monthly, firstDue, apr, upfront, fee, includesCosts, minimumPercent, minimumFloor, expiry, conditions, status, settledDate, refundReview, links });
  const [initialSignature] = useState(signature);
  const { requestClose, discardDialog } = useDiscardChanges(signature !== initialSignature || refundDirty, onClose);
  const candidates = snapshot.rows.filter((entry) => entry.amountMinor < 0 && !financingCostKind(entry, card, workspace) && (!planForTransaction(workspace, entry.id) || planForTransaction(workspace, entry.id)?.id === plan?.id));
  function chooseSource(entry: ActivityRow, checked: boolean) {
    const next = checked ? [...sources.filter((source) => source.transactionId !== entry.id), { transactionId: entry.id, fingerprint: entry.fingerprint }] : sources.filter((source) => source.transactionId !== entry.id);
    setSources(next);
    if (next.length) setAmount(minorToMajorText(sumMinor(next.map((source) => -(snapshot.rows.find((entry) => entry.id === source.transactionId)?.amountMinor ?? 0))), 2));
  }
  function save() {
    try {
      if (!available) throw new Error("Refresh Actual activity before saving");
      if (!value) throw new Error(parsed.error);
      if (refundDirty) throw new Error("Confirm the changed refund treatment before saving");
      if (recording === "tracking" && !trackingId) throw new Error("Choose the off-budget plan account");
      creditCardStore.getState().savePlan(budget, card.id, expectedCardRevision, snapshot, value, links);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the plan"); }
  }
  const field = (label: string, element: React.ReactNode) => <div className="space-y-1"><Label className="text-xs leading-4 text-muted-foreground" htmlFor={`${prefix}-${label}`}>{label}</Label>{element}</div>;
  const input = (label: string, text: string, update: (value: string) => void) => field(label, <Input id={`${prefix}-${label}`} value={text} onChange={(event) => update(event.target.value)} />);
  const date = (label: string, text: string, update: (value: string) => void) => field(label, <DateInput id={`${prefix}-${label}`} value={text} onValueChange={update} dateFormat={CARD_DATE_FORMAT} />);
  return <><Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}><DialogContent className="flex h-[min(850px,92dvh)] flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-[min(1200px,96vw)]">
    <DialogHeader className="border-b p-5"><DialogTitle>{plan ? "Edit repayment plan" : "Add repayment plan"}</DialogTitle><DialogDescription>Link existing Actual transactions and describe your plan. No transaction or additional debt is created.</DialogDescription></DialogHeader>
    <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="min-h-0 flex-1 overflow-hidden"><TabsList className="px-5"><TabsTrigger value="terms">Plan details</TabsTrigger><TabsTrigger value="transactions">Transactions ({links.length})</TabsTrigger></TabsList>
      <TabsContent value="terms" keepMounted className="overflow-auto"><div className="grid lg:grid-cols-[3fr_2fr]"><div className="space-y-3 p-4">
        <fieldset className="space-y-3 rounded-lg border p-3"><legend className="px-1 text-xs font-semibold">Start tracking</legend><div className="flex gap-2">{(["new", "existing"] as const).map((item) => <Button key={item} variant="outline" aria-pressed={mode === item} className={mode === item ? "ring-1 ring-foreground" : ""} onClick={() => setMode(item)}>{item === "new" ? "Start a new plan" : "Track an existing plan"}</Button>)}</div>
          {input("Plan name / reference", reference, setReference)}<div className="grid grid-cols-2 gap-3">{input(mode === "existing" ? "Original amount (if known)" : "Original / converted amount", amount, setAmount)}{date("Plan start date", start, setStart)}</div>
          {mode === "existing" && <><p className="text-xs text-muted-foreground">Enter the principal remaining at the end of your tracking start date. Earlier transactions are not required. Leave the original amount blank if unknown. A schedule entered without it describes the remaining term.</p><div className="grid grid-cols-2 gap-3">{date("Start tracking from", openingDate, (value) => { if (!plan && !sources.length && (start === openingDate || start === bankToday(card.bankTimeZone))) setStart(value); setOpeningDate(value); })}{input("Remaining principal at start", openingPrincipal, setOpeningPrincipal)}</div></>}
          <details open={sources.length > 0 || undefined}><summary className="cursor-pointer text-xs font-medium text-muted-foreground">Original transactions (optional)</summary><p className="my-2 text-xs text-muted-foreground">Choose the original purchases, or leave empty when tracking from a balance.</p>
          <div className="max-h-36 space-y-2 overflow-auto" role="group" aria-label="Original transactions">{candidates.map((entry) => <label key={entry.id} className="flex items-start gap-2 text-xs"><Checkbox checked={sources.some((source) => source.transactionId === entry.id)} onCheckedChange={(checked) => chooseSource(entry, checked)} /><span>{formatCardDate(entry.date)} · {entry.label} · {formatAmount(entry.amountMinor, 2)}</span></label>)}</div>
        </details>
          {sources.some((source) => !snapshot.rows.some((entry) => entry.id === source.transactionId && entry.fingerprint === source.fingerprint)) && <div className="text-xs"><p>Check the original source: it changed or is unavailable.</p><Button size="xs" variant="outline" onClick={() => setSources(sources.flatMap((source) => { const current = snapshot.rows.find((entry) => entry.id === source.transactionId); return current ? [{ transactionId: current.id, fingerprint: current.fingerprint }] : []; }))}>Use current original transactions</Button></div>}
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border p-3"><legend className="px-1 text-xs font-semibold">Debt tracking</legend>{field("How the plan is recorded", <Select id={`${prefix}-How the plan is recorded`} value={recording} onValueChange={(next) => setRecording(next as typeof recording)} options={[{ value: "tracking", label: "Transfers through a plan account" }, { value: "instalments", label: "Instalment charges on the card" }, { value: "retained", label: "Full balance stays on the card" }]} />)}
          {recording === "tracking" && <>{field("Repayment-plan account", <Select id={`${prefix}-Repayment-plan account`} value={trackingId} onValueChange={setTrackingId} options={[{ value: "", label: "Choose off-budget account" }, ...(snapshot.accounts?.filter((entry) => entry.offBudget && !entry.closed) ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />)}{input("Plan hashtag (optional)", tag, setTag)}<p className="text-xs text-muted-foreground">Tags improve suggestions. Without tags, assign conversion, principal and adjustment entries in Transactions. Only principal moves through this account; fees and interest remain expenses.</p></>}
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border p-3"><legend className="px-1 text-xs font-semibold">Payment expectations</legend><label className="flex items-center gap-2 text-sm"><Checkbox checked={balanceOnly} onCheckedChange={setBalanceOnly} />Track balance only - no schedule required</label>
          {!balanceOnly && <><div role="group" aria-label="Repayment arrangement" className="flex gap-2">{(["fixed", "minimum-deadline", "promotional"] as const).map((item) => <Button key={item} variant="outline" aria-pressed={arrangement === item} className={arrangement === item ? "ring-1 ring-foreground" : ""} onClick={() => setArrangement(item)}>{item === "fixed" ? "Fixed instalments" : item === "minimum-deadline" ? "Minimum + deadline" : "Other terms"}</Button>)}</div><div className="grid grid-cols-2 gap-3">{date("First instalment due", firstDue, setFirstDue)}{input("Number of instalments", months, setMonths)}{input("Monthly instalment", monthly, setMonthly)}{input("Interest rate % per year", apr, setApr)}{input("Upfront fee", upfront, setUpfront)}{input("Monthly plan fee", fee, setFee)}</div>
          {arrangement === "fixed" && <fieldset className="rounded-lg border p-3"><legend className="px-1 text-xs">Does the monthly amount include interest and fees?</legend><div className="flex gap-2">{[[true, "Yes, included"], [false, "No, billed separately"]].map(([flag, text]) => <Button key={String(flag)} size="sm" variant="outline" aria-pressed={includesCosts === flag} className={includesCosts === flag ? "ring-1 ring-foreground" : ""} onClick={() => setIncludesCosts(flag as boolean)}>{text}</Button>)}</div></fieldset>}
          {arrangement === "minimum-deadline" && <div className="grid grid-cols-2 gap-3">{input("Monthly minimum %", minimumPercent, setMinimumPercent)}{input("Monthly minimum floor", minimumFloor, setMinimumFloor)}</div>}
          {!["fixed", "minimum-deadline"].includes(arrangement) && <>{date("Expiry date", expiry, setExpiry)}{input("Conditions", conditions, setConditions)}</>}</>}
        </fieldset>
        {field("Plan status", <Select id={`${prefix}-Plan status`} value={status} onValueChange={(next) => setStatus(next as typeof status)} options={[{ value: "active", label: "Active" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }]} />)}
        {value && <PlanRefundReview plan={value} card={card} links={links} snapshot={snapshot} review={refundReview} onDraftChange={setRefundDirty} onConfirm={(review) => { setRefundDirty(false); setRefundReview(review); if (review.treatment === "cancelled") setStatus("cancelled"); }} />}
        {status !== "active" && <>{date("Bank-confirmed plan end (optional)", settledDate, setSettledDate)}<p className="text-xs text-muted-foreground">Changing status does not repay or erase recorded debt. Enter an end date only if the bank has confirmed the plan terms ended.</p></>}
      </div><aside className="space-y-4 border-l bg-muted/20 p-5"><h3 className="text-sm font-semibold">Expected schedule</h3>{projection?.calculated && value ? <><dl className="space-y-2 text-xs">{[...(!progress?.revised ? [["Principal", projection.principalMinor], ["Estimated / included finance cost", projection.interestMinor], ["Upfront fee", projection.upfrontFeeMinor], ["Monthly fees", projection.monthlyFeesMinor]] : []), ["Expected total", progress?.totalMinor ?? projection.totalMinor]].map(([label, amount]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd>{formatAmount(amount as number, 2)}</dd></div>)}</dl><p className="text-xs text-muted-foreground">{progress?.revised ? "Revised totals supplied by the bank. Principal, interest and fee components are not specified." : projection.reason}</p>{!progress?.revised && projection.warning && <p className="text-xs text-amber-700">{projection.warning} Expectations do not block linking actual postings.</p>}<table className="w-full text-left text-xs"><thead><tr><th>#</th><th>Due</th><th>Expected</th><th>Evidence</th></tr></thead><tbody>{planSchedule(value, card, links).map((entry) => <tr key={entry.index} className="border-t"><td className="py-2">{entry.index}</td><td>{formatCardDate(entry.date)}</td><td>{formatAmount(entry.amountMinor, 2)}</td><td>{value.opening && entry.date <= value.opening.date ? "Earlier history" : links.some((link) => ["instalment-billed", "combined-instalment"].includes(link.role) && link.instalment === entry.index) ? "Billed" : "Expected"}</td></tr>)}</tbody></table></> : <p className="text-xs text-muted-foreground">{projection?.reason ?? "Enter the amount and dates to preview expectations."}</p>}<p className="text-xs text-muted-foreground">Expectations never create payments, fees or debt. Actual postings determine what was billed; billing does not mean paid.</p><Button size="sm" variant="outline" onClick={() => setTab("transactions")}>Manage linked transactions ({links.length})</Button></aside></div></TabsContent>
      <TabsContent value="transactions" className="overflow-auto"><PlanTransactions available={available} plan={value} planId={initial.id} card={card} workspace={workspace} snapshot={snapshot} links={links} onChange={(next) => { setLinks(next); if (!next.some((link) => link.role === "refund")) setRefundDirty(false); }} focusId={focusTransactionId} onClassified={() => setExpectedCardRevision(creditCardStore.getState().workspaces[budget]?.cards.find((entry) => entry.id === card.id)?.revision ?? expectedCardRevision)} budget={budget} /></TabsContent>
    </Tabs><div className="flex items-center justify-between gap-3 border-t p-4"><p className="text-xs text-muted-foreground">Actual transactions remain unchanged.</p><div className="flex gap-2"><Button variant="outline" onClick={requestClose}>Cancel</Button><Button disabled={!available} onClick={save}>Save plan</Button></div></div>{error && <p role="alert" className="px-5 pb-4 text-xs text-destructive">{error}</p>}
  </DialogContent></Dialog>{discardDialog}</>;
}
