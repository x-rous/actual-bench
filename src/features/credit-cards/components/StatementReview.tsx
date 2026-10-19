"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, CircleCheck, Info, Landmark, LockKeyhole, MoreHorizontal, TriangleAlert } from "lucide-react";
import { ClearedHeader, ClearedStatus } from "@/components/ui/cleared-status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PillGroup } from "@/components/ui/pill-group";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { activityCategoryLabel, type ActivityRow, type ActivitySnapshot } from "../lib/activity";
import type { Statement, TransactionType, TypeCorrection, Workspace } from "../lib/models";
import { formatCardDate, formatStatementPeriod } from "../lib/displayDates";
import { planEligibleKinds, typeLabel } from "../lib/classifications";
import { statementBreakdown } from "../lib/derive/breakdown";
import { planForTransaction } from "../lib/derive/indexes";
import { bankMatchFor } from "../lib/derive/status";
import { transactionType } from "../lib/derive/types";
import { creditCardStore, type ReviewAnswer, type TypeChange } from "../lib/store/store";
import { draftDecisions, statementReview, sumMinor, type Membership, type StatementMove } from "../lib/statements";
import { useDiscardChanges } from "../hooks/useDiscardChanges";
import { CardMenuContent } from "./CardMenuContent";
import { TypeChip } from "./TypeChip";
import { amountClass, PlanMark, planOf } from "./planLink";
import { TypeMenu } from "./TypeMenu";
import type { CardEntry } from "./cardEntry";
import { DataTable, Notes, Text, type Column } from "./primitives/DataTable";
import { MISSING, money, plural, shortDate } from "./primitives/format";

type Props = {
  budget: string;
  statement: Statement;
  entry: CardEntry;
  workspace: Workspace;
  snapshot: ActivitySnapshot;
  available: boolean;
  /** Actual is being read again: figures stay, the strip says so (UI-2). */
  refreshing?: boolean;
  onClose: () => void;
  /** Opens the bank figures editor for this statement (after discarding unsaved answers). */
  onEditFigures?: () => void;
  onMakePlan?: (rowId: string) => void;
  onOpenPlan?: (planId: string) => void;
  /** Workspace tools (read status, Refresh, Help) shown at the end of the title row. */
  tools?: ReactNode;
};

type Decision = ReviewAnswer["decision"];
type Filter = "review" | "included" | "excluded" | "all";
const ANSWERS: { value: Decision; label: string; text: string }[] = [
  { value: "included", label: "Yes", text: "On this statement" },
  { value: "excluded", label: "No", text: "Not on this statement" },
  { value: "review", label: "?", text: "Unsure" },
];

/** Staged type changes as they would be saved, so the strip and badge reflect them before Save. */
function stagedTypes(workspace: Workspace, cardId: string, snapshot: ActivitySnapshot, types: Record<string, TypeChange>): Workspace {
  const changes = Object.values(types);
  if (!changes.length) return workspace;
  const ids = new Set(changes.map((change) => change.transactionId));
  const corrections = changes.flatMap((change): TypeCorrection[] => {
    const row = snapshot.rows.find((item) => item.id === change.transactionId);
    if (!row || !change.kind) return [];
    return [{ cardId, transactionId: row.id, kind: change.kind, identityHash: row.identity, sourceHash: row.fingerprint, note: change.note ?? null }];
  });
  const kept = workspace.typeCorrections.filter((item) => item.cardId !== cardId || !ids.has(item.transactionId));
  return { ...workspace, typeCorrections: [...kept, ...corrections] };
}

/**
 * Statement review (§9.11, UI-10): the reconciliation strip, a To decide view, a Yes / No / ?
 * answer per transaction (Y, N and ? keys) and one Save for decisions and types (D29). A
 * statement whose transactions add up to its balance is saved as Matches bank (D26).
 */
