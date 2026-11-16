"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleAlert, Loader2, MoreHorizontal, PanelRight, Plus, Redo2, RefreshCw, Settings2, SlidersHorizontal, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PillGroup } from "@/components/ui/pill-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { downloadCsv } from "@/lib/csv";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { useLocalToday } from "@/features/assets-debt/lib/useLocalToday";
import { TipProvider } from "@/features/financial-insights/components/charts/Tip";
import { money } from "@/features/financial-insights/format";
import { placeActualsCached, unplannedTarget, type OptionalRead, type Placed } from "@/lib/cashflow-planning/actuals";
import { NAME_MAX, PlanDocumentError, addGroup, addRow, duplicateDocument, exportPlanJson, importPlanJson, moveGroup, moveRow, moveRowBefore, placeRow, removeRow, renameGroup, setCells, updateRow } from "@/lib/cashflow-planning/document";
import { computePlan, type Computed } from "@/lib/cashflow-planning/engine";
import { linkNotes as buildLinkNotes } from "@/lib/cashflow-planning/linkNotes";
import { monthLabel, yearOf } from "@/lib/cashflow-planning/months";
import { SECTIONS, SECTION_LABEL, type Month, type PlanDocument, type PlanRow, type SectionId, type UnreadablePlan } from "@/lib/cashflow-planning/types";
import { FEATURES } from "@/lib/features/catalogue";
import { requestFor } from "../lib/transactions";
import { MonthJumpPopover } from "@/features/budget-management/components/MonthJumpPopover";
import { cn } from "@/lib/utils";
import { useCashflowData } from "../hooks/useCashflowData";
import { usePlanActions, usePlanAutosave, usePlans } from "../hooks/usePlans";
import { buildColumns, buildLines, lastTwelveMonths, lineKey, planYears, type Column, type Line } from "../lib/view";
import { useCashflowStore, type PlanSession } from "../store";
import { AddRowDialog } from "./AddRowDialog";
import { CashflowGuide, type CashflowGuideSection } from "./guide/CashflowGuide";
import { INSPECTOR_MAX, INSPECTOR_MIN, Inspector, type TransactionsRequest } from "./Inspector";
import { NewPlanDialog } from "./NewPlanDialog";
import { PlanGrid, type CellEdit, type GridCommand, type GridSelection, type PastMode } from "./PlanGrid";
import { PlanSettingsDialog } from "./PlanSettingsDialog";
import { GoalCard } from "./GoalCard";
import { MonthSummary } from "./MonthSummary";
import { BalanceChart, SummaryStrip } from "./Summary";
import { TransactionsDialog } from "./TransactionsDialog";

type ViewPrefs = { mode: "months" | "years"; cents: boolean; chart: boolean; pastMode: PastMode; /** Whether each year in the months view is followed by its Total column. */ totals: boolean; details: boolean; collapsed: string[]; panelWidth: number };
const navButton = "flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40";
/** How many years the grid draws at once; the navigator and the month picker move through the rest of the plan. */
const YEARS_ON_SCREEN = 2;
const DEFAULT_VIEW: ViewPrefs = { mode: "months", cents: false, chart: true, pastMode: "actual", totals: true, details: true, collapsed: [], panelWidth: 400 };
const DOCS_URL = FEATURES.find((f) => f.id === "cashflow-planning")?.docsUrl;

/**
 * Cashflow Planning: a month-by-month plan of cash, years ahead, laid over what Actual recorded. Plans are saved in the
 * app database as they are edited; Actual is only ever read.
 */
