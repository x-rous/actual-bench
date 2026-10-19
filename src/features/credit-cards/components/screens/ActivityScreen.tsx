"use client";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClearedHeader, ClearedStatus } from "@/components/ui/cleared-status";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PillGroup } from "@/components/ui/pill-group";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { compareValues } from "@/components/ui/sortable-header";
import { activityCategoryLabel, type ActivityRow, type ActivitySnapshot } from "../../lib/activity";
import type { RepaymentPlan, Statement, TransactionType, Workspace } from "../../lib/models";
import { formatCardDate } from "../../lib/displayDates";
import { sourceLabels, typeChoices, typeLabel, typeLabels } from "../../lib/classifications";
import { familyOf, isCreditKind } from "../../lib/derive/families";
import { transactionType, type TypeResolution } from "../../lib/derive/types";
import { statementReview } from "../../lib/statements";
import { creditCardStore } from "../../lib/store/store";
import type { CardEntry } from "../cardEntry";
import { TypeChip } from "../TypeChip";
import { amountClass, planOf } from "../planLink";
import { TypeMenu } from "../TypeMenu";
import { PlanLinkDialog } from "../PlanLinkDialog";
import { DataTable, Notes, Text, type Column, type SortState } from "../primitives/DataTable";
import { MISSING, money, plural, shortDate } from "../primitives/format";

export type TypeFilter = "all" | "purchases" | "payments" | "credits" | "costs" | "plans" | "suggested";

type View = {
  row: ActivityRow;
  type: TypeResolution;
  category: string;
  statement: Statement | null;
  current: boolean;
  plan: RepaymentPlan | null;
  role: string;
  via: string;
  search: string;
};

type Props = {
  budget: string;
  entry: CardEntry;
  workspace: Workspace;
  snapshot: ActivitySnapshot;
  available: boolean;
  /** A statement id, or "current" for the cycle not on a statement yet. */
  statementFilter: string | null;
  planFilter: string | null;
  typeFilter: string | null;
  onFilters: (patch: { in?: string | null; plan?: string | null; view?: string | null }) => void;
  onMappings: () => void;
  onMakePlan: (rowId: string) => void;
  onOpenPlan: (planId: string) => void;
};

const ROW_HEIGHT = 30;


const TYPE_FILTERS: Record<Exclude<TypeFilter, "all">, (view: View) => boolean> = {
  purchases: (view) => familyOf(view.type.kind) === "charge",
  payments: (view) => familyOf(view.type.kind) === "payment",
  credits: (view) => isCreditKind(view.type.kind, view.row.amountMinor),
  costs: (view) => familyOf(view.type.kind) === "interest" || familyOf(view.type.kind) === "fee",
  plans: (view) => Boolean(view.plan) || familyOf(view.type.kind) === "plan",
  suggested: (view) => view.type.source === "suggested",
};

/**
 * Activity (§9.9, D30): every card transaction with its type, statement and plan. Rows are one line
 * (36 px) and virtualised; the table is one tab stop. / searches, ↑/↓ move, Space selects, T opens the
 * shared type menu.
 */