export function StatementReview(props: Props) {
  const { budget, statement, entry, workspace, snapshot, available, refreshing = false, onClose, onEditFigures, onMakePlan, onOpenPlan, tools } = props;
  const card = entry.card;
  const heading = useRef<HTMLHeadingElement>(null);
  const [initialRevision] = useState(statement.revision);
  const [drafts, setDrafts] = useState<Record<string, ReviewAnswer>>({});
  const [types, setTypes] = useState<Record<string, TypeChange>>({});
  const [moves, setMoves] = useState<StatementMove[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Opens on every transaction, in date order like the bank statement; the Difference box links to the undecided ones.
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [menu, setMenu] = useState<{ row: ActivityRow; anchor: Element } | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [moving, setMoving] = useState<string[]>([]);
  const [moveTarget, setMoveTarget] = useState("");
  useEffect(() => { heading.current?.focus(); }, []);

  const saved = statementReview(statement, workspace, snapshot);
  const typed = stagedTypes(workspace, card.id, snapshot, types);
  const answers = (): ReviewAnswer[] => saved.rows.map((row, index) => {
    const membership = saved.memberships[index];
    return drafts[row.id] ?? {
      transactionId: row.id,
      decision: membership.origin === "suggested" ? "review" : membership.decision,
      bankPostingDate: membership.bankPostingDate,
      note: membership.note,
    };
  }).filter((answer) => answer.decision !== "review" || drafts[answer.transactionId]);
  const decisions = draftDecisions(statement, typed, snapshot, answers().flatMap((answer) => (answer.decision === "review" ? [] : [{
    statementId: statement.id, cardId: card.id, transactionId: answer.transactionId, decision: answer.decision, origin: "user" as const,
    bankPostingDate: answer.bankPostingDate, sourceHash: snapshot.rows.find((row) => row.id === answer.transactionId)?.fingerprint ?? "", note: answer.note,
  }])), moves);
  const draft = { ...typed, decisions };
  const review = statementReview(statement, draft, snapshot);
  const match = bankMatchFor(statement, review);
  const breakdown = statementBreakdown(card, statement, draft, snapshot);
  const unsaved = Object.keys(drafts).length + Object.keys(types).length + moves.length;
  const { requestClose, confirmThen, discardDialog } = useDiscardChanges(unsaved > 0, onClose);
  // An explicit Unsure overrides the suggestion on screen; it is saved as no answer.
  const items = review.rows.map((row, index) => {
    const membership = review.memberships[index];
    return { row, membership, shown: drafts[row.id]?.decision ?? membership.decision };
  });
  type Item = (typeof items)[number];
  const locked = (membership: Membership) => Boolean(membership.ownerId);
  const targets = workspace.statements
    .filter((item) => item.cardId === card.id && item.id !== statement.id && !item.estimate)
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate));

  function answer(transactionId: string, decision: Decision) {
    const item = items.find((entry) => entry.row.id === transactionId);
    if (!item || locked(item.membership)) return;
    setMoves((current) => current.filter((move) => move.transactionId !== transactionId));
    setDrafts((current) => ({
      ...current,
      [transactionId]: {
        ...(current[transactionId] ?? { transactionId, bankPostingDate: item.membership.bankPostingDate, note: item.membership.note }),
        decision,
      },
    }));
  }
  function note(transactionId: string, text: string) {
    const item = items.find((entry) => entry.row.id === transactionId)!;
    setDrafts((current) => ({
      ...current,
      [transactionId]: {
        ...(current[transactionId] ?? { transactionId, decision: item.membership.decision, bankPostingDate: item.membership.bankPostingDate }),
        note: text || null,
      },
    }));
  }
  async function save() {
    setSaving(true);
    try {
      if (!available) throw new Error("Refresh Actual before saving");
      // Unchanged suggestions stay suggestions; only answered rows are saved.
      const toSave = review.rows.flatMap((row, index): ReviewAnswer[] => {
        const membership = review.memberships[index];
        if (membership.ownerId || moves.some((move) => move.transactionId === row.id)) return [];
        const value = drafts[row.id];
        if (value) return [value];
        if (membership.origin === "suggested") return [];
        return [{ transactionId: row.id, decision: membership.decision, bankPostingDate: membership.bankPostingDate, note: membership.note }];
      });
      await creditCardStore.getState().saveReview(budget, statement.id, initialRevision, snapshot, toSave, moves, Object.values(types));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save the review");
    } finally {
      setSaving(false);
    }
  }
  function stageMove() {
    const target = targets.find((item) => item.id === moveTarget);
    if (!target) return;
    setMoves((current) => [
      ...current.filter((move) => !moving.includes(move.transactionId)),
      ...moving.map((transactionId) => ({ transactionId, targetStatementId: target.id, expectedTargetRevision: target.revision })),
    ]);
    setMoving([]);
    setMoveTarget("");
  }

  const needle = search.trim().toLowerCase();
  const counts = {
    review: items.filter((item) => item.shown === "review").length,
    included: items.filter((item) => item.shown === "included").length,
    excluded: items.filter((item) => item.shown === "excluded").length,
    all: items.length,
  };
  const typeOf = (row: ActivityRow) => typeLabel(transactionType(row, card, typed, snapshot).kind, row.amountMinor);
  const kinds = [...new Set(items.map(({ row }) => typeOf(row)))].sort();
  const visible = items.filter(({ row, membership, shown }) => (filter === "all" || shown === filter)
    && (!typeFilter || typeOf(row) === typeFilter)
    && (!needle || [row.label, row.notes ?? "", formatCardDate(row.date), money(row.amountMinor), membership.reason].join(" ").toLowerCase().includes(needle)))
    .sort((a, b) => a.row.date.localeCompare(b.row.date) || a.row.id.localeCompare(b.row.id));
  const label = (row: ActivityRow) => `${row.label} · ${formatCardDate(row.date)} · ${money(row.amountMinor)}`;
  const selectedItems = items.filter(({ row, membership }) => selected.has(row.id) && !locked(membership));
  // Select all covers the rows shown by the current search and filters, never locked ones.
  const selectable = visible.filter(({ membership }) => !locked(membership)).map(({ row }) => row.id);
  const allShownSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));
  const someShownSelected = selectable.some((id) => selected.has(id));

  const columns: Column<Item>[] = [
    {
      key: "select", header: "Select all", hiddenHeader: true, width: 36, align: "center",
      headerIcon: <Checkbox
        aria-label="Select all shown transactions"
        checked={allShownSelected}
        indeterminate={someShownSelected && !allShownSelected}
        disabled={!selectable.length}
        onCheckedChange={() => setSelected((current) => {
          const next = new Set(current);
          for (const id of selectable) if (allShownSelected) next.delete(id); else next.add(id);
          return next;
        })}
      />,
      cell: ({ row, membership }) => <Checkbox tabIndex={-1} aria-label={`Select ${label(row)}`} disabled={locked(membership)} checked={selected.has(row.id)}
        onCheckedChange={(checked) => setSelected((current) => {
          const next = new Set(current);
          if (checked) next.add(row.id); else next.delete(row.id);
          return next;
        })} />,
    },
    { key: "date", header: "Date", width: 84, cell: ({ row }) => shortDate(row.date, entry.today) },
    { key: "payee", header: "Payee", width: 200, cell: ({ row }) => <Text className="font-medium">{row.label}</Text> },
    { key: "notes", header: "Notes", width: 340, cell: ({ row }) => <Notes notes={row.notes} /> },
    { key: "category", header: "Category", width: 240, cell: ({ row }) => <Text>{activityCategoryLabel(row, snapshot)}</Text> },
    {
      key: "type", header: "Type", width: 115,
      // The plan mark is its own button, so it sits beside the type chip's button, never inside it.
      cell: ({ row }) => <span className="inline-flex max-w-full items-center gap-1">
        <button type="button" tabIndex={-1} data-type-chip className="min-w-0 text-left" aria-label={`Change type of ${label(row)}`}
          onClick={(event) => setMenu({ row, anchor: event.currentTarget })}>
          <TypeChip type={transactionType(row, card, typed, snapshot)} amountMinor={row.amountMinor} />
        </button>
        <PlanMark link={planOf(row, card, typed, snapshot)} onOpen={onOpenPlan} />
        {types[row.id] && <span className="text-[11px] text-muted-foreground">unsaved</span>}
      </span>,
    },
    {
      key: "amount", header: "Amount", width: 120, align: "right",
      cell: ({ row }) => <span className={amountClass(transactionType(row, card, typed, snapshot).kind, row.amountMinor)}>{money(row.amountMinor)}</span>,
    },
    {
      key: "cleared", header: "Cleared", headerIcon: <ClearedHeader />, width: 44, align: "center",
      cell: ({ row }) => <ClearedStatus cleared={row.cleared} />,
    },
    {
      key: "answer", header: "On this statement?", width: 170,
      cell: ({ row, membership, shown }) => (locked(membership)
        ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={membership.reason}>
          <LockKeyhole className="size-3.5" aria-hidden /><span className="truncate">{membership.reason}</span>
        </span>
        : <span className="inline-flex items-center gap-1.5"><div role="radiogroup" aria-label={`On this statement? ${label(row)}`} className="inline-flex overflow-hidden rounded-md border">
          {ANSWERS.map((choice) => {
            const on = shown === choice.value;
            return <button
              key={choice.value}
              type="button"
              role="radio"
              tabIndex={-1}
              aria-checked={on}
              aria-label={choice.text}
              onClick={() => answer(row.id, choice.value)}
              className={cn("h-6 min-w-9 border-r px-2 text-xs font-medium last:border-r-0",
                on && choice.value === "review" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                  : on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}
            >{choice.label}</button>;
          })}
        </div><Reason text={why(membership)} /></span>),
    },
    {
      key: "note", header: "Your note", width: 220, description: "Click the cell, or press Enter on the row, to write a note. It is saved with the review.",
      cell: ({ row, membership }) => {
        const current = drafts[row.id]?.note ?? membership.note ?? "";
        if (editingNote === row.id) {
          return <NoteInput
            label={`Note for ${label(row)}`}
            initial={current}
            onDone={(text) => { if (text !== null && text !== current) note(row.id, text); setEditingNote(null); }}
          />;
        }
        return <button type="button" tabIndex={-1} disabled={locked(membership)} onClick={() => setEditingNote(row.id)}
          aria-label={`${current ? "Edit" : "Add"} note for ${label(row)}`}
          className="block w-full truncate rounded px-1 text-left hover:bg-muted disabled:hover:bg-transparent" title={current || undefined}>
          {current || <span className="text-muted-foreground">{locked(membership) ? "-" : "Add a note"}</span>}
        </button>;
      },
    },
    {
      key: "actions", header: "Actions", hiddenHeader: true, width: 44, align: "center", sticky: "end",
      cell: ({ row, membership }) => <DropdownMenu>
        <DropdownMenuTrigger render={<Button data-row-menu tabIndex={-1} size="icon-xs" variant="ghost" aria-label={`Actions for ${label(row)}`} />}>
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <CardMenuContent>
          <DropdownMenuItem disabled={locked(membership) || !targets.length} onClick={() => { setMoving([row.id]); setMoveTarget(""); }}>
            Move to another statement
          </DropdownMenuItem>
          {onMakePlan && row.amountMinor < 0 && !planForTransaction(workspace, row.id)
            && planEligibleKinds.includes(transactionType(row, card, typed, snapshot).kind)
            && <DropdownMenuItem onClick={() => onMakePlan(row.id)}>Make this a plan</DropdownMenuItem>}
        </CardMenuContent>
      </DropdownMenu>,
    },
  ];

  return <section aria-label={`Review statement · ${formatCardDate(statement.closingDate)}`} className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 space-y-2 border-b px-4 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="xs" onClick={requestClose}><ArrowLeft className="size-3.5" aria-hidden />Statements</Button>
        <h2 ref={heading} tabIndex={-1} className="text-base font-semibold whitespace-nowrap outline-none">
          Review statement · {shortDate(statement.closingDate, entry.today)}
        </h2>
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {entry.name} · {formatStatementPeriod(statement.periodStart, statement.closingDate)} · due {formatCardDate(statement.dueDate)}
        </p>
        {tools && <div className="ml-auto flex items-center gap-2">{tools}</div>}
      </div>
      {refreshing
        ? <p role="status" aria-label="Reconciliation" className="-mx-4 border-y bg-muted/30 px-4 py-3 text-sm text-muted-foreground">Refreshing…</p>
        : <Reconciliation
          statement={statement}
          review={review}
          breakdown={breakdown}
          match={match}
          undecided={items.filter((item) => item.shown === "review").map((item) => item.row.amountMinor)}
          onShowUndecided={() => setFilter("review")}
        />}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput size="sm" className="w-56" aria-label="Search statement transactions" value={search} onValueChange={setSearch} />
        <PillGroup<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "review", label: "To decide", count: counts.review },
            { value: "included", label: "On this statement", count: counts.included },
            { value: "excluded", label: "Not on this statement", count: counts.excluded },
          ]}
        />
        <Select size="sm" className="w-44" aria-label="Type" value={typeFilter} onValueChange={setTypeFilter}
          options={[{ value: "", label: "All types" }, ...kinds.map((kind) => ({ value: kind, label: kind }))]} />
        {/* Save and Discard live in the toolbar, as on the other screens; they stay visible while rows are selected. */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {moves.length > 0 && <span className="text-xs text-muted-foreground">{plural(moves.length, "move")} staged; the other statement will need review.</span>}
          <span className="text-xs text-muted-foreground" role="status">{unsaved ? plural(unsaved, "unsaved change") : "No unsaved changes"}</span>
          {onEditFigures && <Button size="sm" variant="ghost" onClick={() => confirmThen(() => { setDrafts({}); setTypes({}); setMoves([]); onEditFigures(); })}>
            <Landmark className="size-3.5" aria-hidden />Edit bank figures
          </Button>}
          <Button variant="outline" size="sm" disabled={!unsaved} onClick={() => { setDrafts({}); setTypes({}); setMoves([]); }}>Discard</Button>
          <Button size="sm" disabled={!available || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
      {/* The selection bar of the other tables (/payees): a light tint, the count in the primary colour,
          outline actions and Clear selection. Filters stay usable, so a selection can span them. */}
      {selectedItems.length > 0 && <div role="region" aria-label="Selected transactions"
        className="-mx-4 -mb-2 flex flex-wrap items-center gap-2 border-t border-border/40 bg-primary/5 px-4 py-1.5">
        <span className="text-xs font-medium text-primary">{selectedItems.length} selected</span>
        {/* The three answers are one choice, joined like the row's Yes / No / ? control. */}
        <span role="group" aria-label="Answer for the selected transactions" className="inline-flex divide-x overflow-hidden rounded-md border bg-background">
          {ANSWERS.map((choice) => <button key={choice.value} type="button" className="h-6 px-2.5 text-xs font-medium hover:bg-muted"
            onClick={() => { for (const { row } of selectedItems) answer(row.id, choice.value); }}>{choice.text}</button>)}
        </span>
        <Button size="xs" variant="outline" disabled={!targets.length} onClick={() => setMoving(selectedItems.map(({ row }) => row.id))}>Move</Button>
        <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Clear selection</button>
      </div>}
    </div>
    <DataTable<Item>
      label="Transactions on this statement"
      dense={34}
      columns={columns}
      rows={visible}
      rowKey={({ row }) => row.id}
      rowLabel={({ row }) => label(row)}
      onRowKeys={(event, { row }) => {
        const key = event.key.toLowerCase();
        if (key === "y" || key === "n" || event.key === "?") {
          answer(row.id, key === "y" ? "included" : key === "n" ? "excluded" : "review");
          return true;
        }
        if (event.key === "Enter") {
          setEditingNote(row.id);
          return true;
        }
        if (key === "t") {
          const anchor = event.currentTarget.querySelector("[data-type-chip]");
          if (anchor) setMenu({ row, anchor });
          return true;
        }
        return false;
      }}
      empty={items.length ? "Nothing in this view." : "No activity in this statement's window."}
    />
    {discardDialog}
    {menu && <TypeMenu
      budget={budget}
      card={card}
      row={menu.row}
      workspace={typed}
      snapshot={snapshot}
      available={available}
      anchor={menu.anchor}
      onClose={() => setMenu(null)}
      onMakePlan={onMakePlan}
      onStage={(kind: TransactionType | null, text) => setTypes((current) => ({ ...current, [menu.row.id]: { transactionId: menu.row.id, kind, note: text } }))}
    />}
    <Dialog open={moving.length > 0} onOpenChange={(open) => { if (!open) setMoving([]); }}>
      <DialogContent>
        <DialogTitle>Move to another statement</DialogTitle>
        <DialogDescription>
          {plural(moving.length, "transaction")} will leave {formatCardDate(statement.closingDate)} and go on the statement you choose.
          Both statements update together when you save; the other one will need review.
        </DialogDescription>
        <Select aria-label="Destination statement" value={moveTarget} onValueChange={setMoveTarget}
          options={[{ value: "", label: "Choose a statement" }, ...targets.map((item) => ({ value: item.id, label: formatCardDate(item.closingDate) }))]} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setMoving([])}>Cancel</Button>
          <Button disabled={!moveTarget} onClick={stageMove}>Move</Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}

