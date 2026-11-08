"use client";

import { useState } from "react";
import { FlaskConical, Pencil, Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PillGroup } from "@/components/ui/pill-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { withSmallDecimals } from "@/features/credit-cards/components/primitives/Figure";
import { AVERAGE_MONTH_CHOICES, GOAL_MONTHS_MAX, adjustedBuffer, type BufferSettings } from "@/lib/financial-insights/bufferScenario";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { useCashBufferScenarios } from "../hooks/useCashBufferScenarios";
import { useCashBufferSettings } from "../hooks/useCashBufferSettings";
import { formatDay, money } from "../format";
import { CashBufferScenarioDialog } from "./CashBufferScenarioDialog";
import { CardTitle, InfoTip } from "./InfoTip";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;

/** Today's cash equivalents less the credit cards owed, from the same ledger and month as the buffer. Amounts are integer minor units; `cashMinor` = `grossMinor` − `cardsOwedMinor`. */
/**
 * What the months of cover are measured on, behind an (i) beside the headline so the card stays short. When some accounts are set to
 * "Accessible money", it also gives the second figure: the months if those accounts were counted too. The main figure, the goal and
 * scenarios stay cash-based.
 */
function CoverInfo({ accessible, today }: { accessible?: { months: number; accounts: { accountId: string; name: string; balanceMinor: number }[]; totalMinor: number }; today: string }) {
  return (
    <InfoTip label="the months of cover">
      <p>Months of cover are your cash &amp; bank balance, less what you owe on credit cards, divided by what you need each month.</p>
      {accessible && (
        <>
          <p className="font-medium text-foreground">With accessible investments: {accessible.months.toFixed(1)} months</p>
          <p>Counts the accounts you set to Accessible money as well, as of {formatDay(today)} (positive balances only). The main figure, your goal and scenarios do not include them.</p>
          <table className="w-full border-collapse">
            <tbody>
              {accessible.accounts.map((a) => <tr key={a.accountId} className="border-b border-border/40 last:border-0"><th scope="row" className="py-1 text-left font-normal">{a.name}</th><td className="py-1 text-right tabular-nums">{money(a.balanceMinor)}</td></tr>)}
              <tr className="font-semibold text-foreground"><th scope="row" className="pt-1.5 text-left">Total</th><td className="pt-1.5 text-right tabular-nums">{money(accessible.totalMinor)}</td></tr>
            </tbody>
          </table>
        </>
      )}
    </InfoTip>
  );
}

function CashAccountsTip({ data, today, cashMinor, grossMinor, cardsOwedMinor }: { data?: Ready; today: string; cashMinor: number; grossMinor: number; cardsOwedMinor: number }) {
  const ledger = data?.ledger;
  const cashAccounts = ledger ? [...ledger.account.values()]
    .filter((account) => ledger.role.get(account.id) === "cash")
    .map((account) => ({ id: account.id, name: account.name, closed: account.closed, balanceMinor: ledger.balanceAt(account.id, today.slice(0, 7)) })) : [];
  const accounts = cashAccounts.filter((account) => !account.closed).sort((a, b) => b.balanceMinor - a.balanceMinor || a.name.localeCompare(b.name));
  const closedBalanceMinor = cashAccounts.filter((account) => account.closed).reduce((sum, account) => sum + account.balanceMinor, 0);
  // Do not show a breakdown when it cannot explain the displayed total.
  if (!ledger || accounts.reduce((sum, account) => sum + account.balanceMinor, closedBalanceMinor) !== grossMinor) return <>{withSmallDecimals(money(cashMinor))}</>;
  return <Popover>
    <PopoverTrigger openOnHover delay={150} render={<button type="button" aria-label={`Cash & bank less card balances today ${money(cashMinor)}: see account balances`} className="cursor-help tabular-nums underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">{withSmallDecimals(money(cashMinor))}</button>} />
    <PopoverContent align="end" className="w-80 p-3 text-xs">
      <p className="mb-1.5 font-medium">Cash &amp; bank less card balances, by account</p>
      <p className="mb-2 text-muted-foreground">Balances as of {formatDay(today)}. Fixed / restricted deposits are excluded. What you owe on credit cards is taken off, because it is already committed out of this cash.</p>
      <table className="w-full border-collapse">
        <tbody>
          {accounts.map((account) => <tr key={account.id} className="border-b border-border/40"><th scope="row" className="max-w-52 py-1 text-left font-normal"><span className="block truncate" title={account.name}>{account.name}</span></th><td className="text-right tabular-nums">{money(account.balanceMinor)}</td></tr>)}
          {closedBalanceMinor !== 0 && <tr className="border-b border-border/40"><th scope="row" className="py-1 text-left font-normal">Closed account balances</th><td className="text-right tabular-nums">{money(closedBalanceMinor)}</td></tr>}
          <tr className="border-b border-border/40"><th scope="row" className="py-1 text-left font-normal">Credit cards owed</th><td className="text-right tabular-nums">{money(0 - cardsOwedMinor)}</td></tr>
          <tr className="font-semibold"><th scope="row" className="py-1.5 text-left">Cash &amp; bank less card balances</th><td className="text-right tabular-nums">{money(cashMinor)}</td></tr>
        </tbody>
      </table>
    </PopoverContent>
  </Popover>;
}

