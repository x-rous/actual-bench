"use client";
import { useId, useMemo, useRef, useState } from "react";
import { Link2, ShieldCheck, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { z } from "zod";
import { useDiscardChanges } from "../hooks/useDiscardChanges";
import { generateId } from "@/lib/uuid";
import { formatAmount, minorToMajorText, parseMajorToMinor } from "@/features/assets-debt/lib/money";
import { addMonths, parseIsoDate } from "@/lib/financial-models/calendar/dates";
import { CARD_DATE_FORMAT, formatCardDate } from "../lib/displayDates";
import { cycleDates } from "../lib/cycles";
import { creditCardStore } from "../lib/memory";
import { repaymentPlanSchema, type Card, type PlanLink, type RepaymentPlan, type Workspace } from "../lib/models";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import { sumMinor } from "../lib/statements";
import { arrangementLabels, planProjection, roleLabels } from "../lib/plans";
import { Status } from "./WorkspaceVisuals";

function minor(value: string, optional = false) { const result = parseMajorToMinor(value, 2); if (!result.ok || (!optional && result.value === null)) throw new Error(result.ok ? "Enter required amounts" : result.message); return result.value; }
function suggestedFirstDue(card: Card, date: string) { const day = card.closingDay ?? parseIsoDate(date).day; const close = addMonths(date, 0, day); return cycleDates(card, close >= date ? close : addMonths(close, 1, day)).dueDate; }
export function PlanEditor({ budget, card, row, plan, workspace, snapshot, available, onClose }: { budget: string; card: Card; row: ActivityRow; plan?: RepaymentPlan; workspace: Workspace; snapshot: ActivitySnapshot; available: boolean; onClose: () => void }) {
  const prefix = useId();
  const root = useRef<HTMLDivElement>(null);
  const [acceptFinal, setAcceptFinal] = useState(false);
  const [initial] = useState(() => ({ cardRevision: creditCardStore.getState().workspaces[budget]?.cards.find((entry) => entry.id === card.id)?.revision ?? card.revision, planId: plan?.id ?? generateId(), planRevision: plan?.revision ?? 1, fingerprint: plan?.fingerprint ?? row.fingerprint }));
  const [sourceAccepted, setSourceAccepted] = useState(!plan || plan.fingerprint === row.fingerprint);
  const [arrangement, setArrangement] = useState<RepaymentPlan["arrangement"]>(plan?.arrangement ?? "fixed");
  const [status, setStatus] = useState<RepaymentPlan["status"]>(plan?.status ?? "active");
  const [amount, setAmount] = useState(minorToMajorText(plan?.amountMinor ?? -row.amountMinor, 2));
  const [start, setStart] = useState(plan?.startDate ?? row.date);
  const [firstDue, setFirstDue] = useState(plan?.firstDueDate ?? suggestedFirstDue(card, row.date));
  const [months, setMonths] = useState(String(plan?.months ?? 6));
  const [monthly, setMonthly] = useState(minorToMajorText(plan?.monthlyMinor ?? Math.floor(-row.amountMinor / 6), 2));
  const [apr, setApr] = useState(minorToMajorText(plan?.aprBps ?? 0, 2));
  const [upfront, setUpfront] = useState(minorToMajorText(plan?.upfrontFeeMinor ?? 0, 2));
  const [fee, setFee] = useState(minorToMajorText(plan?.monthlyFeeMinor ?? 0, 2));
  const [includesCosts, setIncludesCosts] = useState(plan?.includesCosts ?? true);
  const [minimumPercent, setMinimumPercent] = useState(minorToMajorText(plan?.minimumPercentBps ?? card.minimumPercentBps ?? 500, 2));
  const [minimumFloor, setMinimumFloor] = useState(minorToMajorText(plan?.minimumFloorMinor ?? card.minimumFloorMinor ?? 10000, 2));
  const [expiry, setExpiry] = useState(plan?.expiryDate ?? "");
  const [afterApr, setAfterApr] = useState(minorToMajorText(plan?.afterAprBps ?? null, 2));
  const [conditions, setConditions] = useState(plan?.conditions ?? "");
  const [links, setLinks] = useState<PlanLink[]>(workspace.planLinks?.filter((entry) => entry.planId === plan?.id) ?? []);
  const [linking, setLinking] = useState(false);
  const [postingId, setPostingId] = useState("");
  const [role, setRole] = useState<PlanLink["role"]>("instalment-billed");
  const [instalment, setInstalment] = useState("1");
  const [error, setError] = useState("");
  const parsed = useMemo(() => { try { return { error: "", value: repaymentPlanSchema.parse({ id: initial.planId, cardId: card.id, transactionId: row.id, fingerprint: sourceAccepted ? row.fingerprint : initial.fingerprint, revision: initial.planRevision, arrangement, status, amountMinor: minor(amount), startDate: start, firstDueDate: firstDue, months: Number(months), monthlyMinor: minor(monthly, true), aprBps: minor(apr), upfrontFeeMinor: minor(upfront), monthlyFeeMinor: minor(fee), includesCosts, minimumPercentBps: minor(minimumPercent, true), minimumFloorMinor: minor(minimumFloor, true), expiryDate: expiry || null, afterAprBps: minor(afterApr, true), conditions }) }; } catch (cause) { return { value: null, error: cause instanceof z.ZodError ? cause.issues.map((issue) => `${issue.path.join(" ")}: ${issue.message}`).join(". ") : cause instanceof Error ? cause.message : "Review the terms" }; } }, [initial, sourceAccepted, card.id, row.id, row.fingerprint, arrangement, status, amount, start, firstDue, months, monthly, apr, upfront, fee, includesCosts, minimumPercent, minimumFloor, expiry, afterApr, conditions]);
  const value = parsed.value;
  const signature = JSON.stringify({ value, amount, start, firstDue, months, monthly, apr, upfront, fee, includesCosts, minimumPercent, minimumFloor, expiry, afterApr, conditions, links, status });
  const [initialSignature] = useState(signature);
  const { requestClose, discardDialog } = useDiscardChanges(signature !== initialSignature, onClose);
  const projection = useMemo(() => value ? planProjection(value, card) : null, [value, card]);
  const candidates = snapshot.rows.filter((entry) => (["conversion-credit", "refund"].includes(role) ? entry.amountMinor > 0 : entry.amountMinor < 0) && entry.date >= start && entry.id !== row.id && !entry.transferId && !links.some((link) => link.transactionId === entry.id) && !workspace.plans?.some((entryPlan) => entryPlan.transactionId === entry.id) && !workspace.planLinks?.some((link) => link.planId !== initial.planId && link.transactionId === entry.id));
  const observed = sumMinor(links.flatMap((link) => { const posting = snapshot.rows.find((entry) => entry.id === link.transactionId && entry.fingerprint === link.fingerprint); return posting && ["instalment-billed", "plan-fee"].includes(link.role) ? [-posting.amountMinor] : []; }));
  function save() {
    try {
      if (root.current?.querySelector('[aria-invalid="true"]')) throw new Error("Correct the invalid date before saving");
      if (!available) throw new Error("Refresh Actual activity before saving this plan");
      if (!sourceAccepted) throw new Error("Review and accept the changed original transaction before saving");
      if (!value) throw new Error(parsed.error);
      if (["fixed", "minimum-deadline"].includes(value.arrangement) && !projection?.calculated) throw new Error(projection?.reason ?? "Review the calculation");
      if (projection?.calculated && projection.unusualFinal && !acceptFinal) throw new Error("Confirm the different final amount or correct the repayment terms");
      creditCardStore.getState().savePlan(budget, card.id, initial.cardRevision, snapshot, value, links);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save plan"); }
  }
  const field = (label: string, control: React.ReactNode) => <div className="space-y-1.5"><Label htmlFor={`${prefix}-${label}`}>{label}</Label>{control}</div>;
  const input = (label: string, text: string, change: (value: string) => void, type = "text") => field(label, <Input id={`${prefix}-${label}`} value={text} type={type} inputMode={type === "text" && label !== "Conditions" ? "decimal" : undefined} onChange={(event) => change(event.target.value)} />);
  const date = (label: string, text: string, change: (value: string) => void) => field(label, <DateInput id={`${prefix}-${label}`} value={text} onValueChange={change} dateFormat={CARD_DATE_FORMAT} />);
  return <><Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}><DialogContent ref={root} className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-5xl">
    <DialogHeader className="border-b p-5"><DialogTitle>{plan ? "Edit repayment plan" : "Add instalment plan"}</DialogTitle><DialogDescription>Describes how this debt is repaid. It doesn’t add debt or create transactions in Actual.</DialogDescription></DialogHeader>
    <div className="grid min-h-0 overflow-auto lg:grid-cols-[3fr_2fr]">
      <div className="space-y-5 p-5"><div className="rounded-xl border p-3"><p className="font-medium">{row.label}</p><p className="text-xs text-muted-foreground">{formatCardDate(row.date)} · {card.nickname}</p><p className="mt-1 font-semibold tabular-nums text-destructive">{formatAmount(row.amountMinor, 2)}</p></div>
        {plan && plan.fingerprint !== row.fingerprint && <div className="rounded-xl border border-chart-5/30 bg-chart-5/5 p-3 text-xs"><p>The original Actual transaction changed. Review its current amount and classification before accepting this evidence.</p><Button variant="outline" size="xs" className="mt-2" aria-pressed={sourceAccepted} onClick={() => setSourceAccepted(true)}>{sourceAccepted ? "Current source accepted" : "Accept current source"}</Button></div>}
        <div><Label>Arrangement</Label><div role="group" aria-label="Repayment arrangement" className="mt-2 flex rounded-lg bg-muted p-1">{(["fixed", "minimum-deadline", "other"] as const).map((choice) => <Button key={choice} className="flex-1" size="sm" variant={choice === arrangement || (choice === "other" && !["fixed", "minimum-deadline"].includes(arrangement)) ? "secondary" : "ghost"} aria-pressed={choice === arrangement || choice === "other" && !["fixed", "minimum-deadline"].includes(arrangement)} onClick={() => setArrangement(choice === "other" ? "promotional" : choice)}>{choice === "other" ? "Other terms" : arrangementLabels[choice]}</Button>)}</div></div>
        <div className="grid gap-4 sm:grid-cols-2">{input("Amount converted", amount, setAmount)}{date("Plan start date", start, setStart)}{date("First instalment due", firstDue, setFirstDue)}{input("Number of instalments", months, setMonths, "number")}</div>
        {arrangement === "fixed" && input("Monthly instalment", monthly, setMonthly)}
        {arrangement === "minimum-deadline" && <><div className="grid gap-4 sm:grid-cols-2">{input("Monthly minimum %", minimumPercent, setMinimumPercent)}{input("Monthly minimum floor", minimumFloor, setMinimumFloor)}</div><p className="text-xs text-muted-foreground">The final instalment clears the expected remainder. This is a plan estimate, not the card’s bank-confirmed minimum.</p></>}
        {["fixed", "minimum-deadline"].includes(arrangement) ? <><div className="grid gap-4 sm:grid-cols-2">{input("Interest rate % per year", apr, setApr)}{input("Upfront fee", upfront, setUpfront)}{input("Monthly plan fee", fee, setFee)}</div>{arrangement === "fixed" && <fieldset className="rounded-xl border bg-muted/20 p-3"><legend className="px-1 text-sm">Does the monthly amount already include interest and fees?</legend><div className="flex flex-wrap gap-2">{[[true, "Yes, included"], [false, "No, billed separately"]].map(([flag, label]) => <Button key={String(flag)} variant={includesCosts === flag ? "secondary" : "outline"} size="sm" className={includesCosts === flag ? "ring-1 ring-foreground" : undefined} aria-pressed={includesCosts === flag} onClick={() => setIncludesCosts(flag as boolean)}>{label}</Button>)}</div><p className="mt-2 text-xs text-muted-foreground">Upfront fee is separate on the first due date. Prevents adding monthly costs twice.</p></fieldset>}{arrangement === "minimum-deadline" && <p className="text-xs text-muted-foreground">Plan fees are separate from this minimum estimate.</p>}</> : <><Status tone="attention">Not calculated</Status><div className="grid gap-4 sm:grid-cols-2">{field("Recorded arrangement", <Select id={`${prefix}-Recorded arrangement`} value={arrangement} onValueChange={(next) => setArrangement(next as RepaymentPlan["arrangement"])} options={["promotional", "deferred", "revolving"].map((item) => ({ value: item, label: arrangementLabels[item as keyof typeof arrangementLabels] }))} />)}{input("Interest rate % per year", apr, setApr)}{date("Expiry date", expiry, setExpiry)}{input("Rate after expiry %", afterApr, setAfterApr)}</div>{input("Conditions", conditions, setConditions)}<p className="text-xs text-muted-foreground">Recorded only. Bench does not calculate promotional, deferred or revolving arrangements.</p></>}
        {plan && field("Plan status", <Select id={`${prefix}-Plan status`} value={status} onValueChange={(next) => setStatus(next as RepaymentPlan["status"])} options={["active", "completed", "cancelled"].map((item) => ({ value: item, label: item[0].toUpperCase() + item.slice(1) }))} />)}
        {status !== "active" && <p className="text-xs text-muted-foreground">Saving confirms this plan is {status}. No Actual transaction or payment is created.</p>}
      </div>
      <aside className="space-y-5 border-t bg-muted/20 p-5 lg:border-t-0 lg:border-l"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cost of this plan</h3>{projection?.calculated ? <><dl className="space-y-2 text-sm">{[["Principal", projection.principalMinor], [value?.arrangement === "fixed" && value.includesCosts ? "Included finance cost" : "Interest (estimated)", projection.interestMinor], ["Upfront fee", projection.upfrontFeeMinor], ["Monthly fees", projection.monthlyFeesMinor], ["Expected total", projection.totalMinor]].map(([label, amount]) => <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="font-medium tabular-nums">{formatAmount(amount as number, 2)}</dd></div>)}</dl><p className="text-xs text-muted-foreground">{projection.reason}</p>{projection.warning && <div className="rounded-xl border border-amber-400/40 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200"><p>{projection.warning}</p>{projection.unusualFinal && <label className="mt-2 flex items-center gap-2"><Checkbox checked={acceptFinal} onCheckedChange={setAcceptFinal} />I confirm the final amount {formatAmount(projection.rows.at(-1)?.amountMinor ?? 0, 2)}</label>}</div>}<div className="flex justify-between"><h3 className="text-sm font-medium">Expected schedule</h3><span className="rounded-full border border-dashed px-2 text-xs">Expected</span></div><div className="max-h-64 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>#</th><th>Due</th><th>Amount</th><th>Evidence</th></tr></thead><tbody>{projection.rows.map((entry) => { const billed = links.find((link) => link.role === "instalment-billed" && link.instalment === entry.index); const actual = snapshot.rows.find((posting) => posting.id === billed?.transactionId && posting.fingerprint === billed.fingerprint); return <tr key={entry.index} className="border-t"><td className="py-2">{entry.index}</td><td>{formatCardDate(entry.date)}</td><td className="tabular-nums">{formatAmount(actual ? -actual.amountMinor : entry.amountMinor, 2)}</td><td><span className={`rounded-full border px-2 py-0.5 ${actual ? "" : "border-dashed"}`}>{actual ? "Billed" : entry.final ? "Expected · final" : "Expected"}</span></td></tr>; })}</tbody></table></div></> : <p className="text-sm text-muted-foreground">{projection?.reason ?? "Enter valid terms to preview the schedule."}</p>}
        <p className="text-xs text-muted-foreground">Expected instalments never count as payments. Billed entries come only from linked Actual postings.</p>
        <div className="flex items-center justify-between"><h3 className="text-sm font-medium">Linked Actual entries</h3><Button variant="outline" size="xs" onClick={() => setLinking(!linking)}><Link2 className="size-3" />Link entry</Button></div>
        {linking && <div className="space-y-2 rounded-xl border p-3"><Select aria-label="Actual posting" value={postingId} onValueChange={setPostingId} options={[{ value: "", label: "Choose Actual entry" }, ...candidates.map((entry) => ({ value: entry.id, label: `${formatCardDate(entry.date)} · ${entry.label} · ${formatAmount(entry.amountMinor, 2)}` }))]} /><Select aria-label="Plan posting role" value={role} onValueChange={(next) => { setRole(next as PlanLink["role"]); setPostingId(""); }} options={Object.entries(roleLabels).map(([value, label]) => ({ value, label }))} />{role === "instalment-billed" && <Input aria-label="Instalment number" type="number" min={1} max={Number(months)} value={instalment} onChange={(event) => setInstalment(event.target.value)} />}<Button size="xs" disabled={!postingId} onClick={() => { const posting = candidates.find((entry) => entry.id === postingId)!; setLinks([...links, { planId: initial.planId, transactionId: posting.id, fingerprint: posting.fingerprint, role, instalment: role === "instalment-billed" ? Number(instalment) : null }]); setPostingId(""); setLinking(false); }}>Stage link</Button></div>}
        {!links.length && <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">Link conversion credits, instalments billed and plan fees. Each entry belongs to one plan.</p>}
        {links.map((link) => <div key={link.transactionId} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-xs"><span>{roleLabels[link.role]} · {snapshot.rows.find((entry) => entry.id === link.transactionId)?.label ?? "Source unavailable"}</span><Button size="icon-xs" variant="ghost" aria-label={`Unlink ${link.transactionId}`} onClick={() => setLinks(links.filter((entry) => entry.transactionId !== link.transactionId))}><Trash2 className="size-3" /></Button></div>)}
        {links.length > 0 && <p className="text-xs">Actual billed charges and fees: <strong>{formatAmount(observed, 2)}</strong>. These are observed postings, separate from the expected cost; never added together.</p>}
      </aside>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/10 p-4"><p className="max-w-xl text-xs text-muted-foreground"><ShieldCheck className="mr-1 inline size-3" />The original charge is already in Actual. This plan adds no debt.</p>{error && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}<div className="ml-auto flex gap-2"><Button variant="outline" onClick={requestClose}>Cancel</Button><Button disabled={!available} onClick={save}>Save plan</Button></div></div>
  </DialogContent></Dialog>{discardDialog}</>;
}
