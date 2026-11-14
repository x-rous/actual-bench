"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateId } from "@/lib/uuid";
import { accountClassLabel } from "@/lib/account-class";
import { accountRole, defaultAccountRole, type Snapshot } from "@/lib/cashflow-planning/actuals";
import { MAX_GOALS, NAME_MAX, countOutside, planEndMonth, setHorizon } from "@/lib/cashflow-planning/document";
import { addMonths } from "@/lib/cashflow-planning/months";
import { MAX_YEARS, MIN_YEARS, type Goal, type Month, type PlanAccountRole, type PlanDocument } from "@/lib/cashflow-planning/types";
import { AmountField, MonthField, PercentField, TextField } from "./fields";

const ROLE_LABEL: Record<PlanAccountRole, string> = { cash: "Cash", savings: "Savings", outside: "Outside the plan" };

/**
 * The plan's own settings. Every change is applied to the plan straight away and saved with it, like an edit in the grid
 * (and can be undone the same way), except the first month and length, which can drop typed amounts and so ask first.
 */
export function PlanSettingsDialog({ doc, snapshot, onEdit, onClose }: { doc: PlanDocument; snapshot: Snapshot | null; onEdit: (change: (doc: PlanDocument) => PlanDocument) => void; onClose: () => void }) {
  const [start, setStart] = useState<Month>(doc.startMonth);
  const [years, setYears] = useState(String(doc.years));
  const [showClosed, setShowClosed] = useState(false);
  const yearCount = Number(years);
  const yearsValid = Number.isInteger(yearCount) && yearCount >= MIN_YEARS && yearCount <= MAX_YEARS;
  const horizonChanged = start !== doc.startMonth || (yearsValid && yearCount !== doc.years);
  const dropped = yearsValid ? countOutside(doc, start, yearCount) : 0;
  const droppedGoals = yearsValid ? doc.goals.filter((g) => g.month < start || g.month > planEndMonth({ startMonth: start, years: yearCount })).length : 0;
  const accounts = (snapshot?.accounts ?? []).filter((a) => showClosed || !a.closed || doc.accountRoles[a.id]);
  const setGoal = (id: string, change: Partial<Goal>) => onEdit((d) => ({ ...d, goals: d.goals.map((g) => (g.id === id ? { ...g, ...change } : g)) }));
  const end = planEndMonth(doc);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[78vh] max-h-[78vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 gap-1 border-b border-border px-5 py-3">
          <DialogTitle>Plan settings</DialogTitle>
          <DialogDescription>Changes apply to this plan as you make them and are saved with it. Nothing here changes Actual.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="general" className="flex min-h-0 flex-1 flex-col">
          <TabsList aria-label="Plan settings" className="shrink-0 px-4">
            <TabsTrigger value="general">General</TabsTrigger>
            {doc.useActuals && snapshot && <TabsTrigger value="accounts">Accounts</TabsTrigger>}
            <TabsTrigger value="goals">Goals{doc.goals.length ? ` (${doc.goals.length})` : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 text-sm">
            <div className="space-y-1.5"><Label htmlFor="cf-plan-name">Name</Label><TextField id="cf-plan-name" value={doc.name} maxLength={NAME_MAX} onCommit={(name) => onEdit((d) => ({ ...d, name }))} className="max-w-sm" /></div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Months covered</legend>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5"><Label htmlFor="cf-plan-start" className="text-xs text-muted-foreground">First month</Label><MonthField id="cf-plan-start" className="w-28" value={start} onCommit={(m) => { if (m) setStart(m); }} /></div>
                <div className="space-y-1.5"><Label htmlFor="cf-plan-years" className="text-xs text-muted-foreground">Years ({MIN_YEARS} to {MAX_YEARS})</Label><Input id="cf-plan-years" size="sm" inputMode="numeric" className="w-20 text-right tabular-nums" aria-invalid={!yearsValid || undefined} value={years} onChange={(e) => setYears(e.target.value)} /></div>
                <Button size="sm" disabled={!horizonChanged || !yearsValid} onClick={() => onEdit((d) => ({ ...setHorizon(d, start, yearCount), goals: d.goals.filter((g) => g.month >= start && g.month <= planEndMonth({ startMonth: start, years: yearCount })) }))}>Apply</Button>
                <p className="pb-1.5 text-xs text-muted-foreground">Now {doc.startMonth} to {end}.</p>
              </div>
              {horizonChanged && yearsValid && (dropped > 0 || droppedGoals > 0) && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">Applying removes {dropped} typed {dropped === 1 ? "amount" : "amounts"}{droppedGoals ? ` and ${droppedGoals} ${droppedGoals === 1 ? "goal" : "goals"}` : ""} that fall outside the new months. Undo brings them back.</p>}
              <p className="text-xs text-muted-foreground">Starting a year or two back shows how past months really went next to the forecast.</p>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Actual data</legend>
              <label className="flex items-center gap-2 text-sm"><Switch checked={doc.useActuals} onCheckedChange={(useActuals) => onEdit((d) => ({ ...d, useActuals }))} />Use Actual for past months and balances</label>
              <p className="text-xs text-muted-foreground">On: past months show what Actual recorded, the forecast starts from today&apos;s real balance, and rows can follow history, the budget, schedules and loans. Off: a plain worksheet where every month is typed, starting from the opening cash below.</p>
              {!doc.useActuals && <div className="flex items-center gap-2"><Label htmlFor="cf-plan-opening" className="text-xs">Opening cash</Label><AmountField id="cf-plan-opening" className="w-36" value={doc.openingBalance} onCommit={(amount) => onEdit((d) => ({ ...d, openingBalance: amount ?? 0 }))} /></div>}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Safety level and savings</legend>
              <div className="flex items-center gap-2"><Label htmlFor="cf-plan-minimum" className="w-56 text-xs">Minimum cash to keep (emergency fund)</Label><AmountField id="cf-plan-minimum" className="w-36" allowEmpty placeholder="None" value={doc.minimumCash} onCommit={(minimumCash) => onEdit((d) => ({ ...d, minimumCash }))} /></div>
              <p className="text-xs text-muted-foreground">Months whose closing balance falls below it are marked, and the first one is named at the top.</p>
              <div className="flex items-center gap-2"><Label htmlFor="cf-plan-growth" className="w-56 text-xs">Expected yearly growth of savings, in percent</Label><PercentField id="cf-plan-growth" className="w-20" value={doc.savingsGrowthPct} onCommit={(savingsGrowthPct) => onEdit((d) => ({ ...d, savingsGrowthPct }))} /></div>
              <p className="text-xs text-muted-foreground">Only used for the savings estimate under the grid. Leave it at 0 to count contributions only.</p>
            </fieldset>
          </TabsContent>

          {doc.useActuals && snapshot && (
            <TabsContent value="accounts" className="min-h-0 flex-1 overflow-y-auto text-xs">
              <p className="px-5 pt-4 pb-3 text-muted-foreground">
                <strong className="font-medium text-foreground">Cash</strong> is what the plan balances and forecasts: bank accounts, cash and, by default, credit cards (so a card purchase counts when it is made and paying the card moves nothing).{" "}
                <strong className="font-medium text-foreground">Savings</strong> is tracked beside it. Transfers to anything else show as money leaving. The automatic choice follows each account&apos;s class, set on the <Link href="/accounts" className="underline underline-offset-2">Accounts</Link> page.
              </p>
              <table className="w-full border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] text-muted-foreground">
                  <tr><th scope="col" className="h-8 border-y border-border px-5 font-medium">Account</th><th scope="col" className="h-8 border-y border-border px-3 font-medium">Class</th><th scope="col" className="h-8 border-y border-border px-3 font-medium">Budget</th><th scope="col" className="h-8 w-56 border-y border-border px-3 font-medium">Counts as</th></tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td className="h-9 max-w-[260px] truncate border-b border-border/40 px-5" title={a.name}>{a.name}{a.closed && <span className="ml-1.5 text-muted-foreground">closed</span>}</td>
                      <td className="border-b border-border/40 px-3 text-muted-foreground">{a.accountClass ? accountClassLabel(a.accountClass) : "No class"}</td>
                      <td className="border-b border-border/40 px-3 text-muted-foreground">{a.offBudget ? "Off budget" : "On budget"}</td>
                      <td className="border-b border-border/40 px-3">
                        <Select
                          size="sm" className="w-full" value={doc.accountRoles[a.id] ?? "auto"} title={`How ${a.name} counts in this plan`}
                          onValueChange={(v) => onEdit((d) => { const accountRoles = { ...d.accountRoles }; if (v === "auto") delete accountRoles[a.id]; else accountRoles[a.id] = v as PlanAccountRole; return { ...d, accountRoles }; })}
                          options={[{ value: "auto", label: `Automatic (${ROLE_LABEL[defaultAccountRole(a)]})` }, { value: "cash", label: ROLE_LABEL.cash }, { value: "savings", label: ROLE_LABEL.savings }, { value: "outside", label: ROLE_LABEL.outside }]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between px-5 py-3 text-muted-foreground">
                <span>{snapshot.accounts.filter((a) => accountRole(doc, a) === "cash").length} cash, {snapshot.accounts.filter((a) => accountRole(doc, a) === "savings").length} savings</span>
                {snapshot.accounts.some((a) => a.closed) && <label className="flex items-center gap-2"><Switch checked={showClosed} onCheckedChange={setShowClosed} />Show closed accounts</label>}
              </div>
            </TabsContent>
          )}

          <TabsContent value="goals" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5 text-xs">
            <p className="text-muted-foreground">A balance to reach by a month: a house deposit, a year of living costs before a move. The plan shows whether the forecast gets there and how much more a month it would take.</p>
            {doc.goals.length > 0 && (
              <table className="w-full border-separate border-spacing-0">
                <thead className="text-left text-[11px] text-muted-foreground"><tr><th scope="col" className="pb-1 font-medium">Goal</th><th scope="col" className="pb-1 pl-2 font-medium">Measured on</th><th scope="col" className="pb-1 pl-2 font-medium">By</th><th scope="col" className="pb-1 pl-2 text-right font-medium">Amount</th><th className="w-8"><span className="sr-only">Remove</span></th></tr></thead>
                <tbody>
                  {doc.goals.map((goal) => (
                    <tr key={goal.id}>
                      <td className="py-1"><TextField aria-label="Goal name" value={goal.name} maxLength={NAME_MAX} onCommit={(name) => setGoal(goal.id, { name })} /></td>
                      <td className="py-1 pl-2"><Select size="sm" className="w-40" value={goal.basis} onValueChange={(v) => setGoal(goal.id, { basis: v as Goal["basis"] })} options={[{ value: "cash", label: "Cash" }, { value: "total", label: "Cash + savings" }]} /></td>
                      <td className="py-1 pl-2"><MonthField aria-label="Month to reach it by" className="w-24" min={doc.startMonth} max={end} value={goal.month} onCommit={(m) => { if (m) setGoal(goal.id, { month: m }); }} /></td>
                      <td className="py-1 pl-2"><AmountField aria-label="Amount to reach" className="w-32" value={goal.amount} onCommit={(amount) => { if (amount !== null) setGoal(goal.id, { amount }); }} /></td>
                      <td className="py-1 pl-1"><Button size="icon-xs" variant="ghost" aria-label={`Remove ${goal.name}`} onClick={() => onEdit((d) => ({ ...d, goals: d.goals.filter((g) => g.id !== goal.id) }))}><Trash2 className="size-3" aria-hidden /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Button size="xs" variant="outline" disabled={doc.goals.length >= MAX_GOALS} onClick={() => onEdit((d) => ({ ...d, goals: [...d.goals, { id: generateId(), name: "New goal", month: addMonths(d.startMonth, d.years * 12 - 1), amount: 0, basis: "cash" }] }))}><Plus className="size-3" aria-hidden />Add a goal</Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