/** The average monthly spending, with the average of each category group behind it on hover or focus. */
function SpendingBreakdownTip({ groups, spendingMinor, months }: { groups: Ready["bufferSpending"]; spendingMinor: number; months: number }) {
  if (!groups || groups.groups.length === 0) return <>{money(spendingMinor)}</>;
  // Each average is rounded to a cent, so the groups can differ from the total by a cent or so each: that is rounding, not a cost.
  const rest = spendingMinor - groups.groups.reduce((a, g) => a + g.avgMinor, 0);
  return (
    <Popover>
      <PopoverTrigger openOnHover delay={150} render={<button type="button" aria-label={`Spending per month ${money(spendingMinor)}: see the average of each group`} className="cursor-help tabular-nums underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">{money(spendingMinor)}</button>} />
      <PopoverContent align="end" className="w-80 p-3 text-xs">
        <p className="mb-1.5 font-medium">Average per month, by group</p>
        <p className="mb-2 text-muted-foreground">Over the last {months} complete {months === 1 ? "month" : "months"}.</p>
        <table className="w-full border-collapse">
          <tbody>
            {groups.groups.map((g) => <tr key={g.name} className="border-b border-border/40"><th scope="row" className="max-w-52 py-1 text-left font-normal"><span className="block truncate" title={g.name}>{g.name}</span></th><td className="text-right tabular-nums">{money(g.avgMinor)}</td></tr>)}
            {rest !== 0 && <tr className="border-b border-border/40 text-muted-foreground"><th scope="row" className="py-1 text-left font-normal">{Math.abs(rest) <= groups.groups.length ? "Rounding" : "Loan interest and fees (counted in each loan’s repayment)"}</th><td className="text-right tabular-nums">{money(rest)}</td></tr>}
            <tr className="font-semibold"><th scope="row" className="py-1.5 text-left">Spending per month</th><td className="text-right tabular-nums">{money(spendingMinor)}</td></tr>
          </tbody>
        </table>
      </PopoverContent>
    </Popover>
  );
}

const GOAL_PRESETS = [3, 6, 12];

