"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LineChart, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { addDays } from "@/lib/financial-models/calendar/dates";
import type { Workspace } from "../../lib/models";
import { sumMinor } from "../../lib/statements";
import { formatCardDate } from "../../lib/displayDates";
import { statementPaymentTotals, netActivitySinceStatement } from "../../lib/insights";
import { observedChargeTotals, observedInterestTotals } from "../../lib/history";
import { commonCoverage, portfolioInterestTrend, portfolioStatementTrend } from "../../lib/portfolioView";
import { trackedDebtPoints } from "../../lib/derive/planAccounts";
import { formatPercentBps } from "../../lib/percent";
import { CardMark } from "../CardIdentity";
import { HistoryChart } from "../HistoryChart";
import type { CardEntry } from "../cardEntry";
import { DataTable, HEADER_ROW_HEIGHT, Stack, type Column, type TableController } from "../primitives/DataTable";
import { attentionSummary, cardAttention } from "../cardAttention";
import { SidePanel } from "../primitives/SidePanel";
import { StatusBadge } from "../primitives/StatusBadge";
import { MISSING, money, ordinal, plural, shortDate } from "../primitives/format";

/** Total owed for a card: plan accounts included; unknown while a plan account is unread. */
function owedOf(entry: CardEntry) {
  if (!entry.balance) return null;
  if (!entry.owed) return entry.balance.debtMinor;
  return entry.owed.known ? entry.owed.owedMinor : null;
}

function capacityOf(entry: CardEntry) {
  if (!entry.balance) return null;
  return entry.owed?.known ? entry.owed.capacitySignedMinor : entry.balance.signedBalanceMinor;
}

type Props = {
  entries: CardEntry[];
  workspace: Workspace;
  /** The card the user came back from; it gets focus again (UI-14). */
  focusCardId: string | null;
  /** Kept by the shell, so the order survives opening a card and coming back. */
  sort: PortfolioSort;
  onSort: (sort: PortfolioSort) => void;
  onOpen: (id: string) => void;
};

export type PortfolioSort = "due" | "debt" | "name";
type StatusFilter = "all" | "attention" | "due-soon" | "overdue" | "paid" | "inactive";
type CardRecord = { entry: CardEntry; row: CardEntry["view"]["rows"][number] | undefined; bank: CardEntry["view"]["bank"]; remaining: number | null };
const STATUS_FILTERS: Record<StatusFilter, (record: CardRecord) => boolean> = {
  all: () => true,
  attention: ({ entry }) => entry.view.attentionCount > 0,
  "due-soon": ({ bank, remaining, entry }) => Boolean(bank && remaining && bank.dueDate >= entry.today && bank.dueDate <= addDays(entry.today, 7)),
  overdue: ({ row }) => Boolean(row?.status.overdue),
  paid: ({ row }) => Boolean(row?.status.paid),
  inactive: ({ entry }) => entry.card.status !== "active",
};

/** A tiny trend for the summary strip: decoration only (the Trends panel has the exact values). */
function Sparkline({ values, bars = false }: { values: (number | null)[]; bars?: boolean }) {
  const known = values.filter((value): value is number => value !== null);
  if (known.length < 2) return null;
  const top = Math.max(...known, 1);
  const bottom = bars ? 0 : Math.min(...known, 0);
  const y = (value: number) => 22 - (value - bottom) / Math.max(1, top - bottom) * 20;
  const step = 96 / Math.max(1, values.length - 1);
  return <svg viewBox="0 0 100 24" className="h-6 w-24 text-chart-1" aria-hidden>
    {bars
      ? values.map((value, index) => value === null ? null
        : <rect key={index} x={index * (96 / values.length) + 2} y={y(value)} width={Math.max(1, 96 / values.length - 2)} height={22 - y(value)} className="fill-chart-5/70" />)
      : <polyline fill="none" stroke="currentColor" strokeWidth="1.5"
        points={values.map((value, index) => (value === null ? null : `${index * step + 2},${y(value)}`)).filter(Boolean).join(" ")} />}
  </svg>;
}