export function ActivityScreen(props: Props) {
  const { budget, entry, workspace, snapshot, available, statementFilter, planFilter, typeFilter, onFilters, onMappings, onMakePlan, onOpenPlan } = props;
  const { card, name, today } = entry;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "date", direction: "desc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ row: ActivityRow; anchor: Element } | null>(null);
  const [linking, setLinking] = useState<string[] | null>(null);
  const [bulk, setBulk] = useState(false);
  const searchBox = useRef<HTMLDivElement>(null);
  const plans = workspace.plans.filter((plan) => plan.cardId === card.id);
  const { statements, views } = useMemo(() => {
    const statements = workspace.statements
      .filter((item) => item.cardId === card.id && !item.estimate)
      .sort((a, b) => b.closingDate.localeCompare(a.closingDate));
    const onStatement = new Map<string, Statement>();
    for (const statement of statements) {
      const review = statementReview(statement, workspace, snapshot);
      review.rows.forEach((row, index) => {
        if (review.memberships[index].decision === "included" && !onStatement.has(row.id)) onStatement.set(row.id, statement);
      });
    }
    const latest = statements[0]?.closingDate ?? "";
    const views = snapshot.rows.map((row): View => {
      const type = transactionType(row, card, workspace, snapshot);
      const statement = onStatement.get(row.id) ?? null;
      const { plan, role, via } = planOf(row, card, workspace, snapshot);
      const category = activityCategoryLabel(row, snapshot);
      const search = [row.label, row.notes ?? "", category, typeLabel(type.kind, row.amountMinor), sourceLabels[type.source],
        plan?.name ?? "", statement ? formatCardDate(statement.closingDate) : "current cycle", formatCardDate(row.date), money(row.amountMinor)]
        .join(" ").toLowerCase();
      return { row, type, category, statement, current: !statement && row.date > latest, plan, role, via, search };
    });
    return { statements, views };
  }, [card, workspace, snapshot]);
  const filter = (typeFilter ?? "all") as TypeFilter;
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const value = (view: View) => (sort.key === "amount" ? view.row.amountMinor : sort.key === "payee" ? view.row.label
      : sort.key === "type" ? typeLabel(view.type.kind, view.row.amountMinor) : view.row.date);
    return views
      .filter((view) => (statementFilter === "current" ? view.current : !statementFilter || view.statement?.id === statementFilter)
        && (!planFilter || view.plan?.id === planFilter)
        && (filter === "all" || TYPE_FILTERS[filter](view))
        && (!needle || view.search.includes(needle)))
      .sort((a, b) => compareValues(value(a), value(b), sort.direction) || b.row.date.localeCompare(a.row.date) || a.row.id.localeCompare(b.row.id));
  }, [views, statementFilter, planFilter, filter, search, sort]);
  const count = (key: Exclude<TypeFilter, "all">) => views.filter(TYPE_FILTERS[key]).length;
  const filtered = Boolean(search.trim() || statementFilter || planFilter || filter !== "all");
  const clearFilters = () => {
    setSearch("");
    setSelected(new Set());
    onFilters({ in: null, plan: null, view: null });
  };
  const selectedRows = snapshot.rows.filter((row) => selected.has(row.id));
  const toggle = (ids: string[], checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    for (const id of ids) if (checked) next.add(id); else next.delete(id);
    return next;
  });
  const openMenu = (row: ActivityRow, from: Element | null) => {
    const anchor = from?.querySelector("[data-type-chip]") ?? from;
    if (anchor) setMenu({ row, anchor });
  };
  const label = (row: ActivityRow) => `${row.label.trim() || "No payee"} · ${formatCardDate(row.date)} · ${money(row.amountMinor)}`;

  const columns: Column<View>[] = [
    {
      key: "select", header: "Select", hiddenHeader: true, width: 36, align: "center",
      cell: (view) => <Checkbox tabIndex={-1} aria-label={`Select ${label(view.row)}`} disabled={!available}
        checked={selected.has(view.row.id)} onCheckedChange={(checked) => toggle([view.row.id], checked)} />,
    },
    { key: "date", header: "Date", width: 84, sortable: true, cell: (view) => shortDate(view.row.date, today) },
    { key: "payee", header: "Payee", width: 240, sortable: true, cell: (view) => <Text>{view.row.label.trim() || MISSING}</Text> },
    { key: "notes", header: "Notes", width: 300, grow: true, cell: (view) => <Notes notes={view.row.notes} /> },
    { key: "category", header: "Category", width: 290, cell: (view) => <Text>{view.category}</Text> },
    {
      key: "type", header: "Type", width: 130, sortable: true,
      description: "How Bench counts the transaction: dotted = suggested, plain = from category, solid ✓ = set by you. T changes it.",
      cell: (view) => <button
        type="button"
        tabIndex={-1}
        data-type-chip
        className="block max-w-full text-left"
        aria-label={`Change type of ${label(view.row)}`}
        title={`${sourceLabels[view.type.source]} · ${view.type.reason}`}
        onClick={(event) => openMenu(view.row, event.currentTarget)}
      ><TypeChip type={view.type} amountMinor={view.row.amountMinor} /></button>,
    },
    {
      key: "amount", header: "Amount", width: 110, align: "right", sortable: true,
      cell: (view) => <span className={amountClass(view.type.kind, view.row.amountMinor)}>{money(view.row.amountMinor)}</span>,
    },
    {
      key: "cleared", header: "Cleared", headerIcon: <ClearedHeader />, width: 44, align: "center",
      cell: (view) => <ClearedStatus cleared={view.row.cleared} />,
    },
    { key: "statement", header: "Statement", width: 110,
      cell: (view) => (view.statement ? shortDate(view.statement.closingDate, today) : view.current ? "Current cycle" : MISSING) },
    ...(plans.length ? [{
      key: "plan", header: "Plan", width: 140,
      cell: (view: View) => (view.plan
        ? <button type="button" tabIndex={-1} className="block max-w-full truncate text-left hover:underline" title={`${view.plan.name} · ${view.role} · ${view.via}`}
          onClick={() => onOpenPlan(view.plan!.id)}>{view.plan.name} · {view.role}</button>
        : MISSING),
    }] : []),
  ];
  const choices = selectedRows.length
    ? typeChoices(selectedRows[0]).filter((choice) => selectedRows.every((row) => typeChoices(row).includes(choice)))
    : [];

  return <div
    className="relative flex min-h-0 flex-1 flex-col"
    onKeyDown={(event) => {
      if (event.key === "/" && !(event.target as HTMLElement).closest("input, textarea")) {
        event.preventDefault();
        searchBox.current?.querySelector("input")?.focus();
      }
    }}
  >
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
      <div ref={searchBox}>
        <SearchInput size="sm" className="w-48" aria-label={`Search activity for ${name}`} value={search} onValueChange={setSearch} />
      </div>
      <Select
        size="sm"
        className="w-52"
        aria-label="Statement"
        value={statementFilter ?? ""}
        onValueChange={(value) => { setSelected(new Set()); onFilters({ in: value || null }); }}
        options={[
          { value: "", label: "All statements" },
          { value: "current", label: "Current cycle" },
          ...statements.map((statement) => ({ value: statement.id, label: `${formatCardDate(statement.closingDate)} · ${money(statement.balanceMinor)}` })),
        ]}
      />
      {plans.length > 0 && <Select
        size="sm"
        className="w-40"
        aria-label="Plan"
        value={planFilter ?? ""}
        onValueChange={(value) => onFilters({ plan: value || null })}
        options={[{ value: "", label: "Any plan" }, ...plans.map((plan) => ({ value: plan.id, label: plan.name }))]}
      />}
      <PillGroup<TypeFilter>
        value={filter}
        onChange={(value) => onFilters({ view: value === "all" ? null : value })}
        options={[
          { value: "all", label: "All", count: views.length },
          { value: "purchases", label: "Purchases", count: count("purchases") },
          { value: "payments", label: "Payments", count: count("payments") },
          { value: "credits", label: "Credits", count: count("credits") },
          { value: "costs", label: "Interest & fees", count: count("costs") },
          { value: "plans", label: "Plans", count: count("plans") },
          { value: "suggested", label: "Suggested", count: count("suggested") },
        ]}
      />
      {filter === "suggested" && rows.length > 0 && <Button
        size="xs"
        variant="outline"
        disabled={!available}
        onClick={() => {
          void creditCardStore.getState().setTypes(budget, card.id, snapshot, rows.map((view) => ({ transactionId: view.row.id, kind: view.type.kind })))
            .catch(() => undefined);
        }}
      >Accept {plural(rows.length, "suggestion")}</Button>}
      <span className="ml-auto text-xs text-muted-foreground" role="status">
        {filtered ? `${rows.length} of ${plural(views.length, "transaction")}` : plural(views.length, "transaction")}
      </span>
      {filtered && <Button size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button>}
      <Button size="sm" variant="outline" onClick={onMappings}>Category mappings</Button>
    </div>
    {selectedRows.length > 0 && <div role="region" aria-label="Selected transactions"
      className="flex shrink-0 items-center gap-2 border-b bg-muted/50 px-4 py-1.5 text-sm">
      <span className="font-medium">{selectedRows.length} selected</span>
      <span className="text-xs text-muted-foreground">· in this view</span>
      <Button size="xs" variant="outline" disabled={!available || !choices.length} onClick={() => setBulk(true)}>Set type</Button>
      {plans.length > 0 && <Button size="xs" variant="outline" disabled={!available}
        onClick={() => setLinking(selectedRows.map((row) => row.id))}>Link to plan</Button>}
      <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>Clear selection</Button>
    </div>}
    <DataTable<View>
      label={`Activity for ${name}`}
      dense
      columns={columns}
      rows={rows}
      rowKey={(view) => view.row.id}
      rowLabel={(view) => label(view.row)}
      rowHeight={ROW_HEIGHT}
      sort={sort}
      onSort={setSort}
      onRowKeys={(event, view) => {
        if (event.key === " " && available) {
          toggle([view.row.id], !selected.has(view.row.id));
          return true;
        }
        if (event.key.toLowerCase() === "t") {
          openMenu(view.row, event.currentTarget);
          return true;
        }
        return false;
      }}
      empty={views.length ? <>No results match your filters. <Button size="xs" variant="link" onClick={clearFilters}>Clear filters</Button></>
        : "No activity in the loaded history."}
    />
    {menu && <TypeMenu
      budget={budget}
      card={card}
      row={menu.row}
      workspace={workspace}
      snapshot={snapshot}
      available={available}
      anchor={menu.anchor}
      onClose={() => setMenu(null)}
      onMakePlan={onMakePlan}
      onLinkPlan={plans.length ? setLinking : undefined}
    />}
    {linking && <PlanLinkDialog
      budget={budget}
      card={card}
      rows={snapshot.rows.filter((row) => linking.includes(row.id))}
      workspace={workspace}
      snapshot={snapshot}
      available={available}
      onClose={() => { setLinking(null); setSelected(new Set()); }}
    />}
    {bulk && <BulkType
      choices={choices}
      count={selectedRows.length}
      available={available}
      onClose={() => setBulk(false)}
      onApply={async (kind) => {
        await creditCardStore.getState().setTypes(budget, card.id, snapshot, selectedRows.map((row) => ({ transactionId: row.id, kind })));
        setBulk(false);
        setSelected(new Set());
      }}
    />}
  </div>;
}

function BulkType({ choices, count, available, onClose, onApply }: {
  choices: TransactionType[]; count: number; available: boolean; onClose: () => void; onApply: (kind: TransactionType) => Promise<void>;
}) {
  const [kind, setKind] = useState<TransactionType>(choices[0]);
  const [error, setError] = useState("");
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogTitle>Set type for {plural(count, "transaction")}</DialogTitle>
      <DialogDescription>All of them are saved together, or none are. The Actual category doesn&apos;t change.</DialogDescription>
      <Select aria-label="Type" value={kind} onValueChange={(value) => setKind(value as TransactionType)}
        options={choices.map((value) => ({ value, label: typeLabels[value] }))} />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!available} onClick={() => {
          onApply(kind).catch((cause) => setError(cause instanceof Error ? cause.message : "Couldn't set the type"));
        }}>Set type</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