/** The goal and how a typical month is worked out: each change is saved as it is made and applies to the real buffer and every scenario. */
function BufferSettingsPopover({ settings, onChange }: { settings: BufferSettings; onChange: (next: BufferSettings) => void }) {
  const [goalText, setGoalText] = useState<string | null>(null);
  const commitGoal = () => {
    if (goalText === null) return;
    const trimmed = goalText.trim();
    const n = Number(trimmed);
    if (trimmed === "") onChange({ ...settings, goalMonths: null });
    else if (Number.isInteger(n) && n >= 1 && n <= GOAL_MONTHS_MAX) onChange({ ...settings, goalMonths: n });
    setGoalText(null);
  };
  return (
    <Popover>
      <PopoverTrigger render={<Button size="icon-sm" variant="outline" aria-label="Goal and how a typical month is worked out" title="Goal and typical month" />}><SlidersHorizontal className="size-3.5" aria-hidden /></PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-3 text-xs">
        <div>
          <p className="font-medium">Months of cover I aim for</p>
          <div className="mt-1.5 flex items-center gap-2">
            <PillGroup options={GOAL_PRESETS.map((n) => ({ value: String(n), label: String(n) }))} value={settings.goalMonths === null ? "" : String(settings.goalMonths)} onChange={(v) => onChange({ ...settings, goalMonths: Number(v) })} />
            <Input size="sm" className="w-20" inputMode="numeric" aria-label="Goal in months" placeholder="Other" value={goalText ?? (settings.goalMonths !== null && !GOAL_PRESETS.includes(settings.goalMonths) ? String(settings.goalMonths) : "")}
              onChange={(e) => setGoalText(e.target.value)} onBlur={commitGoal} onKeyDown={(e) => { if (e.key === "Enter") commitGoal(); }} />
            {settings.goalMonths !== null && <Button size="xs" variant="ghost" onClick={() => onChange({ ...settings, goalMonths: null })}>None</Button>}
          </div>
        </div>
        <div>
          <p className="font-medium">A typical month is taken over the last</p>
          <PillGroup className="mt-1.5" options={AVERAGE_MONTH_CHOICES.map((n) => ({ value: String(n), label: `${n} months` }))} value={String(settings.averageMonths)} onChange={(v) => onChange({ ...settings, averageMonths: Number(v) as BufferSettings["averageMonths"] })} />
        </div>
        <div>
          <p className="font-medium">Worked out as the</p>
          <PillGroup className="mt-1.5" options={[{ value: "average", label: "Average" }, { value: "median", label: "Median" }]} value={settings.method} onChange={(v) => onChange({ ...settings, method: v as BufferSettings["method"] })} />
          <p className="mt-1.5 text-muted-foreground">The median of each category ignores a month that was unusually high or low, so one big one-off does not move what a typical month costs.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const savedOn = (iso: string) => formatDay(iso.slice(0, 10));

/**
 * Your cash buffer: the real figure, or one of the user's own scenarios ("what if I left these out"). A scenario is always marked
 * as simulated, and the real figure is one step away.
 */
export function CashBuffer({ buffer, groups, today, data }: { buffer: Ready["buffer"]; groups: Ready["bufferSpending"]; today: string; /** The page's data: the group colours of the Spending tab, and what lists the transactions behind an amount. */ data?: Ready }) {
  const scenarios = useCashBufferScenarios();
  const { settings, save: saveSettings } = useCashBufferSettings();
  const [dialog, setDialog] = useState<"new" | "edit" | null>(null);
  const categories = groups?.categories ?? [];
  const canSimulate = buffer.state === "ready" && categories.length > 0;
  const active = canSimulate ? scenarios.active : null;
  const sim = buffer.state === "ready" && active ? adjustedBuffer(buffer.value, categories, active.adjustments) : null;

  // Every control is at the top right, in one row.
  const controls = (
    <div className="flex shrink-0 items-center gap-1.5">
      {canSimulate && scenarios.scenarios.length > 0 && (
        <Select size="sm" className="w-36" aria-label="Show the real buffer or a scenario" value={active?.id ?? "actual"} onValueChange={(v) => scenarios.select(v === "actual" ? null : v)}
          options={[{ value: "actual", label: "Actual" }, ...scenarios.scenarios.map((s) => ({ value: s.id, label: s.name }))]} />
      )}
      {canSimulate && (active
        ? <>
            <Button size="icon-sm" variant="outline" aria-label="Edit this scenario" title="Edit this scenario (or delete it)" onClick={() => setDialog("edit")}><Pencil className="size-3.5" aria-hidden /></Button>
            <Button size="icon-sm" variant="outline" aria-label="New scenario" title="New scenario" onClick={() => setDialog("new")}><Plus className="size-3.5" aria-hidden /></Button>
          </>
        : <Button size="sm" variant="outline" onClick={() => setDialog("new")}><FlaskConical className="size-3.5" aria-hidden />Simulate</Button>)}
      <BufferSettingsPopover settings={settings} onChange={saveSettings} />
    </div>
  );

  const goal = settings.goalMonths;
  // The months actually used (fewer than chosen when the budget is young), so the words are true.
  const usedMonths = buffer.state === "ready" ? buffer.value.spendingMonths : settings.averageMonths;
  const basis = `${settings.method === "median" ? "median" : "average"} of the last ${usedMonths} complete ${usedMonths === 1 ? "month" : "months"}`;
  // What the card shows: the real figure, or the scenario's.
  const shown = buffer.state === "ready" ? (sim ? (sim.state === "ready" ? sim.value : null) : buffer.value) : null;
  // The bar runs to 12 months, or further when the goal or the cover itself is beyond that.
  const scaleMax = goal === null ? 12 : Math.max(12, goal, Math.ceil(shown?.months ?? 0));
  const delta = shown && buffer.state === "ready" && sim ? shown.months - buffer.value.months : null;

  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card p-4" aria-label="Your cash buffer">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <CardTitle title="Your cash buffer" hint={`As of ${formatDay(today)}`} infoLabel="your cash buffer"
          info={<><p>It is always as of today, whatever period is selected. How many months your cash &amp; bank balance, less what you owe on credit cards, would cover at your usual spending, plus every loan repayment.</p><p>The all-in figure counts every recorded expense. Investments and fixed / restricted deposits are not counted as cash; card payments and loan interest are not counted twice. The 0–12 month scale is not a recommended target.</p><p>Simulate shows what the buffer would be if you left some spending out or changed what it costs. It is your own what-if, saved here; the real buffer is never changed.</p><p>The goal is the months of cover you aim for, and a typical month can be the average or the median of the last 3, 6 or 12 complete months: both are set with the sliders button and apply everywhere here.</p></>} />
        {active && (
          <p className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-amber-500/60 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400" role="status">
            <FlaskConical className="size-3" aria-hidden />Simulated: {active.name}
          </p>
        )}
        </div>
        </div>
        {controls}
      </div>
      {buffer.state === "ready" && sim && sim.state !== "ready" ? (
        <>
          <p className="mt-3 text-xl font-semibold">Unavailable</p>
          <p className="mt-1 text-xs text-muted-foreground">{sim.reason}. Edit the scenario, or show the actual buffer.</p>
        </>
      ) : buffer.state === "ready" && shown ? (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-56">
              <p className="flex items-baseline gap-1.5 text-4xl font-semibold leading-none tracking-tight tabular-nums">{shown.months.toFixed(1)} <span className="text-base font-normal text-muted-foreground">months of cover</span>
                <span className="self-center"><CoverInfo today={today} accessible={shown.monthsWithAccessible !== undefined && (buffer.value.accessibleMinor ?? 0) > 0 && buffer.value.accessibleAccounts ? { months: shown.monthsWithAccessible, accounts: buffer.value.accessibleAccounts, totalMinor: buffer.value.accessibleMinor ?? 0 } : undefined} /></span>
              </p>
              {delta !== null && <div className="mt-1.5 text-xs text-muted-foreground">
                {delta !== null && <p className={delta > 0 ? "text-green-700 dark:text-green-400" : delta < 0 ? "text-red-700 dark:text-red-400" : undefined}>{delta === 0 ? "Same as" : `${delta > 0 ? "▲ +" : "▼ −"}${Math.abs(delta).toFixed(1)} months against`} the actual {buffer.value.months.toFixed(1)}</p>}
              </div>}
            </div>
            <div className="ml-auto shrink-0 rounded-md border border-border bg-muted/40 px-4 py-2 text-right">
              <p className="text-xs text-muted-foreground">Cash &amp; bank less card balances</p>
              <p className="text-xl font-semibold leading-tight tabular-nums"><CashAccountsTip data={data} today={today} cashMinor={shown.cashMinor} grossMinor={buffer.value.grossCashMinor} cardsOwedMinor={buffer.value.cardsOwedMinor} /></p>
            </div>
          </div>
          <div className={`relative ${goal !== null ? "mt-7" : "mt-3"}`}>
            {/* The goal is named above the bar, ending at its mark near the right edge, so it never meets the labels under the bar. */}
            {goal !== null && (() => {
              const at = Math.min(100, Math.max(0, (goal / scaleMax) * 100));
              return <span className="pointer-events-none absolute -top-5 whitespace-nowrap text-[11px] text-foreground" style={{ left: `${at}%`, transform: at >= 75 ? "translateX(-100%)" : at <= 8 ? undefined : "translateX(-50%)" }}>your goal: {goal} months</span>;
            })()}
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${shown.months.toFixed(1)} months on a scale of 0 to ${scaleMax}${goal !== null ? `, your goal is ${goal}` : ""}`}>
              <div className="h-full rounded-full bg-[var(--fi-cash)]" style={{ width: `${Math.min(100, (shown.months / scaleMax) * 100)}%` }} />
            </div>
            {goal !== null && <span className="pointer-events-none absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded bg-foreground/70" style={{ left: `${Math.min(100, Math.max(0, (goal / scaleMax) * 100))}%` }} aria-hidden title={`Your goal: ${goal} months`} />}
          </div>
          <div className="relative mt-1 h-4 text-[11px] text-muted-foreground">
            <span className="absolute right-0">{scaleMax} months</span>
          </div>
          {goal !== null && (
            <p className={`mt-1 text-xs ${shown.months >= goal ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`} role="status">
              {shown.months >= goal
                ? `Your ${goal}-month goal is covered, with ${(shown.months - goal).toFixed(1)} months to spare.`
                : `${(goal - shown.months).toFixed(1)} months short of your ${goal}-month goal: ${money(Math.max(0, Math.round(goal * shown.monthlyNeedMinor - shown.cashMinor)))} more cash & bank would reach it.`}
            </p>
          )}
          {active?.result && Math.abs(active.result.months - shown.months) >= 0.05 && (
            <p className="mt-1 text-[11px] text-muted-foreground">When saved on {savedOn(active.result.at)}: {active.result.months.toFixed(1)} months (the actual was {active.result.actualMonths.toFixed(1)}).</p>
          )}
          <p className="mt-3 text-xs font-medium">What you need each month</p>
          <dl className="mt-1 text-xs">
            <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 py-1">
              <dd className="text-muted-foreground" aria-hidden />
              <dt>Spending per month<span className="block text-muted-foreground">{sim && "leftOut" in shown ? `${basis}, ${shown.leftOut} left out, ${shown.edited} ${shown.edited === 1 ? "amount" : "amounts"} changed` : `${basis}, without loan interest`}</span></dt>
              <dd className="tabular-nums">{sim ? money(shown.spendingMinor) : <SpendingBreakdownTip groups={groups} spendingMinor={buffer.value.spendingMinor} months={buffer.value.spendingMonths} />}</dd>
            </div>
            {shown.loans.map((loan) => {
              const left = "included" in loan && !loan.included;
              return (
                <div key={loan.accountId} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 border-t border-border/40 py-1">
                  <dd className="text-muted-foreground" aria-hidden>+</dd>
                  <dt className="min-w-0"><span className={`block truncate ${left ? "text-muted-foreground line-through" : ""}`} title={loan.name}>{loan.name}</span><span className="block text-muted-foreground">{left ? "left out of this scenario" : loan.source === "schedule" ? "scheduled repayment, principal + interest" : "recorded repayments paid in"}</span></dt>
                  <dd className="tabular-nums">{money(loan.monthlyMinor)}</dd>
                </div>
              );
            })}
            <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 border-t-2 border-foreground/70 py-1.5 text-sm font-semibold">
              <dd aria-hidden>=</dd><dt>Needed per month</dt><dd className="tabular-nums">{money(shown.monthlyNeedMinor)}</dd>
            </div>
          </dl>
        </>
      ) : buffer.state !== "ready" ? (
        <>
          <p className="mt-3 text-xl font-semibold">Unavailable</p>
          <p className="mt-1 text-xs text-muted-foreground">{buffer.state === "unavailable" ? buffer.reason : "Needs review"}</p>
        </>
      ) : null}

      {dialog && buffer.state === "ready" && (
        <CashBufferScenarioDialog
          key={dialog === "edit" && active ? active.id : "new"}
          buffer={buffer.value} rows={categories} basis={basis} saving={scenarios.saving}
          colours={data ? new Map(data.groups.groups.map((g) => [g.name, g.slot])) : undefined}
          window={groups ? { startMonth: groups.startMonth, endMonth: groups.endMonth } : undefined}
          drill={data ? { data, today } : undefined} goalMonths={goal} loanInterestMinor={groups?.loanInterestMinor}
          scenario={dialog === "edit" && active ? { id: active.id, name: active.name, adjustments: active.adjustments } : null}
          onClose={() => setDialog(null)}
          onSave={async (input) => { if (await scenarios.saveScenario(input)) setDialog(null); }}
          onDelete={dialog === "edit" && active ? async () => { await scenarios.deleteScenario(active.id); setDialog(null); } : undefined}
        />
      )}
    </section>
  );
}
