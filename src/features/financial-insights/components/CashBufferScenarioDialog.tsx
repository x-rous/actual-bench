"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PillGroup } from "@/components/ui/pill-group";
import { OverlayScrollArea } from "@/features/budget-management/components/OverlayScrollArea";
import {
  adjustedBuffer, categoryKey, fixedSpending, isUnadjusted, scenarioAmount, tidyAdjustments,
  type BufferAdjustments, type BufferCategoryRow, type ScenarioResult,
} from "@/lib/financial-insights/bufferScenario";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import type { CashBuffer } from "@/lib/financial-insights/measures";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { money, signedMoney } from "../format";
import { DrillDialog } from "./DrillDialog";
import { AmountInput as AmountField } from "./FieldInputs";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;

// check | name | share bar | share | typical | your amount | reset
const ROW = "grid grid-cols-[1.25rem_minmax(0,2fr)_minmax(4rem,0.8fr)_3.25rem_5.75rem_7rem_1.5rem] items-center gap-x-3";
/** The amount field of a row: the shared one, at the row's height. */
const AmountInput = (props: Omit<React.ComponentProps<typeof AmountField>, "className">) => <AmountField {...props} className="h-6 text-right" />;

/** The record without one key. */
const without = <T,>(record: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/** A bar for an amount on a scale: the typical amount faintly behind, the amount in this scenario in front. */
function ShareBar({ typical, current, scale, colour }: { typical: number; current: number; scale: number; colour: string }) {
  const width = (v: number) => `${Math.min(100, Math.max(0, scale > 0 ? (v / scale) * 100 : 0))}%`;
  return (
    <div className="relative h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full opacity-25" style={{ width: width(typical), background: colour }} />
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: width(current), background: colour }} />
    </div>
  );
}

type Props = {
  buffer: CashBuffer;
  rows: BufferCategoryRow[];
  /** How a typical month was worked out, in words ("average of the last 12 complete months"). */
  basis: string;
  /** The colour slot of each category group as the Spending tab draws it, so a group looks the same here. */
  colours?: ReadonlyMap<string, number>;
  /** The first and last month a typical month is taken over: what an amount's transactions are listed for. */
  window?: { startMonth: string; endMonth: string };
  /** What the interest and fees of tracked loans come to in a month: counted in the loan repayments, so left out of the categories. */
  loanInterestMinor?: number;
  /** The months of cover the user aims for, drawn on the result and measured against. */
  goalMonths?: number | null;
  /** What lets an amount open the transactions behind it. */
  drill?: { data: Ready; today: string };
  /** The scenario being edited, or null for a new one. */
  scenario: { id: string; name: string; adjustments: BufferAdjustments } | null;
  saving: boolean;
  onSave: (input: { id?: string; name: string; adjustments: BufferAdjustments; result: ScenarioResult }) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
};

/**
 * Simulate the cash buffer: untick what would not be spent and change what each costs, and see the result as it changes. The
 * typical amounts are what the real buffer uses; nothing here changes it.
 */
