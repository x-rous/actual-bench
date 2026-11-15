"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceCards } from "@/components/ui/choice-cards";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Snapshot } from "@/lib/cashflow-planning/actuals";
import { buildPlanFromActuals } from "@/lib/cashflow-planning/builder";
import { NAME_MAX, createPlanDocument } from "@/lib/cashflow-planning/document";
import { addMonths, lengthLabel, monthsBetween } from "@/lib/cashflow-planning/months";
import { MAX_MONTHS, MIN_MONTHS, type Month, type PlanDocument } from "@/lib/cashflow-planning/types";
import { MonthField } from "./fields";

type Template = "groups" | "categories" | "blank" | "worksheet";

/** A new plan: built from what Actual already holds (the quick way in), or empty. Creating it saves it. */
export function NewPlanDialog({ snapshot, today, existingNames, busy, loansPending = false, onCreate, onClose }: { snapshot: Snapshot | null; today: string; existingNames: readonly string[]; busy: boolean; /** Loan schedules are still being read: a plan built now would miss them. */ loansPending?: boolean; onCreate: (doc: PlanDocument) => void; onClose: () => void }) {
  const year = today.slice(0, 4);
  const [name, setName] = useState(existingNames.length === 0 ? "My cash plan" : `Cash plan ${existingNames.length + 1}`);
  const [start, setStart] = useState<Month>(`${year}-01`);
  // Five years unless the last month is chosen; it follows the first month until then.
  const [last, setLast] = useState<Month>(addMonths(`${year}-01`, 59));
  const [lastChosen, setLastChosen] = useState(false);
  const [template, setTemplate] = useState<Template>(snapshot ? "groups" : "blank");
  const [cards, setCards] = useState<"cash" | "outside">("cash");
  const cardAccounts = (snapshot?.accounts ?? []).filter((a) => a.accountClass === "credit-card" && !a.excluded && !a.closed);
  const monthCount = monthsBetween(start, last) + 1;
  const lengthValid = monthCount >= MIN_MONTHS && monthCount <= MAX_MONTHS;
  const valid = name.trim().length > 0 && lengthValid;
  const hasHistory = !!snapshot && snapshot.movement.length > 0;

  const create = () => {
    if (!valid) return;
    if ((template === "groups" || template === "categories") && snapshot) onCreate(buildPlanFromActuals(snapshot, { name, startMonth: start, months: monthCount, detail: template, cards }));
    else {
      const doc = createPlanDocument({ name, startMonth: start, months: monthCount, useActuals: template !== "worksheet" });
      onCreate(template === "blank" && cards === "outside" ? { ...doc, accountRoles: Object.fromEntries(cardAccounts.map((a) => [a.id, "outside" as const])) } : doc);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New cash plan</DialogTitle>
          <DialogDescription>A plan is a month-by-month view of your cash, years ahead. It is saved in Actual Bench and never changes anything in Actual.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 space-y-1.5"><Label htmlFor="cf-new-name">Name</Label><Input id="cf-new-name" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="cf-new-start">First month</Label><MonthField id="cf-new-start" className="h-8 w-28" value={start} onCommit={(m) => { if (!m) return; setStart(m); if (!lastChosen) setLast(addMonths(m, 59)); }} /></div>
            <div className="space-y-1.5"><Label htmlFor="cf-new-last">Last month</Label><MonthField id="cf-new-last" className="h-8 w-28" value={last} onCommit={(m) => { if (m) { setLast(m); setLastChosen(true); } }} /></div>
          </div>
          <p role={lengthValid ? undefined : "alert"} className={lengthValid ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{lengthValid ? `${lengthLabel(monthCount)}.` : `A plan covers ${MIN_MONTHS} months to ${MAX_MONTHS / 12} years: the last month must be ${MIN_MONTHS - 1} to ${MAX_MONTHS - 1} months after the first.`}</p>
          <ChoiceCards<Template>
            legend="Start from" name="cf-new-template" columns={2} value={template} onChange={setTemplate}
            options={[
              { value: "groups", title: "My Actual data, by category group", detail: "A row for each income category, expense group, savings account and loan that moved your cash in the last 12 months, each forecast from its own history. The quickest start.", disabled: !hasHistory, reason: hasHistory ? undefined : "Needs transactions in Actual" },
              { value: "categories", title: "My Actual data, by category", detail: "The same, with a row for every expense category, grouped as in Actual. More rows, more control.", disabled: !hasHistory, reason: hasHistory ? undefined : "Needs transactions in Actual" },
              { value: "blank", title: "Empty plan", detail: "No rows yet. Past months and balances still come from Actual; you add the rows you want to plan." },
              { value: "worksheet", title: "Plain worksheet", detail: "Not connected to Actual: every month is typed, starting from an opening balance you enter." },
            ]}
          />
          {cardAccounts.length > 0 && template !== "worksheet" && (
            <ChoiceCards<"cash" | "outside">
              legend={`Credit cards (${cardAccounts.length})`} name="cf-new-cards" columns={2} value={cards} onChange={setCards}
              options={[
                { value: "cash", title: "Count card spending when it happens", detail: "Cards are part of the plan's cash: a purchase lowers the balance in the month it is made, and paying the card moves nothing. Category rows show everything you spent." },
                { value: "outside", title: "Count card payments only", detail: "Cards are outside the plan: only what you pay to them counts, in the month you pay, each card on its own row. Category rows then show only what was paid straight from the bank, so do not forecast them from Actual's budget." },
              ]}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={create} disabled={!valid || busy || (loansPending && (template === "groups" || template === "categories"))}>{busy ? "Creating…" : loansPending && (template === "groups" || template === "categories") ? "Reading loan schedules…" : "Create plan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
