"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info } from "lucide-react";
import { PillGroup } from "@/components/ui/pill-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Placed, Snapshot } from "@/lib/cashflow-planning/actuals";
import type { Computed } from "@/lib/cashflow-planning/engine";
import { monthLabel } from "@/lib/cashflow-planning/months";
import { SECTIONS, SECTION_LABEL, SECTION_SIGN, type PlanDocument, type SectionId } from "@/lib/cashflow-planning/types";
import { money, signedMoney } from "@/features/financial-insights/format";
import { requestFor, type TransactionsRequest } from "../lib/transactions";
import type { Column } from "../lib/view";

const SHORT: Record<string, string> = { income: "Income", expenses: "Spent", savings: "Saved", debt: "Debt", other: "Other" };
const heading = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const sum = (values: readonly number[], indexes: readonly number[]) => indexes.reduce((total, i) => total + (values[i] ?? 0), 0);

/** One colour for each kind of movement, the same in the chart, the list and the biggest lines: money in green, spending red, savings and investments blue, debt amber, anything else (other movements) purple. */
const COLOUR: Record<string, { dot: string; fill: string }> = {
  income: { dot: "bg-emerald-500", fill: "fill-emerald-500" },
  expenses: { dot: "bg-red-500", fill: "fill-red-500" },
  savings: { dot: "bg-blue-500", fill: "fill-blue-500" },
  debt: { dot: "bg-amber-500", fill: "fill-amber-500" },
  other: { dot: "bg-purple-500", fill: "fill-purple-500" },
};

type Point = { label: string; value: number; total?: boolean; /** Which colour the step takes. */ kind?: string };

/**
 * Opening balance, each step that moved the cash, and the closing balance, as a small waterfall: money in rises (green), money
 * out falls, each in the colour of what it is, and the two balances stand on the base line. The scale starts below the lowest level, so the steps stay visible
 * against balances far larger than any of them. Static; the ledger under it has the exact figures.
 */
