"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { formatAmount, minorToMajorText, parseMajorToMinor } from "@/features/assets-debt/lib/money";
import type { ActivitySnapshot } from "../lib/activity";
import type { Card, PlanLink, RepaymentPlan } from "../lib/models";
import { planProjection, refundEvidenceSignature } from "../lib/plans";
import { sumMinor } from "../lib/statements";
import { CARD_DATE_FORMAT } from "../lib/displayDates";

export function PlanRefundReview({ plan, card, links, snapshot, review, onDraftChange, onConfirm }: { plan: RepaymentPlan; card: Card; links: PlanLink[]; snapshot: ActivitySnapshot; review: RepaymentPlan["refundReview"]; onDraftChange: (dirty: boolean) => void; onConfirm: (review: NonNullable<RepaymentPlan["refundReview"]>) => void }) {
  const [treatment, setTreatment] = useState<NonNullable<RepaymentPlan["refundReview"]>["treatment"]>(review?.treatment ?? "unchanged");
  const projection = planProjection(plan, card);
  const unbilled = projection.rows.filter((entry) => !links.some((link) => ["instalment-billed", "combined-instalment"].includes(link.role) && link.instalment === entry.index));
  const [draft, setDraft] = useState<Record<number, { date: string; amount: string }>>({});
  const [error, setError] = useState("");
  const refunds = links.filter((link) => link.role === "refund");
  if (!refunds.length) return null;
  const amount = sumMinor(refunds.flatMap((link) => { const row = snapshot.rows.find((entry) => entry.id === link.transactionId && entry.fingerprint === link.fingerprint); return row ? [row.amountMinor] : []; }));
  const confirmed = review?.signature === refundEvidenceSignature(links);
  function confirm() {
    try {
      if (treatment === "revised" && !projection.calculated) throw new Error("Use fixed instalments or minimum/deadline terms to revise an expected schedule.");
      const remaining = treatment === "revised" ? unbilled.map((entry) => {
        const current = draft[entry.index];
        const previous = review?.remaining.find((row) => row.index === entry.index);
        const parsed = parseMajorToMinor(current?.amount ?? minorToMajorText(previous?.amountMinor ?? entry.amountMinor, 2), 2);
        if (!parsed.ok || parsed.value === null || parsed.value < 0) throw new Error("Enter a valid total for each remaining instalment.");
        return { index: entry.index, date: current?.date ?? previous?.date ?? entry.date, amountMinor: parsed.value };
      }) : [];
      if (treatment === "revised" && !unbilled.length) throw new Error("All instalments are billed. Record the refund as a card credit or confirm cancellation.");
      onConfirm({ treatment, signature: refundEvidenceSignature(links), remaining }); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Review the refund treatment"); }
  }
  return <fieldset className="space-y-3 rounded-lg border border-chart-5/30 bg-chart-5/5 p-3"><legend className="px-1 text-sm font-medium">Does the bank keep, change or close the plan?</legend><p className="text-xs">{formatAmount(amount, 2)} refund received. {confirmed ? "Treatment recorded; update it if the issuer changes the schedule." : "The existing schedule stays in place unless you change it."}</p><p className="text-xs text-muted-foreground">The refund already reduces the card balance. This decision only records the issuer’s treatment and future expectations.</p><Select aria-label="Refund treatment" value={treatment} onValueChange={(value) => { setTreatment(value as typeof treatment); onDraftChange(true); }} options={[{ value: "unchanged", label: "Card credit; instalment schedule unchanged" }, { value: "revised", label: "Issuer revised the remaining schedule" }, { value: "cancelled", label: "Issuer cancelled the plan" }]} />{treatment === "revised" && <div className="space-y-2"><p className="text-xs text-muted-foreground">Enter issuer-confirmed totals including fees for unbilled instalments. Already billed entries stay unchanged.</p>{unbilled.map((entry) => { const previous = review?.remaining.find((row) => row.index === entry.index); const current = draft[entry.index] ?? { date: previous?.date ?? entry.date, amount: minorToMajorText(previous?.amountMinor ?? entry.amountMinor, 2) }; return <div key={entry.index} className="grid grid-cols-[2rem_1fr_1fr] items-center gap-2 text-xs"><span>#{entry.index}</span><DateInput aria-label={`Revised date for instalment ${entry.index}`} value={current.date} dateFormat={CARD_DATE_FORMAT} onValueChange={(date) => { setDraft({ ...draft, [entry.index]: { ...current, date } }); onDraftChange(true); }} /><Input aria-label={`Revised total for instalment ${entry.index}`} value={current.amount} inputMode="decimal" onChange={(event) => { setDraft({ ...draft, [entry.index]: { ...current, amount: event.target.value } }); onDraftChange(true); }} /></div>; })}</div>}{treatment === "cancelled" && <p className="text-xs">Confirming sets this plan to Cancelled. Actual postings and billed history are retained.</p>}<Button variant="outline" size="xs" onClick={confirm}>Confirm refund treatment</Button>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<p className="text-xs text-muted-foreground">Confirmation applies when you save the plan.</p></fieldset>;
}
