"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { PillGroup } from "@/components/ui/pill-group";
import { cn } from "@/lib/utils";
import type { Placed, Snapshot } from "@/lib/cashflow-planning/actuals";
import type { Computed } from "@/lib/cashflow-planning/engine";
import { monthLabel } from "@/lib/cashflow-planning/months";
import { SECTIONS, SECTION_LABEL, SECTION_SIGN, type PlanDocument, type SectionId } from "@/lib/cashflow-planning/types";
import { money, signedMoney } from "@/features/financial-insights/format";
import { requestFor, type TransactionsRequest } from "../lib/transactions";
import type { Column } from "../lib/view";

const heading = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const sum = (values: readonly number[], indexes: readonly number[]) => indexes.reduce((total, i) => total + (values[i] ?? 0), 0);

const BAR: Record<SectionId, string> = { income: "bg-emerald-600/70", expenses: "bg-rose-500/70", savings: "bg-sky-500/70", debt: "bg-amber-500/70" };

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

  // The transactions behind each section's figure, for months that have any.
  const requests = useMemo(() => Object.fromEntries(SECTIONS.map((section) => [section, requestFor(doc, snapshot, placed, { kind: "section", key: `section:${section}`, section, label: SECTION_LABEL[section], values: [], aggregate: "sum", collapsed: false }, months, label)])) as Record<SectionId, TransactionsRequest | null>, [doc, snapshot, placed, months, label]);

  const steps: { key: string; label: string; cash: number; tone: string; request?: TransactionsRequest | null }[] = [
    ...SECTIONS.map((s) => ({ key: s, label: SECTION_LABEL[s], cash: natural[s] * SECTION_SIGN[s], tone: BAR[s], request: requests[s] })),
    ...(other !== 0 ? [{ key: "other", label: "Other movements", cash: other, tone: "bg-muted-foreground/40", request: null }] : []),
  ];
  const scale = Math.max(1, ...steps.map((s) => Math.abs(s.cash)), Math.abs(net));

  // The lines that moved the most in these months.
  const biggest = (section: SectionId, count: number) => doc.rows
    .filter((r) => r.section === section)
    .map((r) => ({ row: r, amount: sum(computed.rows.get(r.id)?.values ?? [], indexes) }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, count);

  const below = indexes.some((i) => computed.belowMinimum[i]);
  const goals = computed.goals.filter((g) => months.includes(g.goal.month));
  const Amount = ({ children, request }: { children: ReactNode; request?: TransactionsRequest | null }) => request
    ? <button type="button" onClick={() => onShowTransactions(request)} title="Show the transactions" className="tabular-nums underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground">{children}</button>
    : <span className="tabular-nums">{children}</span>;

  return (
    <>
      <section>
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground">{kind === "forecast" || kind === "current" ? "Expected closing balance" : "Closing balance"}</p>
            {computed.savings !== null && <PillGroup<"cash" | "total"> options={[{ value: "cash", label: "Cash" }, { value: "total", label: "Cash + savings" }]} value={basis} onChange={setBasis} />}
          </div>
          <p className="text-xl font-semibold tabular-nums">{money(closing)}</p>
          <p className={cn("flex items-center gap-1 tabular-nums", closing - opening >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
            {closing - opening >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
            {signedMoney(closing - opening)} <span className="text-muted-foreground">from {money(opening)}</span>
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
        <ul className="space-y-1.5">
          <li className="flex items-baseline justify-between gap-2"><span className="text-muted-foreground">Opening balance</span><span className="tabular-nums">{money(cashOpening)}</span></li>
          {steps.map((step) => (
            <li key={step.key} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2"><span>{step.label}</span><Amount request={step.request}>{signedMoney(step.cash)}</Amount></div>
              <div className="h-1.5 rounded-full bg-muted" aria-hidden><div className={cn("h-full rounded-full", step.tone)} style={{ width: `${(Math.abs(step.cash) / scale) * 100}%` }} /></div>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-2 border-t border-border pt-1.5 font-semibold"><span>Net cashflow</span><span className={cn("tabular-nums", net < 0 && "text-destructive")}>{signedMoney(net)}</span></li>
          <li className="flex items-baseline justify-between gap-2 font-semibold"><span>Closing balance</span><span className="tabular-nums">{money(cashClosing)}</span></li>
          {withSavings && <><li className="flex items-baseline justify-between gap-2 text-muted-foreground"><span>Savings & investments (estimate)</span><span className="tabular-nums">{money(savingsAt(last))}</span></li><li className="flex items-baseline justify-between gap-2 font-semibold"><span>Cash + savings</span><span className="tabular-nums">{money(closing)}</span></li></>}
        </ul>
      </section>

      {(["expenses", "income", "savings", "debt"] as const).map((section) => {
        const list = biggest(section, 5);
        if (list.length === 0) return null;
        const top = Math.abs(list[0].amount);
        return (
          <section key={section} className="space-y-2">
            <h3 className={heading}>Biggest {section === "expenses" ? "expenses" : section === "income" ? "income" : section === "savings" ? "savings & investments" : "loans & debt"}</h3>
            <ul className="space-y-1.5">
              {list.map(({ row, amount }) => (
                <li key={row.id} className="space-y-0.5">
                  <div className="flex items-baseline justify-between gap-2"><button type="button" onClick={() => onSelectLine(`row:${row.id}`)} className="min-w-0 truncate text-left hover:underline" title={row.name}>{row.name}</button><span className="shrink-0 tabular-nums">{money(amount)}</span></div>
                  <div className="h-1 rounded-full bg-muted" aria-hidden><div className={cn("h-full rounded-full", BAR[section])} style={{ width: `${(Math.abs(amount) / top) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
