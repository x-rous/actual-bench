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
import { MAX_YEARS, MIN_YEARS, type Month, type PlanDocument } from "@/lib/cashflow-planning/types";
import { MonthField } from "./fields";

type Template = "groups" | "categories" | "blank" | "worksheet";

/** A new plan: built from what Actual already holds (the quick way in), or empty. Creating it saves it. */
export function NewPlanDialog({ snapshot, today, existingNames, busy, loansPending = false, onCreate, onClose }: { snapshot: Snapshot | null; today: string; existingNames: readonly string[]; busy: boolean; /** Loan schedules are still being read: a plan built now would miss them. */ loansPending?: boolean; onCreate: (doc: PlanDocument) => void; onClose: () => void }) {
  const year = today.slice(0, 4);
  const [name, setName] = useState(existingNames.length === 0 ? "My cash plan" : `Cash plan ${existingNames.length + 1}`);
  const [start, setStart] = useState<Month>(`${year}-01`);
  const [years, setYears] = useState("5");
  const [template, setTemplate] = useState<Template>(snapshot ? "groups" : "blank");
  const yearCount = Number(years);
  const valid = name.trim().length > 0 && Number.isInteger(yearCount) && yearCount >= MIN_YEARS && yearCount <= MAX_YEARS;
  const hasHistory = !!snapshot && snapshot.movement.length > 0;

  const create = () => {
    if (!valid) return;
    if ((template === "groups" || template === "categories") && snapshot) onCreate(buildPlanFromActuals(snapshot, { name, startMonth: start, years: yearCount, detail: template }));
    else onCreate(createPlanDocument({ name, startMonth: start, years: yearCount, useActuals: template !== "worksheet" }));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New cash plan</DialogTitle>
          <DialogDescription>A plan is a month-by-month view of your cash, years ahead. It is saved in Actual Bench and never changes anything in Actual.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 space-y-1.5"><Label htmlFor="cf-new-name">Name</Label><Input id="cf-new-name" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="cf-new-start">First month</Label><MonthField id="cf-new-start" className="h-8 w-28" value={start} onCommit={(m) => { if (m) setStart(m); }} /></div>
            <div className="space-y-1.5"><Label htmlFor="cf-new-years">Years</Label><Input id="cf-new-years" inputMode="numeric" className="w-20 text-right tabular-nums" value={years} aria-invalid={!(Number.isInteger(yearCount) && yearCount >= MIN_YEARS && yearCount <= MAX_YEARS) || undefined} onChange={(e) => setYears(e.target.value)} /></div>
          </div>
          <ChoiceCards<Template>
            legend="Start from" name="cf-new-template" columns={2} value={template} onChange={setTemplate}
            options={[
              { value: "groups", title: "My Actual data, by category group", detail: "A row for each income category, expense group, savings account and loan that moved your cash in the last 12 months, each forecast from its own history. The quickest start.", disabled: !hasHistory, reason: hasHistory ? undefined : "Needs transactions in Actual" },
              { value: "categories", title: "My Actual data, by category", detail: "The same, with a row for every expense category, grouped as in Actual. More rows, more control.", disabled: !hasHistory, reason: hasHistory ? undefined : "Needs transactions in Actual" },
              { value: "blank", title: "Empty plan", detail: "No rows yet. Past months and balances still come from Actual; you add the rows you want to plan." },
              { value: "worksheet", title: "Plain worksheet", detail: "Not connected to Actual: every month is typed, starting from an opening balance you enter." },
            ]}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={create} disabled={!valid || busy || (loansPending && (template === "groups" || template === "categories"))}>{busy ? "Creating…" : loansPending && (template === "groups" || template === "categories") ? "Reading loan schedules…" : "Create plan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
