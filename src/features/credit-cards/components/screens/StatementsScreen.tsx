"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ListChecks, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";
import { SearchInput } from "@/components/ui/search-input";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { daysBetween } from "@/lib/financial-models/calendar/dates";
import type { Statement, Workspace } from "../../lib/models";
import { statementBreakdown, type StatementBreakdown } from "../../lib/derive/breakdown";
import type { StatementRow } from "../../lib/derive/cardView";
import { observedChargeTotals } from "../../lib/history";
import { sumMinor } from "../../lib/statements";
import { formatCardDate } from "../../lib/displayDates";
import { CardMenuContent } from "../CardMenuContent";
import type { CardEntry } from "../cardEntry";
import { DataTable, GROUP_ROW_HEIGHT, HEADER_ROW_HEIGHT, type Column, type TableController } from "../primitives/DataTable";
import { StatusBadge } from "../primitives/StatusBadge";
import { MISSING, money, plural, shortDate } from "../primitives/format";
import { StatementPanel } from "./StatementPanel";

export type StatementFilter = "all" | "attention" | "unpaid" | "estimates";
export type StatementAction = "reset" | "delete";

type Props = {
  entry: CardEntry;
  workspace: Workspace;
  eligible: boolean;
  filter: StatementFilter;
  onFilter: (filter: StatementFilter) => void;
  /** The statement in the side panel. */
  panelId: string | null;
  onPanel: (id: string | null) => void;
  onEnter: (statement?: Statement) => void;
  onEdit: (statement: Statement) => void;
  onReview: (statement: Statement) => void;
  onAction: (kind: StatementAction, statement: Statement) => void;
  onPayment: (id: string) => void;
  /** The statement just reviewed: its row gets focus when the table returns. */
  focusId?: string | null;
};

type Line = StatementRow & { breakdown: StatementBreakdown | null };

/** When the amount due was paid against the due date (§9.4), with the date abbreviated. */
function AgainstDueDate({ row, today }: { row: StatementRow; today: string }) {
  const { statement, payment } = row;
  if (statement.estimate || row.startingPoint || !payment?.known || payment.amountDueMinor === 0) return <>{MISSING}</>;
  const due = statement.dueDate;
  const late = (date: string) => daysBetween(due, date);
  if (payment.paidDate) {
    const days = late(payment.paidDate);
    return days > 0
      ? <span className="text-amber-700 dark:text-amber-400">{shortDate(payment.paidDate, today)} · {plural(days, "day")} late</span>
      : <span className="text-green-700 dark:text-green-400">{shortDate(payment.paidDate, today)} · on time</span>;
  }
  if (payment.pendingByDue) return <span className="text-amber-700 dark:text-amber-400">Pending · not cleared yet</span>;
  if (due >= today) return <>{MISSING}</>;
  if (row.status.key === "not-paid") return <span className="text-amber-700 dark:text-amber-400">Not paid · in the next statement</span>;
  if (payment.minimumPaidDate && payment.minimumPaidDate <= due) {
    return <span className="text-amber-700 dark:text-amber-400">{shortDate(payment.minimumPaidDate, today)} · minimum only</span>;
  }
  return <span className="text-red-700 dark:text-red-400">{plural(late(today), "day")} overdue · {payment.paidMinor > 0 ? "part paid" : "unpaid"}</span>;
}

export function statementLabel(row: StatementRow) {
  const kind = row.statement.estimate ? "Estimated statement" : "Statement";
  return `${kind} ${formatCardDate(row.statement.closingDate)} · ${row.status.label} · ${row.match.label}`;
}

/**
 * Statements (§9.4): the one statement table (the timeline was removed by the owner, 18 Oct 2026). Every statement-level
 * figure is in the table; the panel holds the transaction-level evidence.
 */