function Figure({ label, value, detail, tone, trend, onTrend }: {
  label: string; value: string; detail?: ReactNode; tone?: "danger"; trend?: ReactNode; onTrend?: () => void;
}) {
  return <div className={cn("relative min-w-0 px-4 py-3", trend && "pr-32")}>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className={cn("mt-0.5 text-xl font-semibold whitespace-nowrap tabular-nums", tone === "danger" && "text-red-700 dark:text-red-400")}>{value}</dd>
    {detail && <dd className="truncate text-xs text-muted-foreground">{detail}</dd>}
    {trend && <dd className="absolute right-4 bottom-3">
      <button type="button" onClick={onTrend} aria-label={`Show ${label} trend`} className="rounded hover:bg-muted">{trend}</button>
    </dd>}
  </div>;
}

/**
 * All cards (§9.7): an edge-to-edge summary strip, then one table of cards with two-line rows.
 * Trends open in a docked panel beside the table, so the page has no tabs and nothing below the list.
 */
export function PortfolioScreen({ entries, workspace, focusCardId, sort, onSort, onOpen }: Props) {
  const [chart, setChart] = useState<"owed" | "statements">("owed");
  const [trends, setTrends] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const needle = search.trim().toLowerCase();
  const table = useRef<TableController | null>(null);
  useEffect(() => {
    if (focusCardId) requestAnimationFrame(() => table.current?.focusRow(focusCardId));
  }, [focusCardId]);
  const cards = entries.map((entry) => entry.card);
  const todays = entries.map((entry) => entry.today);
  const sources = entries.map((entry) => entry.snapshot);
  const trendStatements = entries.flatMap((entry) => entry.view.statements);
  const statementWorkspace = { ...workspace, statements: trendStatements };
  const nameOf = (card: { id: string }) => entries.find((entry) => entry.card.id === card.id)?.name ?? "Card";
  const payments = statementPaymentTotals(cards, statementWorkspace, sources, todays);
  const owed = entries.map(owedOf);
  const knownOwed = owed.filter((value): value is number => value !== null);
  const coverage = commonCoverage(sources, todays);
  // CA-15: one shared date range, so the total never implies coverage some cards don't have.
  const costs = entries.map((entry) => {
    if (!entry.snapshot || !coverage) return null;
    const window = { ...entry.snapshot, ...coverage };
    return [observedInterestTotals(entry.card, workspace, window, entry.today), observedChargeTotals(entry.card, workspace, window, entry.today, "fee")];
  });
  const costsMinor = costs.every(Boolean) ? sumMinor(costs.flatMap((pair) => pair!.map((total) => total.totalMinor))) : null;
  const limited = entries.filter((entry) => entry.limitMinor != null && capacityOf(entry) !== null);
  const totalLimit = sumMinor(limited.map((entry) => entry.limitMinor!));
  const used = sumMinor(limited.map((entry) => Math.max(0, -capacityOf(entry)!)));
  // D17: available credit is kept per card and summed here (derived, not the bank's figure).
  const availableMinor = sumMinor(limited.map((entry) => Math.max(0, entry.limitMinor! + capacityOf(entry)!)));
  const planMinor = sumMinor(entries.map((entry) => (entry.owed?.known && entry.owed.hasPlanAccounts ? entry.owed.inPlanAccountsMinor : 0)));
  const all = entries.map((entry) => {
    const bank = entry.view.bank;
    const row = entry.view.rows.find((item) => item.statement.id === bank?.id);
    const payment = entry.view.nextPayment;
    return { entry, bank, row, remaining: payment?.leftToPayMinor ?? null, minimum: payment?.minimumLeftMinor ?? null, owedMinor: owedOf(entry) };
  });
  const records = all.filter((record) => STATUS_FILTERS[status](record) && (!needle || record.entry.name.toLowerCase().includes(needle))).sort((a, b) => {
    if (sort === "name") return a.entry.name.localeCompare(b.entry.name);
    if (sort === "debt") return (b.owedMinor ?? -1) - (a.owedMinor ?? -1);
    const due = (record: typeof a) => (record.bank && ((record.remaining ?? 0) > 0 || (record.minimum ?? 0) > 0) ? record.bank.dueDate : "9999");
    return due(a).localeCompare(due(b)) || a.entry.name.localeCompare(b.entry.name);
  });
  type Record = (typeof records)[number];
  const dueWithin = (days: number) => sumMinor(all.filter((record) => record.bank && record.remaining && record.bank.dueDate >= record.entry.today
    && record.bank.dueDate <= addDays(record.entry.today, days)).map((record) => record.remaining!));
  const dueSoon = dueWithin(7);
  const overdue = all.filter((record) => record.row?.status.overdue);
  const partial = payments.coverage < cards.length ? `${payments.coverage} of ${cards.length} cards known` : null;
  const trend = portfolioStatementTrend(cards, trendStatements, nameOf);
  const debtDates = [...new Set([...trendStatements.map((entry) => entry.closingDate), ...todays])].sort();
  // One reconstruction pass per card over every date (O(days + rows)), not one per date.
  const series = entries.map((entry) => (entry.snapshot && entry.balance
    ? new Map(trackedDebtPoints(entry.card, workspace, entry.snapshot, entry.balance.signedBalanceMinor, debtDates).map((point) => [point.date, point]))
    : null));
  const owedTrend = debtDates.map((date) => {
    const points = series.map((byDate) => byDate?.get(date) ?? null);
    return { date, value: points.every((point) => point?.valueMinor != null) ? sumMinor(points.map((point) => point!.valueMinor!)) : null };
  });
  const interestTrend = portfolioInterestTrend(cards, workspace, sources, todays, nameOf);
  const showInterest = interestTrend.some((point) => point.value !== null && point.value !== 0);

  const usedOf = (entry: CardEntry) => {
    const capacity = capacityOf(entry);
    return capacity === null || !entry.limitMinor ? null : { capacity, percent: Math.max(0, -capacity) / entry.limitMinor * 100 };
  };
  // Last verified: the latest saved statement whose transactions match the bank balance.
  const verifiedOn = (entry: CardEntry) => entry.view.rows
    .filter((item) => !item.statement.estimate && item.match.key === "matches")
    .map((item) => item.statement.closingDate).sort().at(-1) ?? null;
  const termsOf = (entry: CardEntry) => [
    entry.limitMinor != null ? `Limit ${money(entry.limitMinor)}` : null,
    entry.card.purchaseAprBps != null ? `${formatPercentBps(entry.card.purchaseAprBps)}% APR` : null,
    entry.card.closingDay ? `closes ${ordinal(entry.card.closingDay)}` : null,
  ].filter(Boolean).join(" · ") || "Set the card's terms in Settings";
  // Two-line rows (DESIGN §4.1 summary lists): line 1 is the figure to scan; line 2 is a related,
  // self-labelled figure, the same kind of fact on every row. Badges never carry text under them.
  const columns: Column<Record>[] = [
    {
      key: "card", header: "Card", width: 320, grow: true,
      cell: ({ entry }) => <div className="flex min-w-0 items-center gap-3" title={`${entry.name} · ${termsOf(entry)}`}>
        <CardMark card={entry.card} />
        <Stack primary={<span className="font-medium">{entry.name}{entry.card.status !== "active" ? " (inactive)" : ""}</span>} secondary={termsOf(entry)} />
      </div>,
    },
    {
      key: "next", header: "Next payment", width: 190,
      cell: ({ row }) => (row ? <StatusBadge label={row.status.label} tone={row.status.tone} line={row.status.line} />
        : <span className="text-muted-foreground">No statement</span>),
    },
    { key: "due", header: "Due date", width: 90, cell: ({ bank, entry }) => (bank ? shortDate(bank.dueDate, entry.today) : MISSING) },
    {
      key: "left", header: "Left to pay", width: 140, align: "right",
      cell: ({ remaining, minimum }) => <Stack strong primary={money(remaining)} secondary={`minimum ${money(minimum)}`} />,
    },
    {
      key: "balance", header: "Statement balance", width: 150, align: "right",
      description: "The latest bank statement, and the latest statement whose transactions match the bank.",
      cell: ({ bank, entry }) => {
        const verified = verifiedOn(entry);
        return <Stack primary={money(bank?.balanceMinor)} secondary={verified ? `verified ${shortDate(verified, entry.today)}` : "not verified"} />;
      },
    },
    {
      key: "owed", header: "Total owed", width: 190, align: "right",
      cell: ({ entry, bank, owedMinor }) => {
        const bridge = bank && entry.snapshot && entry.balance
          ? netActivitySinceStatement(entry.card, bank, workspace, entry.snapshot, entry.balance.rawSignedBalanceMinor, entry.today) : null;
        return <Stack strong primary={money(owedMinor)}
          secondary={bridge ? `${bridge.netMinor > 0 ? "+" : ""}${money(bridge.netMinor)} since statement` : MISSING} />;
      },
    },
    {
      key: "plans", header: "In plan accounts", width: 150, align: "right",
      description: "Plan principal held in plan accounts in Actual; part of Total owed.",
      cell: ({ entry }) => {
        const count = workspace.plans.filter((plan) => plan.cardId === entry.card.id && plan.status === "active" && plan.recordedAs === "plan-account").length;
        if (!count || !entry.owed?.hasPlanAccounts) return MISSING;
        return <Stack primary={money(entry.owed.known ? entry.owed.inPlanAccountsMinor : null)} secondary={plural(count, "plan")} />;
      },
    },
    {
      key: "used", header: "Credit used", width: 220,
      cell: ({ entry }) => {
        const used = usedOf(entry);
        if (!used) return <span className="text-muted-foreground">{entry.balance ? "No limit set" : MISSING}</span>;
        return <div className="min-w-0">
          <div className="flex h-5 items-center gap-2">
            <span className="h-1.5 min-w-8 flex-1 rounded-full bg-muted" aria-hidden>
              <span className="block h-1.5 rounded-full bg-foreground/70" style={{ width: `${Math.min(100, used.percent)}%` }} />
            </span>
            <span className="w-9 shrink-0 text-right">{Math.round(used.percent)}%</span>
          </div>
          <div className="truncate text-xs leading-4 text-muted-foreground">
            {money(Math.max(0, entry.limitMinor! + used.capacity))} available
          </div>
        </div>;
      },
    },
    {
      key: "attention", header: "Needs attention", width: 220,
      description: "The same items as the card's Overview: statements to check or enter, and plan problems.",
      cell: ({ entry }) => {
        const items = cardAttention(entry, workspace);
        const text = attentionSummary(items);
        if (!text) return MISSING;
        const urgent = items[0].rank === 0;
        return <span title={items.map((item) => item.text).join("\n")} className={cn("flex min-w-0 items-center gap-1.5",
          urgent ? "text-red-700 dark:text-red-400" : "text-amber-800 dark:text-amber-300")}>
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{text}</span>
        </span>;
      },
    },
  ];
  const filtered = Boolean(needle) || status !== "all";

  return <div className="flex min-h-0 flex-1 flex-col">
    <dl aria-label="All cards" className="grid shrink-0 grid-cols-2 divide-x border-b md:grid-cols-3 xl:grid-cols-5">
      <Figure label="Total owed" value={money(knownOwed.length ? sumMinor(knownOwed) : null)}
        detail={knownOwed.length < cards.length ? `${knownOwed.length} of ${cards.length} cards known`
          : planMinor ? `incl. ${money(planMinor)} in plan accounts` : undefined}
        trend={<Sparkline values={owedTrend.slice(-12).map((point) => point.value)} />} onTrend={() => { setChart("owed"); setTrends(true); }} />
      <Figure label="Left to pay" tone={overdue.length ? "danger" : undefined} value={money(payments.coverage ? payments.remainingMinor : null)}
        detail={overdue.length ? `${plural(overdue.length, "card")} overdue` : partial ?? `${money(dueSoon)} due in 7 days`} />
      <Figure label="Minimum left" value={money(payments.coverage ? payments.minimumMinor : null)}
        detail={payments.overdueMinimumMinor > 0 ? `${money(payments.overdueMinimumMinor)} overdue` : undefined} />
      <Figure label="Available credit" value={money(limited.length ? availableMinor : null)}
        detail={totalLimit ? `${Math.round(used / totalLimit * 100)}% used of total limits ${money(totalLimit)}` : "No limits set"} />
      <Figure label="Interest & fees" value={money(costsMinor)}
        detail={coverage ? `${formatCardDate(coverage.from)} – ${formatCardDate(coverage.to)}` : "No shared history yet"}
        trend={showInterest ? <Sparkline bars values={interestTrend.slice(-12).map((point) => point.value)} /> : undefined}
        onTrend={() => setTrends(true)} />
    </dl>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
      <SearchInput size="sm" className="w-56" aria-label="Search cards" value={search} onValueChange={setSearch} />
      <Select size="sm" className="w-44" aria-label="Status" value={status} onValueChange={(value) => setStatus(value as StatusFilter)} options={[
        { value: "all", label: "All cards" }, { value: "attention", label: "Needs attention" }, { value: "due-soon", label: "Due in 7 days" },
        { value: "overdue", label: "Overdue" }, { value: "paid", label: "Paid in full" }, { value: "inactive", label: "Inactive" },
      ]} />
      <Select size="sm" className="w-40" aria-label="Sort" value={sort} onValueChange={(value) => onSort(value as PortfolioSort)} options={[
        { value: "due", label: "Next due first" }, { value: "debt", label: "Largest owed" }, { value: "name", label: "Name" },
      ]} />
      {filtered && <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setStatus("all"); }}>Clear filters</Button>}
      <Button size="sm" variant="outline" aria-pressed={trends} onClick={() => setTrends(!trends)}><LineChart className="size-3.5" aria-hidden />Trends</Button>
      <p className="ml-auto text-xs text-muted-foreground" role="status">
        {filtered ? `${records.length} of ${plural(cards.length, "card")}` : plural(cards.length, "card")}
        {" · "}<span className="font-medium text-foreground tabular-nums">{money(knownOwed.length ? sumMinor(knownOwed) : null)}</span> owed
        {" · "}<span className="font-medium text-foreground tabular-nums">{money(dueWithin(30))}</span> due in the next 30 days
      </p>
    </div>
    <div className="flex min-h-0 flex-1">
      <DataTable<Record>
        label="Cards"
        stacked
        columns={columns}
        rows={records}
        rowKey={({ entry }) => entry.card.id}
        rowLabel={({ entry, row, remaining }) => `${entry.name} · ${row?.status.label ?? "No statement"} · ${money(remaining)} left to pay`}
        onOpen={({ entry }) => onOpen(entry.card.id)}
        controller={table}
        empty={filtered ? "No results match your filters." : "No cards yet."}
      />
      {trends && <SidePanel title="Trends" description="All cards" headerHeight={HEADER_ROW_HEIGHT} onClose={() => setTrends(false)} className="w-[520px]">
        <div className="space-y-4 p-4">
          <div role="group" aria-label="Chart" className="inline-flex overflow-hidden rounded-md border text-xs">
            {([["owed", "Total owed"], ["statements", "Statement balances"]] as const).map(([key, label]) => <button
              key={key}
              type="button"
              aria-pressed={chart === key}
              onClick={() => setChart(key)}
              className={cn("h-7 px-2.5 font-medium", chart === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >{label}</button>)}
          </div>
          <HistoryChart title={chart === "owed" ? "Total owed over time" : "Statement balances"} points={chart === "owed" ? owedTrend : trend} monthly kind="line" />
          {showInterest && <HistoryChart title="Interest charged by month" points={interestTrend} monthly allowSingle tone="interest" kind="bar" />}
        </div>
      </SidePanel>}
    </div>
  </div>;
}