/** One figure in the reconciliation strip. */
type ReconciliationProps = {
  statement: Statement;
  review: ReturnType<typeof statementReview>;
  breakdown: ReturnType<typeof statementBreakdown>;
  match: ReturnType<typeof bankMatchFor>;
  /** Amounts of the rows still to decide (signed, as in Actual). */
  undecided: number[];
  /** Switches the table to the transactions still to decide. */
  onShowUndecided: () => void;
};

/**
 * The statement as an equation (§9.13): previous, the three headline columns and any plan change, the
 * calculated balance beside the bank's, and the difference. While rows are undecided the figures are the
 * decided rows so far, and the difference says what deciding the rest as Yes would do.
 */
function Reconciliation({ statement, review, breakdown, match, undecided, onShowUndecided }: ReconciliationProps) {
  const partial = undecided.length > 0;
  const figures = breakdown.known ? breakdown : { ...breakdown, ...breakdown.soFar };
  // Each term's sign comes from its direction, so a figure never carries two signs.
  const terms: { label: string; minor: number | null; sign: 1 | -1 }[] = [
    { label: "Payments & credits", minor: figures.paymentsAndCreditsMinor, sign: -1 },
    { label: "Charges", minor: figures.chargesMinor, sign: 1 },
    { label: "Interest & fees", minor: figures.interestAndFeesMinor, sign: 1 },
    ...(review.planChangeMinor ? [{ label: "Plan balances", minor: review.planChangeMinor, sign: 1 as const }] : []),
  ];
  const variance = review.varianceMinor;
  // Including every undecided row lowers the calculated balance by their amounts (charges are negative in Actual).
  const undecidedMinor = sumMinor(undecided);
  const closesGap = partial && variance !== null && sumMinor([variance, undecidedMinor]) === 0;
  const tone = variance === null ? "muted" : partial ? "attention" : match.key === "matches" ? "success" : "attention";
  // One status line: what is left to do, or the match; a plain difference needs none.
  const status: ReactNode = partial
    ? <><button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={onShowUndecided}>
      {plural(undecided.length, "transaction")} to decide
    </button>{closesGap ? " · would match the bank" : ""}</>
    : review.duplicate ? "On two statements"
      : variance === null || match.key === "matches" ? match.label : "";
  return <div role="group" aria-label="Reconciliation"
    className="-mx-4 flex flex-wrap items-end gap-x-3 gap-y-2 border-y bg-muted/30 px-4 py-1.5">
    <Figure label="Previous" value={review.startingBalanceMinor === null ? "Not entered" : money(review.startingBalanceMinor)}
      line={review.startingBalanceMinor === null ? "Enter the previous balance in the bank figures" : undefined} muted={review.startingBalanceMinor === null} />
    {terms.map((term) => {
      const signed = term.minor === null ? null : term.minor * term.sign;
      return <span key={term.label} className="flex items-end gap-3">
        <Operator symbol={(signed === null || signed === 0 ? term.sign : Math.sign(signed)) < 0 ? "−" : "+"} />
        <Figure label={term.label} value={term.minor === null ? MISSING : money(Math.abs(term.minor))} muted={partial && term.label !== "Plan balances"} />
      </span>;
    })}
    <Operator symbol="=" />
    <Figure label="Calculated" value={money(review.calculatedMinor)} strong muted={partial} />
    <span className="mx-1 self-stretch border-l" aria-hidden />
    <Figure label="Bank" value={money(statement.balanceMinor)} strong />
    <span className="ml-auto flex items-end gap-2">
      <span className={cn("flex w-[260px] flex-col rounded-md border px-3 py-1",
        tone === "success" && "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30",
        tone === "attention" && "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
        tone === "muted" && "bg-background")}>
        <span className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground" title="Bank balance minus calculated balance">Difference</span>
          <span className="inline-flex items-center gap-1 text-[15px] font-semibold tabular-nums">
            {variance === null ? MISSING : <>
              {tone === "success" ? <CircleCheck className="size-4 text-green-600" aria-hidden /> : <TriangleAlert className="size-4 text-amber-600" aria-hidden />}
              {money(variance)}
            </>}
          </span>
        </span>
        <span role="status" className="min-h-4 truncate text-[11px] text-muted-foreground">{status}</span>
      </span>
    </span>
  </div>;
}