export function CashflowWorkspace() {
  const plans = usePlans();
  const today = useLocalToday();
  const order = useCashflowStore((s) => s.order);
  const sessions = useCashflowStore((s) => s.sessions);
  const activeId = useCashflowStore((s) => s.activeId);
  const unreadable = useCashflowStore((s) => s.unreadable);
  const session = activeId ? sessions[activeId] ?? null : null;
  const autosave = usePlanAutosave(plans.budgetSyncId);
  const actions = usePlanActions(plans.budgetSyncId);
  const [creating, setCreating] = useState(false);
  const [newPlan, setNewPlan] = useState(false);

  const doc = session?.doc ?? null;
  const needBudget = !!doc && doc.useActuals && doc.rows.some((r) => r.basis.kind === "budget");
  // Actual is read when the open plan uses it, and when there is no plan yet (a first plan is built from it).
  const movedIds = useMemo(() => Object.keys(doc?.moves ?? {}), [doc?.moves]);
  const data = useCashflowData({ enabled: plans.ready && (!doc || doc.useActuals || newPlan), needBudget, movedIds });
  const snapshot = data.state === "ready" ? data.snapshot : null;

  const createPlan = async (document: PlanDocument): Promise<boolean> => {
    setCreating(true);
    const id = await actions.create(document);
    setCreating(false);
    if (id) setNewPlan(false);
    return id !== null;
  };

  const title = "Cashflow Planning";
  if (!plans.budgetSyncId) return <PageLayout title={title}><Centered title="Open a budget to plan its cash" /></PageLayout>;
  if (plans.failed) return <PageLayout title={title}><Centered title="Your plans could not be loaded" detail="The app database did not answer." action={<Button size="sm" onClick={() => void plans.retry()}>Try again</Button>} /></PageLayout>;
  if (!plans.ready) return <PageLayout title={title}><Centered title="Loading your plans…" busy /></PageLayout>;

  const dialog = newPlan && (
    <NewPlanDialog snapshot={snapshot} today={today} existingNames={order.map((id) => sessions[id]?.doc.name ?? "")} busy={creating} loansPending={data.state === "ready" && data.pending.loans} onCreate={(d) => void createPlan(d)} onClose={() => setNewPlan(false)} />
  );

  if (!session || !doc) {
    return (
      <PageLayout title={title}>
        <div className="mx-auto max-w-xl space-y-4 p-10 text-center">
          <h2 className="text-base font-semibold">See your cash, month by month, years ahead</h2>
          <p className="text-sm text-muted-foreground">
            A cash plan shows where your money stands at the end of every month: what really happened so far, read from Actual, and what you expect from here on.
            It tells you how low your cash will get, when, and whether you reach what you are saving for. It replaces the long-range spreadsheet many people keep next to their budget.
          </p>
          <Button onClick={() => setNewPlan(true)} disabled={data.state === "loading"}>{data.state === "loading" ? <><Loader2 className="size-3.5 animate-spin" aria-hidden />{data.stage ?? "Reading Actual…"}</> : <><Plus className="size-3.5" aria-hidden />Create your first plan</>}</Button>
          {data.state === "error" && <p className="text-xs text-muted-foreground" role="status">Actual could not be read ({data.message}), so a plan can only start empty for now. <button type="button" className="underline underline-offset-2" onClick={data.retry}>Try again</button></p>}
          <p className="text-xs text-muted-foreground">Plans are saved in Actual Bench. Nothing is ever written to Actual.</p>
          <UnreadableNotice plans={unreadable} onDelete={(id) => void actions.removeUnreadable(id)} />
        </div>
        {dialog}
      </PageLayout>
    );
  }

  return (
    <TipProvider>
      <PlanView
        key={session.id} session={session} doc={doc} data={data} today={today}
        planOptions={order.map((id) => ({ value: id, label: sessions[id]?.doc.name ?? "Plan" }))}
        onNewPlan={() => setNewPlan(true)} onRetrySave={() => autosave.retry(session.id)} onOverwrite={() => autosave.overwrite(session.id)}
        onReload={() => void actions.reload(session.id)} onDelete={() => actions.remove(session.id)} onCreate={createPlan}
        unreadable={unreadable} onDeleteUnreadable={(id) => void actions.removeUnreadable(id)}
      />
      {dialog}
    </TipProvider>
  );
}

/** Stored plans this version cannot read. They still count toward the plan limit, so each can be deleted; none is ever repaired. */
function UnreadableNotice({ plans, onDelete }: { plans: UnreadablePlan[]; onDelete: (id: string) => void }) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  if (plans.length === 0) return null;
  return (
    <div role="status" className="space-y-1 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <p>{plans.length === 1 ? "1 saved plan cannot be read by this version" : `${plans.length} saved plans cannot be read by this version`} (a newer version may have written {plans.length === 1 ? "it" : "them"}). {plans.length === 1 ? "It still counts" : "They still count"} toward the limit of plans.</p>
      <ul className="space-y-0.5">
        {plans.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate"><span className="font-medium">{p.name || "Unnamed plan"}</span>: {p.why}</span>
            <Button size="xs" variant="outline" onClick={() => setConfirm({ title: `Delete "${p.name || "Unnamed plan"}"?`, message: "This stored plan cannot be read here, so it cannot be exported first. It is removed from Actual Bench for good. Nothing in Actual changes.", destructive: true, destructiveLabel: "Delete plan", onConfirm: () => onDelete(p.id) })}>Delete…</Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }} state={confirm} />
    </div>
  );
}

const FAILED_READ: Record<OptionalRead, string> = {
  schedules: "Actual's schedules could not be read, so rows that follow a schedule have no forecast.",
  loans: "The loan schedules could not be read, so loan repayment rows have no forecast.",
  shifts: "The tagged and moved transactions could not be read, so they count in their original months.",
};

function Centered({ title, detail, action, busy }: { title: string; detail?: string; action?: React.ReactNode; busy?: boolean }) {
  return (
    <div className="mx-auto max-w-md space-y-3 p-10 text-center" role={busy ? "status" : undefined}>
      {busy && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-hidden />}
      <h2 className="text-sm font-semibold">{title}</h2>
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      {action}
    </div>
  );
}

function SaveStatusBadge({ session, onRetry }: { session: PlanSession; onRetry: () => void }) {
  if (session.status === "saving" || session.status === "dirty") return <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden />Saving…</span>;
  if (session.status === "error") return <span role="alert" className="flex items-center gap-1.5 text-xs text-destructive"><CircleAlert className="size-3.5" aria-hidden />Not saved: {session.error}<Button size="xs" variant="outline" onClick={onRetry}>Retry</Button></span>;
  if (session.status === "conflict") return <span role="alert" className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="size-3.5" aria-hidden />Not saved</span>;
  return <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" aria-hidden />Saved</span>;
}