export function StatementsScreen(props: Props) {
  const { entry, workspace, eligible, filter, onFilter, panelId, onPanel, onEnter, onEdit, onReview, onAction, onPayment, focusId } = props;
  const { card, view, snapshot, today, name } = entry;
  const [search, setSearch] = useState("");
  const table = useRef<TableController | null>(null);
  const searchBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusId) requestAnimationFrame(() => table.current?.focusRow(focusId));
  }, [focusId]);
  const lines: Line[] = useMemo(() => [...view.rows]
    .sort((a, b) => b.statement.closingDate.localeCompare(a.statement.closingDate))
    .map((row) => ({
      ...row,
      breakdown: snapshot && !row.statement.estimate ? statementBreakdown(card, row.statement, view.statementWorkspace, snapshot) : null,
    })), [view, card, snapshot]);
  const counts = {
    all: lines.length,
    attention: lines.filter((row) => row.attention).length,
    unpaid: lines.filter((row) => !row.statement.estimate && (row.payment?.leftToPayMinor ?? 0) > 0).length,
    estimates: lines.filter((row) => row.statement.estimate).length,
  };
  const needle = search.trim().toLowerCase();
  const visible = lines.filter((row) => (filter === "attention" ? row.attention
    : filter === "unpaid" ? !row.statement.estimate && (row.payment?.leftToPayMinor ?? 0) > 0
      : filter === "estimates" ? Boolean(row.statement.estimate) : true)
    && (!needle || [formatCardDate(row.statement.closingDate), formatCardDate(row.statement.dueDate), money(row.statement.balanceMinor),
      row.status.label, row.match.label].join(" ").toLowerCase().includes(needle)));
  const interest = snapshot ? observedChargeTotals(card, workspace, snapshot, today, "interest") : null;
  const fees = snapshot ? observedChargeTotals(card, workspace, snapshot, today, "fee") : null;
  const suggested = (interest?.suggestedCount ?? 0) + (fees?.suggestedCount ?? 0);
  const known = (pick: (row: Line) => number | null | undefined) => {
    const values = visible.filter((row) => row.breakdown?.known && !row.startingPoint).map(pick);
    return values.length && values.every((value) => value != null) ? money(sumMinor(values as number[])) : MISSING;
  };
  const known2 = (row: Line) => (row.breakdown?.known && !row.startingPoint ? row.breakdown : null);
  const blank = (row: Line) => row.startingPoint || row.statement.estimate;

  const money2 = (row: Line, value: number | null | undefined) => (blank(row) ? MISSING : money(value));
  const columns: Column<Line>[] = [
    {
      key: "statement", header: "Statement", width: 96, sticky: "start", description: "The closing date printed on the statement.",
      cell: (row) => <span className={row.statement.estimate ? undefined : "font-medium"}>{shortDate(row.statement.closingDate, today)}</span>,
      footer: "Totals",
    },
    { key: "dueDate", header: "Due", width: 80, description: "The payment due date.", cell: (row) => shortDate(row.statement.dueDate, today) },
    {
      key: "payments", header: "Payments & credits", group: "On the bank statement", width: 128, align: "right",
      description: "Payments and credits printed on this statement; they usually pay the previous bill.",
      cell: (row) => money2(row, known2(row)?.paymentsAndCreditsMinor), footer: known((row) => row.breakdown?.paymentsAndCreditsMinor),
    },
    {
      key: "charges", header: "Charges", group: "On the bank statement", width: 108, align: "right",
      description: "Debits printed on this statement other than interest and fees, plan instalments included.",
      cell: (row) => money2(row, known2(row)?.chargesMinor), footer: known((row) => row.breakdown?.chargesMinor),
    },
    {
      key: "costs", header: "Interest & fees", group: "On the bank statement", width: 108, align: "right",
      description: "Interest and fees printed on this statement, net of refunds. Suggested ones count once accepted.",
      cell: (row) => money2(row, known2(row)?.interestAndFeesMinor), footer: known((row) => row.breakdown?.interestAndFeesMinor),
    },
    {
      key: "balance", header: "Statement balance", group: "On the bank statement", width: 128, align: "right",
      description: "The closing balance printed on the statement.",
      cell: (row) => <span className={row.statement.estimate ? undefined : "font-semibold"}>{money(row.statement.balanceMinor)}</span>,
    },
    {
      key: "due", header: "Amount due", group: "This bill", width: 108, align: "right", description: "What the bank asks you to pay by the due date.",
      cell: (row) => money2(row, row.payment?.amountDueMinor),
    },
    {
      key: "minimum", header: "Minimum due", group: "This bill", width: 104, align: "right", description: "The smallest payment the bank accepts.",
      cell: (row) => money2(row, row.statement.minimumDueMinor),
    },
    {
      key: "paid", header: "Paid", group: "This bill", width: 104, align: "right",
      description: "Payments toward this bill, wherever they were printed. Amber includes payments not cleared in Actual yet.",
      cell: (row) => {
        if (blank(row) || !row.payment?.known) return MISSING;
        const pending = row.payment.pendingMinor;
        if (!pending) return money(row.payment.paidMinor);
        return <span className="text-amber-700 dark:text-amber-400" title={`${money(row.payment.paidMinor)} cleared · ${money(pending)} pending`}>
          {money(row.payment.paidMinor + pending)}<span className="sr-only">, of which {money(pending)} pending</span>
        </span>;
      },
      footer: known((row) => (row.payment?.known ? row.payment.paidMinor + row.payment.pendingMinor : null)),
    },
    {
      key: "left", header: "Left to pay", group: "This bill", width: 108, align: "right", description: "Amount due minus Paid.",
      cell: (row) => <span className="font-medium">{money2(row, row.payment?.leftToPayMinor)}</span>,
    },
    {
      key: "againstDue", header: "Payment against due date", group: "This bill", width: 190,
      description: "When the amount due was paid, compared with the due date.",
      cell: (row) => <AgainstDueDate row={row} today={today} />,
    },
    {
      key: "payment", header: "Payment", group: "Status", width: 140, description: "Whether this bill is paid, and when.",
      cell: (row) => <StatusBadge label={row.status.label} tone={row.status.tone} line={row.status.line} />,
    },
    {
      key: "match", header: "Bank match", group: "Status", width: 140, description: "Whether the transactions on this statement add up to its balance.",
      cell: (row) => <StatusBadge label={row.match.label} tone={row.match.tone} line={row.match.line} />,
    },
    {
      key: "next", header: "Next step", hiddenHeader: true, width: 84, align: "center",
      cell: (row) => (row.statement.estimate
        ? row.attention ? <Button tabIndex={-1} size="xs" disabled={!eligible} onClick={() => onEnter(row.statement)}>Verify</Button> : null
        : row.match.attention ? <Button tabIndex={-1} size="xs" disabled={!snapshot} onClick={() => onReview(row.statement)}>Review</Button>
          : <Button tabIndex={-1} size="icon-xs" variant="ghost" disabled={!snapshot} aria-label={`Review transactions of ${formatCardDate(row.statement.closingDate)}`}
            title="Review transactions" onClick={() => onReview(row.statement)}><ListChecks className="size-3.5" aria-hidden /></Button>),
    },
    {
      key: "actions", header: "Actions", hiddenHeader: true, width: 40, sticky: "end", align: "center",
      cell: (row) => <DropdownMenu>
        <DropdownMenuTrigger render={<Button
          data-row-menu
          tabIndex={-1}
          size="icon-xs"
          variant="ghost"
          aria-label={`Actions for statement ${formatCardDate(row.statement.closingDate)}`}
        />}><MoreHorizontal className="size-3.5" /></DropdownMenuTrigger>
        <CardMenuContent>
          <DropdownMenuItem onClick={() => onPanel(row.statement.id)}>Open statement</DropdownMenuItem>
          {row.statement.estimate
            ? <DropdownMenuItem disabled={!eligible} onClick={() => onEnter(row.statement)}>Enter bank figures</DropdownMenuItem>
            : <>
              <DropdownMenuItem disabled={!snapshot} onClick={() => onReview(row.statement)}>Review transactions</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(row.statement)}>Edit bank figures</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction("reset", row.statement)}>Reset review</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onAction("delete", row.statement)}>Delete statement</DropdownMenuItem>
            </>}
        </CardMenuContent>
      </DropdownMenu>,
    },
  ];

  const panelRow = lines.find((row) => row.statement.id === panelId);
  function step(offset: number) {
    const index = visible.findIndex((row) => row.statement.id === panelId);
    const next = visible[index + offset];
    if (next) onPanel(next.statement.id);
  }

  return <div
    className="flex min-h-0 flex-1 flex-col"
    onKeyDown={(event) => {
      if (event.key === "/" && !(event.target as HTMLElement).closest("input, textarea")) {
        event.preventDefault();
        searchBox.current?.querySelector("input")?.focus();
      }
    }}
  >
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
      <div ref={searchBox}>
        <SearchInput size="sm" className="w-48" aria-label={`Search statements for ${name}`} value={search} onValueChange={setSearch} />
      </div>
      <PillGroup<StatementFilter>
        value={filter}
        onChange={onFilter}
        options={[
          { value: "all", label: "All", count: counts.all },
          { value: "attention", label: "Needs attention", count: counts.attention },
          { value: "unpaid", label: "Unpaid", count: counts.unpaid },
          { value: "estimates", label: "Estimates", count: counts.estimates },
        ]}
      />
      {(filter !== "all" || search.trim()) && <>
        <span className="text-xs text-muted-foreground" role="status">{visible.length} of {plural(lines.length, "statement")}</span>
        <Button size="sm" variant="ghost" onClick={() => { setSearch(""); onFilter("all"); }}>Clear filters</Button>
      </>}
      <p className="ml-auto text-xs text-muted-foreground">
        Interest <span className="font-medium text-foreground tabular-nums">{money(interest?.totalMinor)}</span>
        {" · "}Fees <span className="font-medium text-foreground tabular-nums">{money(fees?.totalMinor)}</span> (tracked)
        {suggested > 0 && ` · ${plural(suggested, "suggestion")} not counted`}
      </p>
      <Button size="sm" disabled={!eligible} onClick={() => onEnter()}><Plus className="size-3.5" aria-hidden />Enter statement</Button>
    </div>
    <div className="flex min-h-0 flex-1">
      <DataTable<Line>
        label={`Statements for ${name}`}
        columns={columns}
        rows={visible}
        rowKey={(row) => row.statement.id}
        rowLabel={statementLabel}
        activeKey={panelId}
        controller={table}
        compact
        onOpen={(row) => onPanel(row.statement.id)}
        onRowKeys={(event) => {
          if (event.key === "Escape" && panelId) {
            onPanel(null);
            return true;
          }
          return false;
        }}
        rowClassName={(row) => cn(row.statement.estimate && "italic text-muted-foreground")}
        empty={lines.length ? "No statements match these filters." : "No statements yet. Enter your first bank statement to start tracking."}
      />
      {panelRow && <StatementPanel
        key={panelRow.statement.id}
        row={panelRow}
        entry={entry}
        eligible={eligible}
        onClose={() => onPanel(null)}
        returnFocus={() => table.current?.focusRow(panelRow.statement.id)}
        headerHeight={GROUP_ROW_HEIGHT + HEADER_ROW_HEIGHT}
        onStep={step}
        onReview={() => onReview(panelRow.statement)}
        onEnter={() => onEnter(panelRow.statement)}
        onEdit={() => onEdit(panelRow.statement)}
        onAction={(kind) => onAction(kind, panelRow.statement)}
        onPayment={onPayment}
      />}
    </div>
  </div>;
}
