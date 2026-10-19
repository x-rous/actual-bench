"use client";
import { useId, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Check, Circle } from "lucide-react";
import { generateId } from "@/lib/uuid";
import { formatAmount, minorToMajorText, parseMajorToMinor } from "@/features/assets-debt/lib/money";
import { addMonths } from "@/lib/financial-models/calendar/dates";
import { CARD_DATE_FORMAT, formatCardDate } from "../lib/displayDates";
import { bankToday } from "../lib/cycles";
import { formatPercentBps, parsePercentBps } from "../lib/percent";
import { creditCardStore } from "../lib/store/store";
import { planSchema, type Card, type PlanEntry, type RepaymentPlan, type Workspace } from "../lib/models";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import { planEntryFor, planProgress, planProjection } from "../lib/plans";
import type { PlanCandidate } from "../lib/derive/planDiscovery";
import { GuideLink } from "./guide/CreditCardGuide";
import { useDiscardChanges } from "../hooks/useDiscardChanges";
import { cn } from "@/lib/utils";

function minor(value: string, optional = false) {
  const parsed = parseMajorToMinor(value.replaceAll(",", ""), 2);
  if (!parsed.ok || (!optional && parsed.value === null)) throw new Error(parsed.ok ? "Enter the required amounts" : parsed.message);
  return parsed.value;
}

const whole = (value: string) => (value.trim() ? Number(value) : null);

type Props = {
  budget: string;
  card: Card;
  row?: ActivityRow;
  /** A plan found in a plan account: the editor opens filled in from it. */
  candidate?: PlanCandidate;
  plan?: RepaymentPlan;
  workspace: Workspace;
  snapshot: ActivitySnapshot;
  available: boolean;
  onClose: () => void;
};

/**
 * Create or edit a plan (§8.2, §8.3, §9.10) in a two-column dialog: settings on the left, what Bench
 * sees on the right. From a transaction, from a balance, or already running. Linking happens in the
 * plan view, not here; plan-account rows are owned by account or tag and need no links (D4).
 * Choosing a plan account registers it (the full list is in card Settings › Instalment plans).
 */