function Figure({ label, value, line, strong = false, muted = false }: { label: string; value: ReactNode; line?: string; strong?: boolean; muted?: boolean }) {
  return <span className="flex min-w-0 flex-col">
    <span className="text-[11px] text-muted-foreground">{label}</span>
    <span className={cn("text-[15px] tabular-nums", strong && "font-semibold", muted && "text-muted-foreground")}>{value}</span>
    {line && <span className="text-[11px] text-muted-foreground">{line}</span>}
  </span>;
}

const Operator = ({ symbol }: { symbol: string }) => <span aria-hidden className="pb-0.5 text-base text-muted-foreground">{symbol}</span>;

const why = (membership: Membership) => [membership.reason,
  membership.previous ? `was ${membership.previous === "included" ? "on" : "not on"} this statement` : ""].filter(Boolean).join(" · ");

/** Why Bench suggests this answer: an icon with the reason as its tooltip and accessible name. */
function Reason({ text }: { text: string }) {
  if (!text) return null;
  return <span role="img" aria-label={`Why: ${text}`} title={text} className="inline-flex text-muted-foreground"><Info className="size-3.5" aria-hidden /></span>;
}

/** Inline note editor: Enter or leaving the cell keeps the text, Esc cancels (null). */
function NoteInput({ label, initial, onDone }: { label: string; initial: string; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(initial);
  return <Input
    autoFocus
    size="sm"
    aria-label={label}
    value={text}
    maxLength={500}
    className="h-7"
    onChange={(event) => setText(event.target.value)}
    onBlur={() => onDone(text)}
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); onDone(text); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onDone(null); }
    }}
  />;
}