type PlanViewProps = {
  session: PlanSession; doc: PlanDocument; data: ReturnType<typeof useCashflowData>; today: string;
  planOptions: { value: string; label: string }[];
  onNewPlan: () => void; onRetrySave: () => void; onOverwrite: () => void; onReload: () => void;
  onDelete: () => Promise<boolean>; onCreate: (doc: PlanDocument) => Promise<boolean>;
  unreadable: UnreadablePlan[]; onDeleteUnreadable: (id: string) => void;
};

function PlanView({ session, doc, data, today, planOptions, onNewPlan, onRetrySave, onOverwrite, onReload, onDelete, onCreate, unreadable, onDeleteUnreadable }: PlanViewProps) {
  const store = useCashflowStore;
  const [view, setView] = usePersistedFilters<ViewPrefs>("filters:cashflow-planning", DEFAULT_VIEW);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const [settings, setSettings] = useState(false);
  const [transactions, setTransactions] = useState<TransactionsRequest | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [find, setFind] = useState("");
  const [scrollToken, setScrollToken] = useState(0);
  const [scrollMonth, setScrollMonth] = useState<Month | null>(null);
  /** The month or year picked in the grid's header: its summary replaces the plan overview. */
  const [pickedColumn, setPickedColumn] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ section: SectionId; groupId: string | null; afterRowId?: string } | null>(null);
  const [guide, setGuide] = useState<CashflowGuideSection | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const snapshot = doc.useActuals && data.state === "ready" ? data.snapshot : null;

  // Placing Actual's movements depends on the rows' links and the account roles only: typing amounts does not redo it.
  const placed = snapshot ? placeActualsCached(doc, snapshot) : null;

  const waiting = doc.useActuals && data.state !== "ready";
  const computed: Computed | null = useMemo(() => (waiting ? null : computePlan(doc, snapshot, placed)), [waiting, doc, snapshot, placed]);

  const years = useMemo(() => (computed ? planYears(computed.months) : []), [computed]);
  const [fromYearState, setFromYear] = useState<number | null>(null);
  const defaultYear = computed ? (computed.currentIndex >= 0 ? yearOf(computed.months[computed.currentIndex]) : years[0]) : Number(today.slice(0, 4));
  const fromYear = Math.min(Math.max(fromYearState ?? defaultYear, years[0] ?? defaultYear), years[years.length - 1] ?? defaultYear);
  const span = Math.min(YEARS_ON_SCREEN, Math.max(1, years.length));

  const collapsed = useMemo(() => new Set(view.collapsed), [view.collapsed]);
  const lines = useMemo(() => (computed ? buildLines(doc, computed, collapsed, find) : []), [doc, computed, collapsed, find]);
  // Cells a transaction counted in another month left or joined, by grid line.
  const shiftedCells = useMemo(() => new Set([...(placed?.shiftNotes.keys() ?? [])].map((k) => (k.startsWith("unplanned:") ? k : `row:${k}`))), [placed]);
  const columns = useMemo(() => (computed ? buildColumns(computed.months, { mode: view.mode, fromYear, span, totals: view.totals }) : []), [computed, view.mode, view.totals, fromYear, span]);

  // Links an earlier row already holds: a warning only when something is counted twice, otherwise a quiet note.
  const linkNotes = useMemo(() => (computed ? buildLinkNotes(doc, computed, placed) : new Map()), [doc, computed, placed]);
  const problems = useMemo(() => {
    const map = new Map<string, string>();
    if (!computed) return map;
    for (const [rowId, note] of linkNotes) if (note.severity === "warning") map.set(rowId, note.summary);
    for (const row of doc.rows) { const problem = computed.rows.get(row.id)?.problem; if (problem && !map.has(row.id)) map.set(row.id, problem); }
    return map;
  }, [computed, linkNotes, doc.rows]);

  const edit = (change: (doc: PlanDocument) => PlanDocument) => {
    try { store.getState().edit(session.id, change); } catch (error) { toast.error(error instanceof PlanDocumentError ? error.message : "That change could not be made"); }
  };
  const editCells = (edits: CellEdit[]) => edit((d) => setCells(d, edits));
  const undo = () => store.getState().undo(session.id);
  const redo = () => store.getState().redo(session.id);

  // Undo and redo belong to the plan while this page is open; a focused field keeps its own.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = event.key.toLowerCase();
      if (k === "z" && !event.shiftKey) { event.preventDefault(); store.getState().undo(session.id); }
      else if (k === "y" || (k === "z" && event.shiftKey)) { event.preventDefault(); store.getState().redo(session.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session.id, store]);

  const selectedLine: Line | null = selection ? lines.find((l) => l.key === selection.line) ?? null : null;
  const pickedColumnValue = pickedColumn ? columns.find((c) => c.key === pickedColumn) ?? null : null;
  const selectedColumn = selection?.col ? columns.find((c) => c.key === selection.col) ?? null : null;
  const selectLine = (lineKeyValue: string | null) => {
    setPickedColumn(null);
    setSelection(lineKeyValue ? { line: lineKeyValue, col: null } : null);
    if (!lineKeyValue) return;
    // A row inside a collapsed section or group, or hidden by the row search, has to be on the grid to be selected.
    const row = doc.rows.find((r) => lineKey.row(r.id) === lineKeyValue);
    if (row) setFind("");
    setView((v) => ({ ...v, details: true, ...(row ? { collapsed: v.collapsed.filter((k) => k !== lineKey.section(row.section) && k !== (row.groupId ? lineKey.group(row.groupId) : "")) } : {}) }));
  };

  // A click on empty space outside the grid and the details panel clears the selection, which shows the plan overview again.
  useEffect(() => {
    if (!selection && !pickedColumn) return;
    const away = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.isConnected) return;
      if (target.closest('[role="grid"], aside[aria-label="Details"], [role="dialog"], [role="menu"], [role="listbox"], [role="option"], [role="tab"], [data-slot="popover-content"], button, a, input, select, textarea, label, [role="combobox"]')) return;
      setSelection(null);
      setPickedColumn(null);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [selection, pickedColumn]);

  const addRowTo = (section: SectionId, groupId: string | null, afterRowId?: string) => setAdding({ section, groupId, afterRowId });
  const added = (row: PlanRow) => {
    const place = adding;
    setAdding(null);
    edit((d) => addRow(d, row, place?.afterRowId));
    // A new row in a collapsed place would not be seen.
    setFind("");
    setView((v) => ({ ...v, details: true, collapsed: v.collapsed.filter((k) => k !== `section:${row.section}` && k !== `group:${row.groupId}`) }));
    setSelection({ line: `row:${row.id}`, col: null });
  };
  const deleteRow = (rowId: string) => {
    const name = doc.rows.find((r) => r.id === rowId)?.name ?? "Row";
    edit((d) => removeRow(d, rowId));
    if (selection?.line === `row:${rowId}`) setSelection(null);
    toast(`Deleted “${name}”`, { action: { label: "Undo", onClick: undo } });
  };
  const showTransactions = (line: Line, column: Column) => {
    if (!computed) return;
    const months = column.kind === "month" ? [column.month] : column.indexes.map((i) => computed.months[i]);
    const request = requestFor(doc, snapshot, placed, line, months, column.kind === "month" ? monthLabel(column.month) : String(column.year));
    if (request) setTransactions(request); else toast.message("No transactions are behind this figure");
  };
  /** The "Not in plan" figure of the last 12 months, as the transactions behind it. */
  const showUnplanned = (section: SectionId) => {
    if (!computed || computed.currentIndex < 0) return;
    const months = lastTwelveMonths(computed);
    const request = requestFor(doc, snapshot, placed, { kind: "unplanned", key: `unplanned:${section}`, section, label: SECTION_LABEL[section], values: [], aggregate: "sum" }, months, "last 12 months");
    if (request) setTransactions(request);
  };
  const goToToday = () => { setFromYear(null); setScrollMonth(null); setView((v) => ({ ...v, mode: "months" })); setScrollToken((n) => n + 1); };
  /** Brings a month to the left edge of the grid. */
  const goToWindow = (month: Month) => { setFromYear(yearOf(month)); setScrollMonth(month); setView((v) => ({ ...v, mode: "months" })); setScrollToken((n) => n + 1); };
  /** Shows a month's closing balance in the grid: where the top figures point. */
  const goToMonth = (month: Month) => { setFromYear(yearOf(month)); setView((v) => ({ ...v, mode: "months" })); setSelection({ line: "closing", col: month }); };

  const onCommand = (command: GridCommand) => {
    switch (command.type) {
      case "addRow": addRowTo(command.section, command.groupId, command.afterRowId); return;
      case "rename": edit((d) => (command.line.startsWith("row:") ? updateRow(d, command.line.slice(4), (r) => ({ ...r, name: command.name.slice(0, NAME_MAX) })) : command.line.startsWith("group:") ? renameGroup(d, command.line.slice(6), command.name) : d)); return;
      case "move": edit((d) => (command.line.startsWith("row:") ? moveRow(d, command.line.slice(4), command.direction) : command.line.startsWith("group:") ? moveGroup(d, command.line.slice(6), command.direction) : d)); return;
      case "deleteRow": deleteRow(command.rowId); return;
      case "addGroup": {
        let created = "";
        edit((d) => { const next = addGroup(d, command.section, "New group", command.afterGroupId); created = next.groupId; return next.doc; });
        if (created) { setFind(""); selectLine(`group:${created}`); }
        return;
      }
      case "dropRow": edit((d) => moveRowBefore(d, command.rowId, command.refRowId, command.placement)); return;
      case "dropInto":
        edit((d) => placeRow(d, command.rowId, command.section, command.groupId, command.at));
        // A row dropped into a closed group would vanish from view.
        if (command.groupId) setView((v) => ({ ...v, collapsed: v.collapsed.filter((k) => k !== `group:${command.groupId}`) }));
        return;
      case "fill": {
        if (!computed) return;
        const end = computed.months[computed.months.length - 1];
        const last = command.to === "plan" || `${command.month.slice(0, 4)}-12` > end ? end : `${command.month.slice(0, 4)}-12`;
        const amount = computed.rows.get(command.rowId)?.values[computed.months.indexOf(command.month)] ?? 0;
        edit((d) => setCells(d, computed.months.filter((m) => m >= command.month && m <= last).map((month) => ({ rowId: command.rowId, month, amount }))));
        return;
      }
      case "clearFrom": edit((d) => setCells(d, Object.keys(d.rows.find((r) => r.id === command.rowId)?.cells ?? {}).filter((m) => m >= command.month).map((month) => ({ rowId: command.rowId, month, amount: null })))); return;
      case "transactions": { const line = lines.find((l) => l.key === command.line), column = columns.find((c) => c.key === command.col); if (line && column) showTransactions(line, column); return; }
      case "help": setGuide("working"); return;
    }
  };

  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([exportPlanJson(doc)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${doc.name.replace(/[^\w.-]+/g, "-") || "cash-plan"}.json`; anchor.click();
    URL.revokeObjectURL(url);
  };
  const exportCsv = () => {
    if (!computed) return;
    const all = buildLines(doc, computed, new Set());
    const header = ["Line", "Section", ...computed.months];
    const rows = all.map((line) => [
      line.kind === "row" ? line.row.name : line.kind === "group" ? line.group.name : line.label,
      line.kind === "row" ? SECTION_LABEL[line.row.section] : line.kind === "group" ? SECTION_LABEL[line.group.section] : line.kind === "section" || line.kind === "unplanned" ? SECTION_LABEL[line.section] : "",
      ...(line.kind === "row" ? line.result.values : line.values).map((v) => (v / 100).toFixed(2)),
    ]);
    downloadCsv(`${doc.name.replace(/[^\w.-]+/g, "-") || "cash-plan"}.csv`, [header, ...rows], { includeBom: true });
  };
  const importFile = async (file: File) => {
    try {
      const imported = importPlanJson(await file.text());
      const created = await onCreate({ ...imported, name: planOptions.some((p) => p.label === imported.name) ? `${imported.name} (imported)`.slice(0, 80) : imported.name });
      if (created) toast.success("Plan imported as a new plan");
    } catch (error) {
      toast.error(error instanceof PlanDocumentError ? error.message : "The file could not be imported");
    }
  };

  const divider = <div className="mx-1 h-5 w-px shrink-0 bg-border/60" aria-hidden="true" />;
  const header = (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2">
      <h1 className="text-sm font-semibold">Cashflow Plan</h1>
      <Select size="sm" className="w-56" value={session.id} title="Open another plan" onValueChange={(id) => store.getState().select(id)} options={planOptions} />
      <SaveStatusBadge session={session} onRetry={onRetrySave} />
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={() => setSettings(true)}><Settings2 className="size-3.5" aria-hidden />Plan settings</Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon-sm" variant="outline" aria-label="More plan actions" />}><MoreHorizontal className="size-3.5" aria-hidden /></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48 text-xs">
            <DropdownMenuItem className="text-xs" onClick={onNewPlan}>New plan…</DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onClick={() => void onCreate(duplicateDocument(doc, `${doc.name} copy`))}>Duplicate this plan</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs" onClick={exportJson}>Export plan (JSON)</DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onClick={() => fileInput.current?.click()}>Import a plan (JSON)…</DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onClick={exportCsv} disabled={!computed}>Export figures (CSV)</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" className="text-xs" onClick={() => setConfirm({ title: `Delete "${doc.name}"?`, message: "The plan is removed from Actual Bench for good. Export it first if you may want it back. Nothing in Actual changes.", destructive: true, destructiveLabel: "Delete plan", onConfirm: () => void onDelete() })}>Delete this plan…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {view.mode === "months" && years.length > 0 && computed && (
        <>
        {divider}
        <div className="flex items-center gap-0.5" role="group" aria-label="Year navigation">
          <button type="button" onClick={() => goToWindow(`${years[0]}-01`)} disabled={fromYear <= years[0]} aria-label="First year" title="First year" className={navButton}><ChevronsLeft className="size-3.5" aria-hidden /></button>
          <button type="button" onClick={() => setFromYear(fromYear - 1)} disabled={fromYear <= years[0]} aria-label="Back 1 year" title="Back 1 year" className={navButton}><ChevronLeft className="size-3.5" aria-hidden /></button>
          <MonthJumpPopover windowStart={`${fromYear}-01`} rangeLabel={`Jan ${String(fromYear).slice(2)} – Dec ${String(Math.min(fromYear + span - 1, years[years.length - 1])).slice(2)}`} availableMonths={computed.months} onWindowChange={goToWindow} />
          <button type="button" onClick={() => setFromYear(fromYear + 1)} disabled={fromYear + span > years[years.length - 1]} aria-label="Forward 1 year" title="Forward 1 year" className={navButton}><ChevronRight className="size-3.5" aria-hidden /></button>
          <button type="button" onClick={() => goToWindow(`${Math.max(years[0], years[years.length - 1] - span + 1)}-01`)} disabled={fromYear + span > years[years.length - 1]} aria-label="Last year" title="Last year" className={navButton}><ChevronsRight className="size-3.5" aria-hidden /></button>
          {doc.useActuals && computed.currentIndex >= 0 && <button type="button" onClick={goToToday} aria-label="Go to the current month" title="Go to the current month" className={cn(navButton, "ml-0.5")}><CalendarDays className="size-3.5" aria-hidden /></button>}
        </div>
        </>
      )}
      {divider}
      <PillGroup<ViewPrefs["mode"]> options={[{ value: "months", label: "Months" }, { value: "years", label: "Years" }]} value={view.mode} onChange={(mode) => setView((v) => ({ ...v, mode }))} />
      {doc.useActuals && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Past months</span>
          <PillGroup<PastMode>
            options={[
              { value: "actual", label: "Actual", title: "Past months show what Actual recorded" },
              { value: "plan", label: "Planned", title: "Past months show what the plan said for them" },
              { value: "diff", label: "Difference", title: "Past months show actual minus planned: green is better than planned, amber is worse" },
            ]}
            value={view.pastMode} onChange={(pastMode) => setView((p) => ({ ...p, pastMode }))} />
        </div>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {divider}
        <Button size="icon-sm" variant="ghost" onClick={undo} disabled={session.past.length === 0} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 className="size-3.5" aria-hidden /></Button>
        <Button size="icon-sm" variant="ghost" onClick={redo} disabled={session.future.length === 0} aria-label="Redo" title="Redo (Ctrl+Y)"><Redo2 className="size-3.5" aria-hidden /></Button>
        <Popover>
          <PopoverTrigger render={<Button size="sm" variant="outline" />}><SlidersHorizontal className="size-3.5" aria-hidden />View</PopoverTrigger>
          <PopoverContent align="end" className="w-80 divide-y divide-border p-0 text-xs">
            <section className="space-y-3 p-3">
              <label className="flex cursor-pointer items-center justify-between gap-3"><span><span className="block font-medium">Balance chart</span><span className="text-muted-foreground">The closing balance above the grid.</span></span><Switch checked={view.chart} onCheckedChange={(chart) => setView((p) => ({ ...p, chart }))} /></label>
              <label className="flex cursor-pointer items-center justify-between gap-3"><span><span className="block font-medium">Show decimals</span><span className="text-muted-foreground">Amounts as 12,000.00 instead of 12,000.</span></span><Switch checked={view.cents} onCheckedChange={(cents) => setView((p) => ({ ...p, cents }))} /></label>
              <label className="flex cursor-pointer items-center justify-between gap-3"><span><span className="block font-medium">Year totals</span><span className="text-muted-foreground">A Total column after each year of months. The Years view always shows them.</span></span><Switch checked={view.totals} onCheckedChange={(totals) => setView((p) => ({ ...p, totals }))} /></label>
            </section>
          </PopoverContent>
        </Popover>
        {doc.useActuals && data.state === "ready" && (
          <Button size="sm" variant="outline" onClick={data.refresh} disabled={data.refreshing} title={`Read from Actual at ${new Date(data.readAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}>
            <RefreshCw className={data.refreshing ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />Refresh
          </Button>
        )}
        <Button size="sm" variant="outline" title="How to read and work in a cash plan, and the keyboard shortcuts (?)" onClick={() => setGuide("start")}><BookOpen className="size-3.5" aria-hidden />Guide</Button>
        <Button size="icon-sm" variant={view.details ? "secondary" : "ghost"} aria-pressed={view.details} aria-label={view.details ? "Hide details" : "Show details"} title="Details panel" onClick={() => setView((v) => ({ ...v, details: !v.details }))}><PanelRight className="size-3.5" aria-hidden /></Button>
      </div>
      <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" aria-hidden tabIndex={-1} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void importFile(file); }} />
    </div>
  );

  return (
    <PageLayout header={header} scrollManaged>
      {session.status === "conflict" && (
        <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <span>This plan was changed or deleted somewhere else (another tab or device) after it was opened here, so your changes here have not been saved. If it was deleted, loading the other version closes it here, and keeping yours puts it back.</span>
          <span className="flex gap-1.5"><Button size="xs" variant="outline" onClick={onReload}>Load the other version</Button><Button size="xs" variant="outline" onClick={onOverwrite}>Keep mine and overwrite</Button></span>
        </div>
      )}
      {unreadable.length > 0 && <div className="shrink-0 px-4 pt-2"><UnreadableNotice plans={unreadable} onDelete={onDeleteUnreadable} /></div>}
      {doc.useActuals && data.state === "error" ? (
        <Centered title="Actual could not be read" detail={`${data.message}. This plan uses Actual for past months and balances, so nothing is shown until the read succeeds.`} action={<Button size="sm" onClick={data.retry}>Try again</Button>} />
      ) : !computed ? (
        <Centered title="Reading Actual…" detail={data.state === "loading" ? data.stage : undefined} busy />
      ) : (
        <>
          <SummaryStrip doc={doc} computed={computed} onGo={goToMonth} />
          {view.chart && <BalanceChart doc={doc} computed={computed} window={view.mode === "months" ? { fromYear, span } : null} onPickYear={(year) => { setFromYear(year); setView((v) => ({ ...v, mode: "months" })); }} />}
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              {doc.rows.length === 0 && (
                <p className="shrink-0 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                  This plan has no rows yet. Add one with the <span className="font-medium text-foreground">+</span> beside Income or Expenses{doc.useActuals ? ", or select a “Not in plan” line to turn what Actual recorded into rows" : ""}.
                </p>
              )}
              <PlanGrid
                doc={doc} computed={computed} lines={lines} columns={columns} cents={view.cents} pastMode={view.pastMode} selection={selection} problems={problems} linkNotes={linkNotes}
                shiftedCells={shiftedCells} find={find} onFind={setFind} scrollToken={scrollToken} scrollMonth={scrollMonth}
                onSelect={(next) => { setSelection(next); setPickedColumn(null); }}
                pickedColumn={pickedColumn} onPickColumn={(key, fromKeyboard) => {
                  // A click on a header replaces the selection; the keyboard keeps the active cell, and the summary stands in for its details until the cell moves or Escape closes it.
                  if (!fromKeyboard) setSelection(null);
                  setPickedColumn(key);
                  if (key) setView((v) => ({ ...v, details: true }));
                }}
                onCollapseAll={(collapse) => setView((v) => ({ ...v, collapsed: collapse ? [...SECTIONS.map((x) => `section:${x}`), ...doc.groups.map((g) => `group:${g.id}`)] : [] }))}
                onToggle={(k) => setView((v) => ({ ...v, collapsed: v.collapsed.includes(k) ? v.collapsed.filter((x) => x !== k) : [...v.collapsed, k] }))}
                onEdit={editCells} onCommand={onCommand} onNotice={(message) => toast.message(message)}
              />
            </div>
            {view.details && (
              <Inspector
                doc={doc} computed={computed} snapshot={snapshot} placed={placed} line={pickedColumnValue ? null : selectedLine} column={pickedColumnValue ? null : selectedColumn} problems={problems} linkNotes={linkNotes}
                width={Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, view.panelWidth))} onResize={(panelWidth) => setView((v) => ({ ...v, panelWidth }))}
                onEdit={edit} onSelectLine={selectLine} onAddRow={addRowTo} onDeleteRow={deleteRow} onShowTransactions={setTransactions}
                onClose={() => setView((v) => ({ ...v, details: false }))}
                overviewSubtitle={pickedColumnValue ? (pickedColumnValue.kind === "year" ? (pickedColumnValue.partial ? "Year total (part of the year)" : "Year total") : !doc.useActuals ? "Plan" : computed.kinds[pickedColumnValue.index] === "actual" ? "Actual" : computed.kinds[pickedColumnValue.index] === "current" ? "This month, recorded so far and expected" : "Forecast") : undefined}
                overviewTitle={pickedColumn && pickedColumnValue ? (pickedColumnValue.kind === "month" ? monthLabel(pickedColumnValue.month) : String(pickedColumnValue.year)) : undefined}
                overview={pickedColumnValue ? <MonthSummary doc={doc} computed={computed} snapshot={snapshot} placed={placed} column={pickedColumnValue} onShowTransactions={setTransactions} onSelectLine={selectLine} /> : <Overview doc={doc} computed={computed} data={data} problems={problems} placed={placed} onShowUnplanned={showUnplanned} onSelectLine={selectLine} onOpenSettings={() => setSettings(true)} onHelp={() => setGuide("working")} />}
              />
            )}
          </div>
        </>
      )}
      {settings && <PlanSettingsDialog doc={doc} snapshot={snapshot} onEdit={edit} onClose={() => setSettings(false)} />}
      {transactions && snapshot && placed && <TransactionsDialog request={transactions} doc={doc} snapshot={snapshot} placed={placed} onEdit={edit} onClose={() => setTransactions(null)} />}
      {adding && <AddRowDialog doc={doc} snapshot={snapshot} section={adding.section} groupId={adding.groupId} onAdd={added} onClose={() => setAdding(null)} />}
      {guide && <CashflowGuide section={guide} onSection={setGuide} onClose={() => setGuide(null)} docsUrl={DOCS_URL} />}
      <ConfirmDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }} state={confirm} />
    </PageLayout>
  );
}