export function CashBufferScenarioDialog({ buffer, rows, basis, colours, window, loanInterestMinor = 0, goalMonths = null, drill, scenario, saving, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(scenario?.name ?? "My scenario");
  const [draft, setDraft] = useState<BufferAdjustments>(scenario?.adjustments ?? { excluded: [], amounts: {}, loansExcluded: [], loanAmounts: {} });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sort, setSort] = useState<"spend" | "name" | "budget">("budget");
  const [listed, setListed] = useState<DrillTarget | null>(null);

  // Spend: the most expensive first. Name: A to Z. Budget order: as the groups and categories are ordered in the budget (spending with no category last).
  const groups = useMemo(() => {
    const byName = new Map<string, BufferCategoryRow[]>();
    for (const r of rows) byName.set(r.group, [...(byName.get(r.group) ?? []), r]);
    const last = Number.MAX_SAFE_INTEGER;
    const within = (a: BufferCategoryRow, b: BufferCategoryRow) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "budget" ? (a.order ?? last) - (b.order ?? last) || a.name.localeCompare(b.name) : b.avgMinor - a.avgMinor || a.name.localeCompare(b.name);
    const list = [...byName].map(([group, members]) => ({ group, rows: [...members].sort(within), typical: members.reduce((a, r) => a + r.avgMinor, 0), order: Math.min(last, ...members.map((r) => r.order ?? last)) }));
    return list.sort((a, b) => (sort === "name" ? a.group.localeCompare(b.group) : sort === "budget" ? a.order - b.order || a.group.localeCompare(b.group) : b.typical - a.typical || a.group.localeCompare(b.group)));
  }, [rows, sort]);
  // A group looks as it does on the Spending tab; one that tab does not show takes the colour of its rank here.
  const colourOf = (group: string) => {
    const slot = colours?.get(group) ?? Math.min(10, [...groups].sort((a, b) => b.typical - a.typical).findIndex((g) => g.group === group));
    return `var(--fi-g${slot})`;
  };
  const needle = query.trim().toLowerCase();
  const visible = groups.flatMap((g) => {
    const list = needle ? g.rows.filter((r) => r.name.toLowerCase().includes(needle) || g.group.toLowerCase().includes(needle)) : g.rows;
    return list.length ? [{ ...g, rows: list }] : [];
  });

  // The categories on screen: the bulk checkbox in the header ticks or unticks exactly these.
  const shownRows = visible.flatMap((g) => g.rows);

  const tidy = useMemo(() => tidyAdjustments(rows, buffer.loans, draft), [rows, buffer.loans, draft]);
  const result = useMemo(() => adjustedBuffer(buffer, rows, tidy), [buffer, rows, tidy]);
  const fixed = fixedSpending(buffer, rows);
  const need = result.state === "ready" ? result.value.monthlyNeedMinor : buffer.monthlyNeedMinor;
  const maxGroup = Math.max(1, ...groups.map((g) => g.typical));
  const maxRow = Math.max(1, ...rows.map((r) => r.avgMinor));
  const share = (amount: number) => (need > 0 ? `${((amount / need) * 100).toFixed(1)}%` : "-");

  const included = (r: BufferCategoryRow) => !draft.excluded.includes(categoryKey(r));
  const shown = (r: BufferCategoryRow) => draft.amounts[categoryKey(r)] ?? r.avgMinor;
  const changed = (r: BufferCategoryRow) => !included(r) || (draft.amounts[categoryKey(r)] !== undefined && draft.amounts[categoryKey(r)] !== r.avgMinor);

  const setIncluded = (list: BufferCategoryRow[], on: boolean) => setDraft((d) => {
    const keys = new Set(list.map(categoryKey));
    return { ...d, excluded: on ? d.excluded.filter((k) => !keys.has(k)) : [...new Set([...d.excluded, ...keys])] };
  });
  const setAmount = (r: BufferCategoryRow, minor: number) => setDraft((d) => ({ ...d, amounts: { ...d.amounts, [categoryKey(r)]: minor } }));
  const resetRow = (r: BufferCategoryRow) => setDraft((d) => {
    const key = categoryKey(r);
    return { ...d, excluded: d.excluded.filter((k) => k !== key), amounts: without(d.amounts, key) };
  });
  /** A group's total, set by scaling the categories that count so each keeps its share; the last one takes the rounding. */
  const setGroupTotal = (list: BufferCategoryRow[], total: number) => setDraft((d) => {
    const counted = list.filter((r) => !d.excluded.includes(categoryKey(r)));
    const current = counted.reduce((a, r) => a + (d.amounts[categoryKey(r)] ?? r.avgMinor), 0);
    if (counted.length === 0 || current <= 0) return d;
    const amounts = { ...d.amounts };
    let given = 0;
    counted.forEach((r, i) => {
      const key = categoryKey(r);
      const part = i === counted.length - 1 ? total - given : Math.round(((d.amounts[key] ?? r.avgMinor) * total) / current);
      amounts[key] = Math.max(0, part);
      given += amounts[key];
    });
    return { ...d, amounts };
  });

  const loanChanged = (id: string, typical: number) => draft.loansExcluded.includes(id) || (draft.loanAmounts[id] !== undefined && draft.loanAmounts[id] !== typical);
  const resetAll = () => setDraft({ excluded: [], amounts: {}, loansExcluded: [], loanAmounts: {} });
  const unchanged = isUnadjusted(tidy);

  // What a typical amount adds up to over the months it is taken over, listed as transactions (only where the totals are known).
  const listFor = (label: string, list: BufferCategoryRow[]): DrillTarget | null => {
    if (!drill || !window || list.some((r) => r.totalMinor === undefined)) return null;
    return {
      kind: "category", categoryIds: list.flatMap((r) => (r.id === null ? [] : [r.id])), includeUncategorized: list.some((r) => r.id === null), name: label,
      amountMinor: list.reduce((a, r) => a + (r.totalMinor ?? 0), 0), month: window.startMonth, throughMonth: window.endMonth !== window.startMonth ? window.endMonth : undefined,
    };
  };
  const typicalCell = (label: string, list: BufferCategoryRow[], minor: number) => {
    const target = listFor(label, list);
    const loan = list.reduce((a, r) => a + (r.loanInterestMinor ?? 0), 0);
    return target
      ? <button type="button" className="text-right tabular-nums text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground" title={loan > 0 ? `See the transactions behind this amount. They include ${money(loan)} a month of loan interest and fees, which the loan repayments count instead.` : "See the transactions behind this amount"} aria-label={`${label}: see the transactions behind ${money(minor)}`} onClick={() => setListed(target)}>{money(minor)}</button>
      : <span className="text-right tabular-nums text-muted-foreground">{money(minor)}</span>;
  };

  const save = async (asNew: boolean) => {
    if (result.state !== "ready") return;
    const trimmed = name.trim() || "My scenario";
    const finalName = asNew && scenario && trimmed === scenario.name ? `${trimmed} (copy)` : trimmed;
    await onSave({
      id: asNew ? undefined : scenario?.id, name: finalName, adjustments: tidy,
      result: { months: result.value.months, cashMinor: result.value.cashMinor, monthlyNeedMinor: result.value.monthlyNeedMinor, actualMonths: buffer.months, at: new Date().toISOString() },
    });
  };

  // The bar runs to 12 months, or further when the goal or the cover is beyond that.
  const scaleMax = goalMonths === null ? 12 : Math.max(12, goalMonths, Math.ceil(Math.max(buffer.months, result.state === "ready" ? result.value.months : 0)));
  const scale = (months: number) => `${Math.min(100, Math.max(0, (months / scaleMax) * 100))}%`;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="flex h-[88vh] max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-7xl">
        <DialogHeader className="shrink-0 gap-1 border-b border-border px-5 py-3">
          <DialogTitle>Simulate your cash buffer</DialogTitle>
          <DialogDescription>Untick what you would not spend, or type a different monthly amount. Your real buffer is not changed.</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">Name
                <Input size="sm" className="w-52 text-foreground" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Scenario name" />
              </label>
              <Input size="sm" className="w-44 text-foreground" placeholder="Find a category…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a category" />
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">Sort by
                <PillGroup options={[{ value: "budget", label: "Budget order" }, { value: "spend", label: "Spend" }, { value: "name", label: "Name" }]} value={sort} onChange={setSort} />
              </span>
              <span className="ml-auto flex items-center gap-1">
                <Button size="xs" variant="ghost" onClick={resetAll} disabled={unchanged && !draft.excluded.length}><RotateCcw className="size-3.5" aria-hidden />Reset all</Button>
              </span>
            </div>
            <OverlayScrollArea className="flex-1">
              <div className="px-5 pb-4">
                <div className={`${ROW} sticky top-0 z-10 border-b border-border bg-background py-1 text-[11px] text-muted-foreground`}>
                  <Checkbox aria-label={needle ? "Include every category shown" : "Include every category"} checked={shownRows.length > 0 && shownRows.every(included)} indeterminate={shownRows.some(included) && !shownRows.every(included)} disabled={shownRows.length === 0} onCheckedChange={(on) => setIncluded(shownRows, on)} />
                  <span>Category</span><span /><span className="text-right" title="Its part of the monthly need in this scenario">Share</span>
                  <span className="text-right" title={`The ${basis}`}>Typical / month</span><span className="text-right">Your amount</span><span />
                </div>
                {visible.map((g) => {
                  const isOpen = open.has(g.group) || needle !== "";
                  const counted = g.rows.filter(included);
                  const total = g.rows.reduce((a, r) => a + scenarioAmount(r, draft), 0);
                  const colour = colourOf(g.group);
                  const groupChanged = g.rows.some(changed);
                  return (
                    <div key={g.group} className="border-b border-border/40">
                      <div className={`${ROW} py-0.5 text-xs`}>
                        <Checkbox aria-label={`Include ${g.group}`} checked={counted.length === g.rows.length} indeterminate={counted.length > 0 && counted.length < g.rows.length} onCheckedChange={(on) => setIncluded(g.rows, on)} />
                        <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${g.group}`} className="flex min-w-0 items-center gap-1.5 text-left font-medium"
                          onClick={() => setOpen((cur) => { const n = new Set(cur); if (!n.delete(g.group)) n.add(g.group); return n; })}>
                          {isOpen ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: colour }} aria-hidden />
                          <span className="truncate">{g.group}</span><span className="shrink-0 font-normal text-muted-foreground">· {g.rows.length}</span>
                        </button>
                        <ShareBar typical={g.rows.reduce((a, r) => a + r.avgMinor, 0)} current={total} scale={maxGroup} colour={colour} />
                        <span className="text-right tabular-nums text-muted-foreground">{counted.length === 0 ? "-" : share(total)}</span>
                        {typicalCell(g.group, g.rows, g.rows.reduce((a, r) => a + r.avgMinor, 0))}
                        <AmountInput key={`${g.group}-${total}`} minor={total} label={`${g.group} total per month`} disabled={counted.length === 0 || counted.reduce((a, r) => a + shown(r), 0) <= 0} onCommit={(minor) => setGroupTotal(g.rows, minor)} />
                        <button type="button" className={`inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground ${groupChanged ? "" : "invisible"}`} aria-label={`Reset ${g.group}`} title="Back to the typical amounts" onClick={() => g.rows.forEach(resetRow)}><RotateCcw className="size-3.5" aria-hidden /></button>
                      </div>
                      {isOpen && g.rows.map((r) => (
                        <div key={categoryKey(r)} className={`${ROW} py-px text-xs`}>
                          <span />
                          <label className="flex min-w-0 items-center gap-2 pl-5">
                            <Checkbox aria-label={`Include ${r.name}`} checked={included(r)} onCheckedChange={(on) => setIncluded([r], on)} />
                            <span className={`truncate ${included(r) ? "" : "text-muted-foreground line-through"}`} title={r.name}>{r.name}{r.hidden ? " (hidden)" : ""}</span>
                          </label>
                          <ShareBar typical={r.avgMinor} current={included(r) ? shown(r) : 0} scale={maxRow} colour={colour} />
                          <span className="text-right tabular-nums text-muted-foreground">{included(r) ? share(shown(r)) : "-"}</span>
                          {typicalCell(r.name, [r], r.avgMinor)}
                          <AmountInput key={`${categoryKey(r)}-${shown(r)}`} minor={shown(r)} label={`${r.name} per month`} disabled={!included(r)} onCommit={(minor) => setAmount(r, minor)} />
                          <button type="button" className={`inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground ${changed(r) ? "" : "invisible"}`} aria-label={`Reset ${r.name}`} title="Back to the typical amount" onClick={() => resetRow(r)}><RotateCcw className="size-3.5" aria-hidden /></button>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {visible.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">No category matches.</p>}
                {Math.abs(fixed) > rows.length + 1 && !needle && (
                  <div className={`${ROW} border-b border-border/40 py-0.5 text-xs text-muted-foreground`}>
                    <span /><span className="col-span-2 truncate" title="What the categories above do not hold: a part of the real buffer's spending that cannot be left out.">Other spending in the real buffer (always counted)</span>
                    <span /><span className="text-right tabular-nums">{money(fixed)}</span><span className="text-right tabular-nums">{money(fixed)}</span><span />
                  </div>
                )}
                {buffer.loans.length > 0 && !needle && (
                  <div className="mt-2">
                    <div className={`${ROW} border-b border-border py-1 text-xs font-medium`}>
                      <span /><span>Loan repayments</span>
                      <span className="col-span-5 truncate text-right text-[11px] font-normal text-muted-foreground" title="The interest and fees of tracked loans are part of these repayments, so they are not counted again in the categories above.">{loanInterestMinor > 0 ? `Include ${money(loanInterestMinor)} a month of interest and fees, which the categories above leave out` : "Principal, interest and fees"}</span>
                    </div>
                    {buffer.loans.map((l) => {
                      const on = !draft.loansExcluded.includes(l.accountId);
                      const value = draft.loanAmounts[l.accountId] ?? l.monthlyMinor;
                      return (
                        <div key={l.accountId} className={`${ROW} border-b border-border/40 py-px text-xs`}>
                          <Checkbox aria-label={`Include ${l.name}`} checked={on} onCheckedChange={(next) => setDraft((d) => ({ ...d, loansExcluded: next ? d.loansExcluded.filter((id) => id !== l.accountId) : [...d.loansExcluded, l.accountId] }))} />
                          <span className="flex min-w-0 items-baseline gap-1.5" title={l.name}><span className={`truncate ${on ? "" : "text-muted-foreground line-through"}`}>{l.name}</span><span className="shrink-0 text-[11px] text-muted-foreground">{l.source === "schedule" ? "scheduled" : "recorded"}</span></span>
                          <ShareBar typical={l.monthlyMinor} current={on ? value : 0} scale={Math.max(1, ...buffer.loans.map((x) => x.monthlyMinor))} colour="var(--fi-loan)" />
                          <span className="text-right tabular-nums text-muted-foreground">{on ? share(value) : "-"}</span>
                          <span className="text-right tabular-nums text-muted-foreground">{money(l.monthlyMinor)}</span>
                          <AmountInput key={`${l.accountId}-${value}`} minor={value} label={`${l.name} repayment per month`} disabled={!on} onCommit={(minor) => setDraft((d) => ({ ...d, loanAmounts: { ...d.loanAmounts, [l.accountId]: minor } }))} />
                          <button type="button" className={`inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground ${loanChanged(l.accountId, l.monthlyMinor) ? "" : "invisible"}`} aria-label={`Reset ${l.name}`} title="Back to the typical repayment"
                            onClick={() => setDraft((d) => ({ ...d, loansExcluded: d.loansExcluded.filter((id) => id !== l.accountId), loanAmounts: without(d.loanAmounts, l.accountId) }))}><RotateCcw className="size-3.5" aria-hidden /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </OverlayScrollArea>
          </div>

          <aside className="shrink-0 border-t border-border bg-muted/30 px-5 py-4 lg:w-80 lg:border-l lg:border-t-0" aria-label="The buffer in this scenario" aria-live="polite">
            {result.state === "ready" ? (
              <>
                <p className="text-xs text-muted-foreground">Months of cover in this scenario</p>
                <p className="text-4xl font-semibold leading-none tracking-tight tabular-nums">{result.value.months.toFixed(1)} <span className="text-base font-normal text-muted-foreground">months</span></p>
                <p className={`mt-1 text-xs ${result.value.months > buffer.months ? "text-green-700 dark:text-green-400" : result.value.months < buffer.months ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
                  {result.value.months === buffer.months ? "Same as" : `${result.value.months > buffer.months ? "+" : "−"}${Math.abs(result.value.months - buffer.months).toFixed(1)} months against`} the real {buffer.months.toFixed(1)}
                </p>
                <div className="mt-3" role="img" aria-label={`Real ${buffer.months.toFixed(1)} months, this scenario ${result.value.months.toFixed(1)} months, on a scale of 0 to ${scaleMax}${goalMonths !== null ? `, your goal is ${goalMonths}` : ""}`}>
                  <div className="relative px-px">
                    <div className="space-y-1.5">
                      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-muted-foreground/40" style={{ width: scale(buffer.months) }} /></div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[var(--fi-cash)]" style={{ width: scale(result.value.months) }} /></div>
                    </div>
                    {goalMonths !== null && <span className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 rounded bg-foreground/70" style={{ left: `${Math.min(99.5, (goalMonths / scaleMax) * 100)}%` }} aria-hidden title={`Your goal: ${goalMonths} months`} />}
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground"><span>0 · real above, scenario below</span><span>{scaleMax} months{goalMonths === scaleMax ? " · goal" : ""}</span></div>
                </div>
                {goalMonths !== null && (
                  <p className={`mt-2 text-xs ${result.value.months >= goalMonths ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}>
                    {result.value.months >= goalMonths ? `Covers your ${goalMonths}-month goal, with ${(result.value.months - goalMonths).toFixed(1)} months to spare.` : `${(goalMonths - result.value.months).toFixed(1)} months short of your ${goalMonths}-month goal.`}
                  </p>
                )}
                <dl className="mt-4 space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Spending per month</dt><dd className="tabular-nums">{money(result.value.spendingMinor)}<span className="block text-right text-[11px] text-muted-foreground">real {money(buffer.spendingMinor)}</span></dd></div>
                  {result.value.loans.length > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Loan repayments</dt><dd className="tabular-nums">{money(result.value.loans.reduce((a, l) => a + l.monthlyMinor, 0))}<span className="block text-right text-[11px] text-muted-foreground">real {money(buffer.loans.reduce((a, l) => a + l.monthlyMinor, 0))}</span></dd></div>}
                  <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold"><dt>Needed per month</dt><dd className="tabular-nums">{money(result.value.monthlyNeedMinor)}<span className="block text-right text-[11px] font-normal text-muted-foreground">{signedMoney(result.value.monthlyNeedMinor - buffer.monthlyNeedMinor)} against real</span></dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Cash &amp; bank today</dt><dd className="tabular-nums">{money(result.value.cashMinor)}</dd></div>
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">{result.value.leftOut} left out · {result.value.edited} {result.value.edited === 1 ? "amount" : "amounts"} changed</p>
              </>
            ) : (
              <>
                <p className="text-xl font-semibold">Unavailable</p>
                <p className="mt-1 text-xs text-muted-foreground">{result.reason}</p>
              </>
            )}
            <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">Typical month: the {basis}. Select a typical amount to see its transactions.</p>
          </aside>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/50 px-5 py-3">
          {onDelete && confirmDelete ? (
            <span className="flex items-center gap-2 text-xs">Delete this scenario? <Button size="sm" variant="destructive" onClick={onDelete}>Delete</Button><Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>Keep</Button></span>
          ) : (
            <>
              {onDelete && <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>Delete scenario</Button>}
              <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
              {scenario && <Button size="sm" variant="outline" disabled={saving || result.state !== "ready"} onClick={() => void save(true)}>Save as new</Button>}
              <Button size="sm" disabled={saving || result.state !== "ready"} onClick={() => void save(false)}>Save and show</Button>
            </>
          )}
        </div>

        {listed && drill && <DrillDialog target={listed as Exclude<DrillTarget, { kind: "inTransit" }>} data={drill.data} today={drill.today} onClose={() => setListed(null)} />}
      </DialogContent>
    </Dialog>
  );
}