export function PlanEditor({ budget, card, row, plan, candidate, workspace, snapshot, available, onClose }: Props) {
  const prefix = useId();
  const [initial] = useState(() => ({ id: plan?.id ?? generateId(), revision: plan?.revision ?? null }));
  const [name, setName] = useState(plan?.name ?? candidate?.name ?? row?.label ?? "");
  const [recordedAs, setRecordedAs] = useState<RepaymentPlan["recordedAs"]>(plan?.recordedAs ?? "plan-account");
  const [accountId, setAccountId] = useState(plan?.planAccountId ?? candidate?.accountId ?? "");
  const [shared, setShared] = useState(Boolean(plan?.planAccountTag ?? candidate?.tag));
  const [tag, setTag] = useState(plan?.planAccountTag ?? candidate?.tag ?? "");
  const [amount, setAmount] = useState(minorToMajorText(plan ? plan.originalAmountMinor
    : candidate ? candidate.originalMinor || null : row ? -row.amountMinor : null, 2));
  const [start, setStart] = useState(plan ? plan.startDate ?? "" : candidate ? candidate.startDate ?? "" : row?.date ?? bankToday(card.bankTimeZone));
  const [openingDate, setOpeningDate] = useState(plan?.opening?.date ?? "");
  const [openingPrincipal, setOpeningPrincipal] = useState(minorToMajorText(plan?.opening?.principalMinor ?? null, 2));
  const [scheduleKind, setScheduleKind] = useState<RepaymentPlan["scheduleKind"]>(plan ? plan.scheduleKind : row ? "fixed" : null);
  const [months, setMonths] = useState(String(plan?.instalmentCount ?? (row ? 6 : "")));
  const [monthly, setMonthly] = useState(minorToMajorText(plan?.instalmentMinor ?? (row ? Math.floor(-row.amountMinor / 6) : null), 2));
  const dueDay = card.dueRule?.kind === "day-of-month" ? card.dueRule.value : 3;
  const [firstDue, setFirstDue] = useState(plan?.firstDueDate ?? (start ? addMonths(start, 1, dueDay) : ""));
  const [apr, setApr] = useState(formatPercentBps(plan?.aprBps ?? 0));
  const [upfront, setUpfront] = useState(minorToMajorText(plan?.upfrontFeeMinor ?? 0, 2));
  const [fee, setFee] = useState(minorToMajorText(plan?.monthlyFeeMinor ?? 0, 2));
  const [includesCosts, setIncludesCosts] = useState(plan?.includesCosts ?? true);
  const [minimumPercent, setMinimumPercent] = useState(formatPercentBps(plan?.minimumPercentBps ?? card.minimumPercentBps ?? 500));
  const [minimumFloor, setMinimumFloor] = useState(minorToMajorText(plan?.minimumFloorMinor ?? card.minimumFloorMinor ?? 10_000, 2));
  const [expiry, setExpiry] = useState(plan?.expiryDate ?? "");
  const [note, setNote] = useState(plan?.note ?? "");
  // A found plan whose principal is all back on the card is saved as finished on its last movement.
  const [status, setStatus] = useState<RepaymentPlan["status"]>(plan?.status ?? (candidate?.finished ? "completed" : "active"));
  const [endedOn, setEndedOn] = useState(plan?.endedOn ?? (candidate?.finished ? candidate.lastDate : ""));
  const [entries] = useState<PlanEntry[]>(() => {
    const saved = workspace.planEntries.filter((entry) => entry.planId === plan?.id);
    if (saved.length || !row) return saved;
    return [planEntryFor(initial.id, row, "original")];
  });
  const [error, setError] = useState("");
  const scheduled = scheduleKind === "fixed" || scheduleKind === "minimum-deadline";
  const needsOpening = recordedAs !== "plan-account" || shared;

  const parsed = (() => {
    try {
      const principal = openingPrincipal.trim() ? minor(openingPrincipal) : null;
      const value = planSchema.parse({
        id: initial.id,
        cardId: card.id,
        revision: initial.revision ?? 1,
        name,
        recordedAs,
        planAccountId: recordedAs === "plan-account" ? accountId || null : null,
        planAccountTag: recordedAs === "plan-account" && shared ? tag || null : null,
        status,
        endedOn: status === "active" ? null : endedOn || null,
        originalAmountMinor: minor(amount, true),
        startDate: start || null,
        opening: needsOpening && openingDate && principal !== null ? { date: openingDate, principalMinor: principal } : null,
        scheduleKind,
        firstDueDate: scheduled ? firstDue || null : null,
        instalmentCount: scheduled ? whole(months) : null,
        instalmentMinor: scheduleKind === "fixed" ? minor(monthly, true) : null,
        aprBps: parsePercentBps(apr) ?? 0,
        upfrontFeeMinor: minor(upfront, true) ?? 0,
        monthlyFeeMinor: minor(fee, true) ?? 0,
        includesCosts,
        minimumPercentBps: scheduleKind === "minimum-deadline" ? parsePercentBps(minimumPercent) : null,
        minimumFloorMinor: scheduleKind === "minimum-deadline" ? minor(minimumFloor, true) : null,
        expiryDate: scheduleKind === "promotional" ? expiry || null : null,
        note,
      });
      return { value, error: "" };
    } catch (cause) {
      const message = cause instanceof Error && "issues" in cause
        ? (cause as { issues: { message: string }[] }).issues.map((issue) => issue.message).join(". ")
        : cause instanceof Error ? cause.message : "Review the plan details";
      return { value: null, error: message };
    }
  })();
  const value = parsed.value;
  const projection = value ? planProjection(value, card) : null;
  const progress = value ? planProgress(value, card, workspace, snapshot) : null;
  const signature = JSON.stringify({
    name, recordedAs, accountId, shared, tag, amount, start, openingDate, openingPrincipal, scheduleKind, months, monthly, firstDue,
    apr, upfront, fee, includesCosts, minimumPercent, minimumFloor, expiry, note, status, endedOn, entries,
  });
  const [initialSignature] = useState(signature);
  const { requestClose, discardDialog } = useDiscardChanges(signature !== initialSignature, onClose);
  const originals = entries.filter((entry) => entry.role === "original");
  const accounts = (snapshot.accounts ?? []).filter((entry) => entry.offBudget && !entry.closed);

  async function save() {
    try {
      if (!available) throw new Error("Refresh Actual activity before saving");
      if (!value) throw new Error(parsed.error);
      await creditCardStore.getState().savePlan(budget, initial.revision, snapshot, value, entries);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the plan");
    }
  }

  const field = (label: string, element: ReactNode) => <div className="space-y-1">
    <Label className="text-xs leading-4 text-muted-foreground" htmlFor={`${prefix}-${label}`}>{label}</Label>
    {element}
  </div>;
  const input = (label: string, text: string, update: (value: string) => void) => field(label,
    <Input id={`${prefix}-${label}`} value={text} onChange={(event) => update(event.target.value)} />);
  const date = (label: string, text: string, update: (value: string) => void) => field(label,
    <DateInput id={`${prefix}-${label}`} value={text} onValueChange={update} dateFormat={CARD_DATE_FORMAT} />);
  // Segmented choice, styled like the chart range toggle; the selected option's meaning shows underneath.
  const choice = <T extends string | null>(label: string, current: T, options: [T, string, string][], update: (value: T) => void) => <div className="space-y-1.5">
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap overflow-hidden rounded-md border text-xs">
      {options.map(([option, text]) => <button
        key={String(option)}
        type="button"
        role="radio"
        aria-checked={current === option}
        onClick={() => update(option)}
        className={cn("h-7 px-2.5 font-medium", current === option ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
      >{text}</button>)}
    </div>
    <p className="text-xs text-muted-foreground">{options.find(([option]) => option === current)?.[2]}</p>
  </div>;
  const section = (title: string, children: ReactNode, aside?: ReactNode) => <section aria-label={title} className="space-y-3 border-b px-5 py-4 last:border-b-0">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      {aside}
    </div>
    {children}
  </section>;
  const accountLabel = accounts.find((entry) => entry.id === accountId)?.name;
  const trackedAs = recordedAs === "plan-account"
    ? `${accountLabel ? `In ${accountLabel}` : "In a plan account (choose one)"}${shared ? `, by the tag ${tag || "(enter a tag)"}` : ", the whole account"}`
    : recordedAs === "card-instalments" ? "Instalments billed on the card" : "Part of the card balance";
  // What the schedule still needs, for the empty state.
  // The plan account (and its tag when shared) are needed before Bench can estimate anything.
  const placement: [string, boolean][] = recordedAs === "plan-account"
    ? [["Plan account", Boolean(accountId)], ...(shared ? [["Plan tag", Boolean(tag.trim())] as [string, boolean]] : [])]
    : [];
  const schedule: [string, boolean][] = scheduleKind === "fixed" ? [
    ["Original amount", Boolean(amount.trim())], ["First instalment due", Boolean(firstDue)],
    ["Number of instalments", Boolean(months.trim())], ["Monthly instalment", Boolean(monthly.trim())],
  ] : scheduleKind === "minimum-deadline" ? [
    ["Original amount", Boolean(amount.trim())], ["First instalment due", Boolean(firstDue)],
    ["Number of instalments", Boolean(months.trim())], ["Monthly minimum % or floor", Boolean(minimumPercent.trim() || minimumFloor.trim())],
  ] : [];
  const missing = schedule.length ? [...placement, ...schedule] : [];
  return <>
    <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent className="flex h-[90dvh] w-[min(1040px,95vw)] flex-col gap-0 p-0 sm:max-w-[1040px]">
        <div className="border-b px-5 py-4 pr-12">
          <DialogTitle>{plan ? `Edit instalment plan ${plan.name}` : "Add instalment plan"}</DialogTitle>
          <DialogDescription>Describe the plan and where its principal is. Bench never creates a transaction or extra debt.</DialogDescription>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-h-0 overflow-y-auto">
          {section("Plan details", <>
            <div className="grid grid-cols-2 gap-3">
              {input("Plan name", name, setName)}
              {field("Plan status", <Select
                id={`${prefix}-Plan status`}
                value={status}
                onValueChange={(next) => setStatus(next as typeof status)}
                options={[{ value: "active", label: "Active" }, { value: "completed", label: "Finished" }, { value: "cancelled", label: "Cancelled" }]}
              />)}
              {input("Original amount (if known)", amount, setAmount)}
              {date("Plan start date", start, setStart)}
              {status !== "active" && date("Plan end (optional)", endedOn, setEndedOn)}
            </div>
            {status !== "active" && <p className="text-xs text-muted-foreground">Changing the status never repays or removes recorded debt.</p>}
            {originals.length > 0 && <p className="text-xs text-muted-foreground">
              Made from {originals.map((item) => {
                const source = snapshot.rows.find((entry) => entry.id === item.transactionId);
                return source ? `${formatCardDate(source.date)} · ${source.label} · ${formatAmount(source.amountMinor, 2)}` : "an unavailable transaction";
              }).join(", ")}. Link more transactions in the plan view.
            </p>}
          </>)}
          {section("Where the principal is", <>
            {choice("Where the principal is", recordedAs, [
              ["plan-account", "Plan account in Actual", "The principal moves to an off-budget account in Actual and comes back with each instalment."],
              ["card-instalments", "Bank bills instalments", "The bank converts the purchase and bills one instalment on each statement."],
              ["card-balance", "Stays in card balance", "Actual shows only the purchase; Bench estimates what is left from the terms."],
            ], setRecordedAs)}
            {recordedAs === "plan-account" && <>
              {field("Plan account", <Select
                id={`${prefix}-Plan account`}
                value={accountId}
                onValueChange={setAccountId}
                options={[{ value: "", label: "Choose an off-budget account" }, ...accounts.map((entry) => ({ value: entry.id, label: entry.name }))]}
              />)}
              <div className="flex items-center gap-2">
                <Checkbox id={`${prefix}-shared`} checked={shared} onCheckedChange={setShared} />
                <Label htmlFor={`${prefix}-shared`} className="text-xs">Shared with other plans</Label>
              </div>
              {shared && input("Plan tag (in the transfer notes)", tag, setTag)}
              {shared && candidate?.alternativeTags.length ? <p className="text-xs text-muted-foreground">
                These transfers also carry {candidate.alternativeTags.join(", ")}. Use whichever tag names this plan.
              </p> : null}
              <p className="text-xs text-muted-foreground">{shared
                ? "Transfers whose notes contain this exact tag belong to the plan."
                : "Everything in this account belongs to the plan; no tags or links needed."}
              {" "}Saving registers the account as a plan account; the full list is in card Settings › Instalment plans.</p>
            </>}
            {needsOpening && <>
              <p className="text-xs text-muted-foreground">Already running? Enter the principal still owed at the end of a date.</p>
              <div className="grid grid-cols-2 gap-3">
                {date("Remaining principal date", openingDate, setOpeningDate)}
                {input("Remaining principal", openingPrincipal, setOpeningPrincipal)}
              </div>
            </>}
          </>, <GuideLink section="plans">How instalment plans work</GuideLink>)}
          {section("Schedule & terms (optional)", <>
            {choice("Repayment schedule", scheduleKind, [
              [null, "Balance only", "Bench tracks the plan's balance without a schedule."],
              ["fixed", "Fixed instalments", "The same amount each month for a number of months."],
              ["minimum-deadline", "Minimum by a deadline", "A monthly minimum, with whatever is left due on the last date."],
              ["promotional", "Other terms", "Special terms that end on an expiry date; no schedule is estimated."],
            ], setScheduleKind)}
            {scheduled && <div className="grid grid-cols-2 gap-3">
              {date("First instalment due", firstDue, setFirstDue)}
              {input("Number of instalments", months, setMonths)}
              {scheduleKind === "fixed" && input("Monthly instalment", monthly, setMonthly)}
              {input("Interest rate % a year", apr, setApr)}
              {input("Upfront fee", upfront, setUpfront)}
              {input("Monthly plan fee", fee, setFee)}
            </div>}
            {scheduleKind === "fixed" && <div className="flex items-center gap-2">
              <Checkbox id={`${prefix}-includes-costs`} checked={includesCosts} onCheckedChange={setIncludesCosts} />
              <Label htmlFor={`${prefix}-includes-costs`} className="text-xs">The monthly amount includes interest and fees</Label>
            </div>}
            {scheduleKind === "minimum-deadline" && <div className="grid grid-cols-2 gap-3">
              {input("Monthly minimum %", minimumPercent, setMinimumPercent)}
              {input("Monthly minimum floor", minimumFloor, setMinimumFloor)}
            </div>}
            {scheduleKind === "promotional" && date("Expiry date", expiry, setExpiry)}
            {input("Note", note, setNote)}
          </>)}
        </div>
          <section aria-label="What Bench sees" className="min-h-0 space-y-5 overflow-y-auto border-l bg-muted/30 px-5 py-4">
            <h3 className="text-sm font-semibold">What Bench sees</h3>
            <PanelBlock title="Tracked as">
              <p className="text-sm">{trackedAs}</p>
            </PanelBlock>
            {projection?.calculated ? <>
              <PanelBlock title="Cost">
                <dl className="space-y-1 text-sm">
                  {([
                    ["Principal", projection.principalMinor],
                    ["Finance cost (estimated)", projection.interestMinor],
                    ["Upfront fee", projection.upfrontFeeMinor],
                    ["Monthly fees", projection.monthlyFeesMinor],
                  ] as const).map(([label, total]) => <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{formatAmount(total, 2)}</dd>
                  </div>)}
                  <div className="flex justify-between gap-3 border-t pt-1 font-semibold">
                    <dt>Expected total</dt><dd className="tabular-nums">{formatAmount(projection.totalMinor, 2)}</dd>
                  </div>
                </dl>
              </PanelBlock>
              <PanelBlock title="Expected schedule" aside={progress ? `${progress.billedCount} of ${progress.tracked.length} billed` : undefined}>
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Expected schedule</caption>
                  <thead className="text-muted-foreground">
                    <tr><th className="py-1 font-medium">#</th><th className="font-medium">Due</th><th className="text-right font-medium">Expected</th></tr>
                  </thead>
                  <tbody>{projection.rows.map((entry) => <tr key={entry.index} className={cn("border-t", entry.final && "font-medium")}>
                    <td className="py-1">{entry.index}</td>
                    <td>{formatCardDate(entry.date)}</td>
                    <td className="text-right tabular-nums">{formatAmount(entry.amountMinor, 2)}</td>
                  </tr>)}</tbody>
                </table>
              </PanelBlock>
              <PanelBlock title="How it is estimated">
                <p className="text-xs text-muted-foreground">{projection.reason}</p>
                {projection.warning && <p className="rounded-md border border-amber-500/40 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  {projection.warning}
                </p>}
              </PanelBlock>
            </> : <PanelBlock title="Expected schedule">
              {missing.length ? <>
                <p className="text-xs text-muted-foreground">Enter these to see the expected schedule:</p>
                <ul className="space-y-1 text-sm">{missing.map(([label, done]) => <li key={label} className="flex items-center gap-2">
                  {done ? <Check className="size-3.5 text-green-700 dark:text-green-400" aria-hidden /> : <Circle className="size-3.5 text-muted-foreground" aria-hidden />}
                  <span className={done ? "text-muted-foreground line-through" : undefined}>{label}</span>
                  <span className="sr-only">{done ? "(entered)" : "(missing)"}</span>
                </li>)}</ul>
              </> : <p className="text-xs text-muted-foreground">{projection?.reason ?? parsed.error ?? "Enter the plan details to see the expected schedule."}</p>}
            </PanelBlock>}
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Expectations never create payments, fees or debt. Link billed instalments in the plan view.
            </p>
          </section>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : <p className="text-xs text-muted-foreground">Actual stays unchanged.</p>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={requestClose}>Cancel</Button>
            <Button disabled={!available} onClick={save}>Save plan</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    {discardDialog}
  </>;
}

/** One labelled block of the "What Bench sees" panel, headed like the guide's sections. */
function PanelBlock({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return <div className="space-y-1.5">
    <div className="flex items-baseline justify-between gap-2">
      <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h4>
      {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
    </div>
    {children}
  </div>;
}