function CashWaterfall({ points, description }: { points: Point[]; description: string }) {
  // Where each bar starts and ends, level by level.
  const bars: { p: Point; from: number; to: number }[] = [];
  let level = 0;
  for (const p of points) {
    if (p.total) { bars.push({ p, from: NaN, to: p.value }); level = p.value; } else { bars.push({ p, from: level, to: level + p.value }); level += p.value; }
  }
  const values = bars.flatMap((b) => [b.from, b.to]).filter((v) => !Number.isNaN(v));
  const hi = Math.max(...values), lo = Math.min(...values);
  if (hi === lo) return null;
  const pad = (hi - lo) * 0.18, top = hi + pad * 0.5, base = lo - pad;
  const W = 340, H = 96, left = 6, step = (W - left * 2) / points.length, bar = Math.min(30, step * 0.62);
  const y = (v: number) => 6 + ((top - v) / (top - base)) * (H - 6);
  return (
    <figure role="img" aria-label={description} className="rounded-lg border border-border bg-muted/30 px-2 pb-1.5 pt-2">
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="block w-full" aria-hidden>
        {bars.map(({ p, from, to }, i) => {
          const start = Number.isNaN(from) ? base : from;
          const x = left + i * step + (step - bar) / 2;
          const yTop = y(Math.max(start, to)), yBottom = y(Math.min(start, to));
          const colour = p.total ? "fill-muted-foreground/45" : COLOUR[p.kind ?? "other"]?.fill ?? "fill-purple-500";
          return (
            <g key={p.label}>
              <rect x={x} y={yTop} width={bar} height={Math.max(1.5, yBottom - yTop)} rx={2} className={colour} />
              {i < bars.length - 1 && <line x1={x + bar} x2={x + step} y1={y(to)} y2={y(to)} className="stroke-muted-foreground/40" strokeDasharray="2 2" strokeWidth={0.75} />}
              <text x={x + bar / 2} y={H + 11} textAnchor="middle" fontSize="9" className="fill-muted-foreground">{p.label}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/**
 * What the details panel shows for a month (or a year) picked in the grid's header: where the cash came from and went, how the
 * month compares with the one before, the lines that moved most, and anything that needs a look.
 */
export function MonthSummary({ doc, computed, snapshot, placed, column, onShowTransactions, onSelectLine }: {
  doc: PlanDocument; computed: Computed; snapshot: Snapshot | null; placed: Placed | null; column: Column;
  onShowTransactions: (request: TransactionsRequest) => void; onSelectLine: (key: string | null) => void;
}) {
  const indexes = column.kind === "month" ? [column.index] : column.indexes;
  const months = indexes.map((i) => computed.months[i]);
  const label = column.kind === "month" ? monthLabel(column.month) : String(column.year);
  const kind = column.kind === "month" ? computed.kinds[column.index] : null;
  const first = indexes[0], last = indexes[indexes.length - 1];
  // The balance can be the plan's cash, or cash and the savings & investments estimate together.
  const [basis, setBasis] = useState<"cash" | "total">("cash");
  const withSavings = basis === "total" && computed.savings !== null;
  const savingsAt = (i: number) => (withSavings ? computed.savings?.[Math.max(0, i)] ?? 0 : 0);
  const opening = computed.opening[first] + (first > 0 ? savingsAt(first - 1) : savingsAt(first));
  const closing = computed.closing[last] + savingsAt(last);
  const cashOpening = computed.opening[first], cashClosing = computed.closing[last];

  const natural = Object.fromEntries(SECTIONS.map((s) => [s, sum(computed.sectionTotals[s], indexes)])) as Record<SectionId, number>;
  const other = sum(computed.inTransit, indexes) + sum(computed.moved, indexes) + sum(computed.startingBalances, indexes);
  const net = sum(computed.net, indexes);
  // What "Other movements" is made of in these months: the grid's three lines outside the sections.
  const otherParts = [
    { label: "Transfers in transit", amount: sum(computed.inTransit, indexes), text: "Transfers between your cash accounts whose two sides fall in different months. They cancel out over time." },
    { label: "Moved between months", amount: sum(computed.moved, indexes), text: "Transactions counted in another month than their date (a #YYYY-MM tag in the note, or moved in this plan), put back in the month the money really moved." },
    { label: "Starting balances added", amount: sum(computed.startingBalances, indexes), text: "Starting balances Actual recorded in these months, such as an account that joined the plan's cash. Not income." },
  ].filter((part) => part.amount !== 0);

  // The transactions behind each section's figure, for months that have any.
  const requests = useMemo(() => Object.fromEntries(SECTIONS.map((section) => [section, requestFor(doc, snapshot, placed, { kind: "section", key: `section:${section}`, section, label: SECTION_LABEL[section], values: [], aggregate: "sum", collapsed: false }, months, label)])) as Record<SectionId, TransactionsRequest | null>, [doc, snapshot, placed, months, label]);

  const steps: { key: string; label: string; cash: number; request?: TransactionsRequest | null }[] = [
    ...SECTIONS.map((s) => ({ key: s, label: SECTION_LABEL[s], cash: natural[s] * SECTION_SIGN[s], request: requests[s] })),
    ...(other !== 0 ? [{ key: "other", label: "Other movements", cash: other, request: null }] : []),
  ];

  // The three lines of each section that moved the most in these months, with the transactions behind each when there are any.
  const biggestBySection = SECTIONS.map((section) => ({
    section,
    list: doc.rows
      .filter((r) => r.section === section)
      .map((row) => ({ row, amount: sum(computed.rows.get(row.id)?.values ?? [], indexes) }))
      .filter((r) => r.amount !== 0)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 3)
      .map((item) => {
        const result = computed.rows.get(item.row.id);
        return { ...item, request: result ? requestFor(doc, snapshot, placed, { kind: "row", key: `row:${item.row.id}`, row: item.row, result, aggregate: "sum", depth: 1 }, months, label) : null };
      }),
  }));

  const below = indexes.some((i) => computed.belowMinimum[i]);
  const goals = computed.goals.filter((g) => months.includes(g.goal.month));
  const Amount = ({ children, request }: { children: ReactNode; request?: TransactionsRequest | null }) => request
    ? <button type="button" onClick={() => onShowTransactions(request)} title="Show the transactions" className="tabular-nums underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground">{children}</button>
    : <span className="tabular-nums">{children}</span>;

  return (
    <>
      <section>
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground">{kind === "forecast" || kind === "current" ? "Expected closing balance" : "Closing balance"}</p>
            {computed.savings !== null && <PillGroup<"cash" | "total"> options={[{ value: "cash", label: "Cash" }, { value: "total", label: "Cash + savings" }]} value={basis} onChange={setBasis} />}
          </div>
          <p className="text-xl font-semibold tabular-nums">{money(closing)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", closing - opening >= 0 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-red-500/15 text-red-700 dark:text-red-300")}>
              {closing - opening >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
              {signedMoney(closing - opening)}
            </span>
            <span className="text-muted-foreground">from {money(opening)}</span>
          </p>
        </div>
      </section>

      {(below || goals.length > 0) && (
        <section className="space-y-1.5">
          {below && <p role="status" className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />Closing cash is below the minimum{doc.minimumCash !== null ? ` of ${money(doc.minimumCash)}` : ""}.</p>}
          {goals.map(({ goal, shortfall, projected }) => <p key={goal.id} className={cn("rounded-md border p-2", shortfall ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400")}>Goal “{goal.name}” is due: {shortfall ? `short by ${money(shortfall)}` : `reached${projected !== null ? `, ${money(projected - goal.amount)} to spare` : ""}`}.</p>)}
        </section>
      )}

      <section className="space-y-2">
        <h3 className={heading}>Where the cash went</h3>
        <CashWaterfall
          description={`Cash from ${money(cashOpening)} to ${money(cashClosing)}: ${steps.filter((x) => x.cash !== 0).map((x) => `${x.label} ${signedMoney(x.cash)}`).join(", ")}`}
          points={[{ label: "Open", value: cashOpening, total: true }, ...steps.filter((x) => x.cash !== 0).map((x) => ({ label: SHORT[x.key] ?? x.label, value: x.cash, kind: x.key })), { label: "Close", value: cashClosing, total: true }]} />
        <ul className="space-y-1.5">
          <li className="flex items-baseline justify-between gap-2"><span className="text-muted-foreground">Opening balance</span><span className="tabular-nums">{money(cashOpening)}</span></li>
          {steps.map((step) => (
            <li key={step.key} className="flex items-baseline justify-between gap-2"><span className="flex items-center gap-2"><span aria-hidden className={cn("size-2 rounded-full", COLOUR[step.key]?.dot)} />{step.label}{step.key === "other" && (
              <Popover>
                <PopoverTrigger render={<button type="button" aria-label="What Other movements are" title="What Other movements are" className="text-muted-foreground hover:text-foreground" />}><Info className="size-3.5" aria-hidden /></PopoverTrigger>
                <PopoverContent align="start" className="w-72 space-y-2 p-3 text-xs">
                  <p className="font-medium">Other movements</p>
                  <p className="leading-relaxed text-muted-foreground">Cash that moved in these months but is not income, spending, saving or debt. It keeps the list adding up to the real change in your cash. Each part has its own line in the grid, under the sections.</p>
                  <ul className="space-y-2">
                    {otherParts.map((part) => (
                      <li key={part.label} className="space-y-0.5">
                        <p className="flex items-baseline justify-between gap-2 font-medium"><span>{part.label}</span><span className="tabular-nums">{signedMoney(part.amount)}</span></p>
                        <p className="leading-relaxed text-muted-foreground">{part.text}</p>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}</span>{step.cash === 0 ? <span className="text-muted-foreground">–</span> : <Amount request={step.request}>{signedMoney(step.cash)}</Amount>}</li>
          ))}
          <li className="flex items-baseline justify-between gap-2 border-t border-border pt-1.5 font-semibold"><span>Net cashflow</span><span className="tabular-nums">{signedMoney(net)}</span></li>
          <li className="flex items-baseline justify-between gap-2 font-semibold"><span>Closing balance</span><span className="tabular-nums">{money(cashClosing)}</span></li>
          {withSavings && <><li className="flex items-baseline justify-between gap-2 text-muted-foreground"><span>Savings & investments (estimate)</span><span className="tabular-nums">{money(savingsAt(last))}</span></li><li className="flex items-baseline justify-between gap-2 font-semibold"><span>Cash + savings</span><span className="tabular-nums">{money(closing)}</span></li></>}
        </ul>
      </section>

      {biggestBySection.some((x) => x.list.length > 0) && (
        <section className="space-y-3">
          <h3 className={heading}>Biggest lines</h3>
          {biggestBySection.filter((x) => x.list.length > 0).map(({ section, list }) => (
            <div key={section} className="space-y-1">
              <p className="flex items-center gap-2 text-muted-foreground"><span aria-hidden className={cn("size-2 rounded-full", COLOUR[section]?.dot)} />{SECTION_LABEL[section]}</p>
              <ul className="space-y-1">
                {list.map(({ row, amount, request }) => (
                  <li key={row.id} className="flex items-baseline justify-between gap-2">
                    <button type="button" onClick={() => onSelectLine(`row:${row.id}`)} className="min-w-0 truncate text-left hover:underline" title={row.name}>{row.name}</button>
                    <Amount request={request}>{money(amount)}</Amount>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