/** What the details panel shows when nothing is selected: goals, what needs a look, and how the grid works. */
function Overview({ doc, computed, data, problems, placed, onShowUnplanned, onSelectLine, onOpenSettings, onHelp }: { onHelp: () => void; /** Lists the transactions behind a "Not in plan" figure of the last 12 months. */ onShowUnplanned: (section: SectionId) => void; doc: PlanDocument; computed: Computed; data: ReturnType<typeof useCashflowData>; problems: ReadonlyMap<string, string>; placed: Placed | null; onSelectLine: (key: string | null) => void; onOpenSettings: () => void }) {
  const rowName = new Map(doc.rows.map((r) => [r.id, r.name]));
  // What Actual recorded in the last twelve months that no row follows, per section.
  const unplanned = useMemo(() => {
    if (!placed || computed.currentIndex < 0) return [];
    const from = computed.months[Math.max(0, computed.currentIndex - 12)], to = computed.months[computed.currentIndex];
    return SECTIONS.map((section) => {
      let amount = 0;
      for (const c of placed.contributions) if (c.target === unplannedTarget(section) && c.month >= from && c.month < to) amount += c.amount;
      return { section, amount };
    }).filter((s) => s.amount !== 0);
  }, [placed, computed]);
  const heading = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
  return (
    <>
      <section className="space-y-2">
        <h3 className={heading}>Goals</h3>
        {computed.goals.length === 0 ? <p className="text-muted-foreground">No goals yet. <button type="button" className="underline underline-offset-2" onClick={onOpenSettings}>Add one in Plan settings</button> to see whether the forecast gets there.</p> : (
          <ul className="space-y-1.5">
            {computed.goals.map((result) => <GoalCard key={result.goal.id} result={result} computed={computed} />)}
          </ul>
        )}
      </section>

      {problems.size > 0 && (
        <section className="space-y-2">
          <h3 className={heading}>Needs a look</h3>
          <ul className="divide-y divide-border/50 rounded-md border border-border">
            {[...problems].map(([rowId, what]) => (
              <li key={rowId}><button type="button" className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-accent" onClick={() => onSelectLine(`row:${rowId}`)}><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden /><span className="min-w-0"><span className="font-medium">{rowName.get(rowId)}</span><span className="text-muted-foreground">: {what}</span></span></button></li>
            ))}
          </ul>
        </section>
      )}

      {unplanned.length > 0 && (
        <section className="space-y-2">
          <h3 className={heading}>Not in plan, last 12 months</h3>
          <p className="text-muted-foreground">Recorded in Actual but followed by no row, so it is not forecast. Select one to add rows for it.</p>
          <ul className="divide-y divide-border/50 rounded-md border border-border">
            {unplanned.map(({ section, amount }) => (
              <li key={section} className="flex h-7 items-center hover:bg-accent/40">
                <button type="button" className="h-full min-w-0 flex-1 truncate px-2 text-left hover:bg-accent" title="Select this line" onClick={() => onSelectLine(`unplanned:${section}`)}>{SECTION_LABEL[section]}</button>
                <button type="button" className="h-full shrink-0 px-2 tabular-nums underline decoration-dotted underline-offset-2 hover:bg-accent" title="Show the transactions" aria-label={`Show the transactions behind ${SECTION_LABEL[section]}`} onClick={() => onShowUnplanned(section)}>{money(amount)}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {doc.useActuals && data.state === "ready" && (data.unclassified > 0 || data.pending.loans || data.pending.budget || data.failedReads.length > 0) && (
        <section className="space-y-1.5">
          <h3 className={heading}>Actual data</h3>
          {data.unclassified > 0 && <p className="text-muted-foreground">{data.unclassified} {data.unclassified === 1 ? "account has" : "accounts have"} no class, so the plan guesses: on budget counts as cash, off budget is left outside. Set classes on the <Link href="/accounts" className="underline underline-offset-2">Accounts</Link> page, or choose per account in Plan settings.</p>}
          {data.failedReads.length > 0 && (
            <p className="text-amber-700 dark:text-amber-400" role="status">
              {data.failedReads.map((r) => FAILED_READ[r]).join(" ")} The plan works without {data.failedReads.length === 1 ? "it" : "them"}, but what depends on {data.failedReads.length === 1 ? "it is" : "them are"} left out.{" "}
              <button type="button" className="underline underline-offset-2" onClick={data.refresh} disabled={data.refreshing}>Try again</button>
            </p>
          )}
          {data.pending.loans && <p className="text-muted-foreground" role="status">Reading loan schedules…</p>}
          {data.pending.budget && <p className="text-muted-foreground" role="status">Reading the budget…</p>}
        </section>
      )}

      <section className="space-y-3">
        <h3 className={heading}>How the grid works</h3>
        {([
          ["Reading it", [
            ...(doc.useActuals ? ["Past months are what Actual recorded, in blue. The forecast starts from today’s real balance."] : []),
            "Amounts are positive in their section’s direction. A negative expense is a refund; a negative saving is a withdrawal.",
          ]],
          ["Typing amounts", [
            "Type in a coming month to override the forecast; a marked corner shows a typed amount. Delete clears it.",
          ]],
          ["Working with rows", [
            "Select a row to see its month, choose where its forecast comes from, and set what it follows.",
            "Double-click a name to rename it; drag it onto another row, group or section to move it.",
            "Right-click a cell or a row for more.",
          ]],
        ] as [string, string[]][]).map(([title, items]) => (
          <div key={title} className="space-y-1">
            <h4 className="font-medium text-foreground">{title}</h4>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">{items.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        ))}
        <button type="button" className="underline underline-offset-2" onClick={onHelp}>Open the guide</button>
      </section>
    </>
  );
}
