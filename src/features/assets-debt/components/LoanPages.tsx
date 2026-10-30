"use client";

import { localToday } from "../lib/calendarDate";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { getTransport } from "@/lib/actual";
import { readOffsetHistories, type OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import { archiveDebt, createDebt, DebtApiError, deleteDebtPermanently, getDebt, listDebts, recordDebtObservation, updateDebt } from "../lib/debtsApi";
import { detailToStates, newSimulation, newTracking, statesToSaveInput, summarizeProfile, type SaveIssue, type SimulationState, type TrackingState } from "../lib/simulatorModel";
import { LOANS_PATH, loanPath } from "../lib/routes";
import { useAccountDirectory } from "../lib/useAccountDirectory";
import { SAVE_BOUNDARY } from "./saveBoundary";
import { ScheduleControls, SimulatorView } from "./simulator/SimulatorView";
import { strategyAdvice } from "../lib/strategyAdvice";
import { purgeLegacyLoanStorage } from "../lib/loanStorage";
import { WorkspaceFrame, workspaceTabFor, workspaceTabSlug, type WorkspaceTab } from "./workspace/WorkspaceFrame";
import { LinkToActual } from "./loan/LinkToActual";
import { LinkedAssetsTab } from "./loan/LinkedAssetsTab";
import { TrackingDialogs, TrackingTab, useTrackingWorkspace } from "./loan/TrackingTabs";
import { useLoanTracking } from "../lib/useLoanTracking";
import { trackedHistory } from "../lib/trackedSchedule";
import { RefreshCw } from "lucide-react";

/**
 * The loan workspace pages (RD-084 P1.3b T204, T214, T216; P1.6b T288).
 *
 * Both open in the focused workspace (Activity · Calculation · Setup) without
 * the Assets & Debt section chrome.
 *
 * New loan: opens on Schedule (unsaved, in memory) → Next: Settings → Save
 * loan (or Save as draft from the ⋯ menu). Nothing is saved, and nothing reads
 * Actual, until Setup; nothing here writes to Actual.
 *
 * Existing loan: opens on Activity. Calculation is the same simulator from the
 * saved configuration, with unsaved changes marked; Save changes goes through
 * the existing revision rules.
 */

const today = () => localToday();
const storageKey = (connectionId: string, budget: string) => `assets-debt:new-loan:${connectionId}:${budget}`;
const currencyKey = "assets-debt:currency-preference";
const drafts = new Map<string, { sim: SimulationState; tracking: TrackingState }>();

function readSession<T>(key: string): T | null {
  purgeLegacyLoanStorage();
  return (drafts.get(key) as T | undefined) ?? null;
}

function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

function IssueList({ issues }: { issues: SaveIssue[] }) {
  if (!issues.length) return null;
  return (
    <div role="alert" className="mx-4 mt-3 rounded-md border border-destructive/40 px-3 py-2 text-sm">
      <p className="font-medium">The loan was not saved.</p>
      <ul className="list-disc pl-5 text-xs">
        {issues.map((i) => (
          <li key={`${i.field}:${i.message}`}>{i.message}</li>
        ))}
      </ul>
    </div>
  );
}


export function NewLoanView() {
  useEffect(() => { purgeLegacyLoanStorage(); }, []);
  const connection = useConnectionStore(selectActiveInstance);
  return <NewLoanEditor key={`${connection?.id}:${connection?.budgetSyncId}`} />;
}

function NewLoanEditor() {
  const connection = useConnectionStore(selectActiveInstance);
  const budget = connection?.budgetSyncId ?? null;
  const key = connection && budget ? storageKey(connection.id, budget) : null;
  const existing = useQuery({ queryKey: ["assets-debt", "debts", budget], queryFn: () => listDebts(budget!), enabled: !!budget });
  const [sim, setSim] = useState<SimulationState | null>(null);
  const [tracking, setTracking] = useState<TrackingState | null>(null);
  // New loans open on Calculation (owner decision); Activity exists once the loan is saved.
  const [tab, setTab] = useState<WorkspaceTab>("calculation");
  const [issues, setIssues] = useState<SaveIssue[]>([]);
  const [savePhase, setSavePhase] = useState<string | null>(null);
  const [scheduleDialog, setScheduleDialog] = useState<"method" | "how" | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const directory = useAccountDirectory();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Restore only this tab’s memory draft; browser storage never holds loan financial data.
  useEffect(() => {
    if (!key || !budget || sim || existing.isLoading) return;
    const restored = readSession<{ sim: SimulationState; tracking: TrackingState }>(key);
    let currency = existing.data?.[0]?.currency ?? null;
    try {
      currency ??= localStorage.getItem(currencyKey);
    } catch {
      // storage unavailable: fall through to the default
    }
    const fresh = restored?.sim ?? newSimulation({ currency: currency ?? "USD", today: today() });
    setSim(fresh);
    setTracking(restored?.tracking ?? newTracking(fresh));
  }, [key, budget, sim, existing.isLoading, existing.data]);

  useEffect(() => {
    if (!key || !sim || !tracking) return;
    drafts.set(key, { sim, tracking });
  }, [key, sim, tracking]);

  const dirty = !!sim && (sim.principalMinor !== null || sim.termMonths !== null);
  useLeaveGuard(dirty);

  const save = useMutation({
    mutationFn: async (status: "active" | "draft") => {
      if (!sim || !tracking || !budget) throw new Error("Not ready");
      const built = statesToSaveInput(sim, { ...tracking, status }, budget, strategyAdvice(sim).recommended);
      if (!built.ok) throw new DebtApiError("invalid", 400, built.issues);
      if (!directory.data) throw new DebtApiError("The budget's accounts have not loaded yet.", 400);
      setSavePhase("Saving loan…");
      const detail = await createDebt(built.input, directory.data);
      return { detail };
    },
    onSuccess: ({ detail }: { detail: DebtDetail }) => {
      setSavePhase(null);
      try {
        if (key) drafts.delete(key);
        if (budget && sim) localStorage.setItem(currencyKey, sim.currency);
      } catch {
        // storage unavailable
      }
      void queryClient.invalidateQueries({ queryKey: ["assets-debt"] });
      toast.success(detail.debt.status === "active" ? (detail.debt.trackingStartDueDate ? "Loan saved and tracked in Actual" : "Loan saved") : "Draft saved");
      // A tracked loan opens on Repayments; a calculator stays on Terms & Schedule.
      router.push(`${loanPath(detail.debt.id)}?view=${detail.debt.trackingStartDueDate ? "repayments" : "schedule"}`);
    },
    onError: (error) => setIssues(error instanceof DebtApiError && error.issues.length ? error.issues : [{ field: "(save)", message: error instanceof Error ? error.message : "The loan could not be saved" }]),
  });

  if (!budget) return <p className="px-4 py-6 text-sm text-muted-foreground">Connect to a budget to simulate and track a loan.</p>;
  if (!sim || !tracking) return <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>;
  const complete = statesToSaveInput(sim, { ...tracking, name: "x", status: "draft", offsetAccountMap: Object.fromEntries(sim.offsets.map((o) => [o.placeholderAccountId, "x"])) }, budget, "bench-daily").ok;

  const toSetup = () => setTab("setup");
  const newComplete = !!tracking.name.trim();
  const actions = tab === "calculation" ? (
    <>
      <ScheduleControls onDialog={setScheduleDialog} />
      <Button type="button" size="sm" disabled={!complete} title={complete ? undefined : "Complete the loan amount, term, rate and start date first"} onClick={toSetup}>
        Next: Link to Actual
        <ArrowRight data-icon="inline-end" aria-hidden="true" />
      </Button>
    </>
  ) : (
    // Active when the loan settings are complete; otherwise kept as a draft to finish later.
    <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate(newComplete ? "active" : "draft")}>
      {save.isPending ? savePhase ?? "Saving…" : newComplete ? "Save loan" : "Save as draft"}
    </Button>
  );
  return (
    <WorkspaceFrame
      title={tracking.name || "New loan"}
      state="Not saved yet"
      tab={tab}
      onTab={setTab}
      disabledTabs={{ activity: "Save the loan first", ledger: "Save the loan first", assets: "Save the loan first", ...(complete ? {} : { setup: "Complete the calculation first" }) }}
      actions={actions}
      menu={tab === "setup" && newComplete ? [{ label: "Save as draft", onSelect: () => save.mutate("draft") }] : tab === "calculation" ? [{ label: "Reset loan", destructive: true, onSelect: () => setResetOpen(true) }] : []}
      dirty={dirty}
      onDiscard={() => { if (key) drafts.delete(key); }}
    >
      <IssueList issues={issues} />
      {tab === "calculation" ? (
        <SimulatorView embedded sim={sim} onChange={setSim} title="Schedule" loanName={tracking.name} badge="Not saved yet" revision={null} actions={null}
          external={{ comparing: false, dialog: scheduleDialog, onDialogChange: setScheduleDialog, resetOpen, onResetOpenChange: setResetOpen }} />
      ) : (
        <>
          <p className="px-4 pt-3 text-xs text-muted-foreground">{SAVE_BOUNDARY} {summarizeProfile(sim.profile)}.</p>
          <LinkToActual sim={sim} setSimulation={setSim} tracking={tracking} setTracking={setTracking} directory={directory.data} issues={issues} rules={null} onEditRules={() => {}} saved={false} />
        </>
      )}
    </WorkspaceFrame>
  );
}

export function LoanView({ id }: { id: string }) {
  useEffect(() => { purgeLegacyLoanStorage(); }, []);
  const connection = useConnectionStore(selectActiveInstance);
  return <LoanEditor key={`${connection?.id}:${id}`} id={id} />;
}

function LoanEditor({ id }: { id: string }) {
  const connection = useConnectionStore(selectActiveInstance);
  const debt = useQuery({ queryKey: ["assets-debt", "debt", id], queryFn: () => getDebt(id) });
  const directory = useAccountDirectory();
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const saved = useMemo(() => (debt.data ? detailToStates(debt.data) : null), [debt.data]);
  const [sim, setSim] = useState<SimulationState | null>(null);
  const [tracking, setTracking] = useState<TrackingState | null>(null);
  const [issues, setIssues] = useState<SaveIssue[]>([]);
  const [savePhase, setSavePhase] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [offsetAsOfDate, setOffsetAsOfDate] = useState(today());
  const [comparing, setComparing] = useState(false);
  const [scheduleDialog, setScheduleDialog] = useState<"method" | "how" | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const trackedOffsetAccounts = useMemo(
    () => debt.data?.offsets.filter((offset) => offset.useActualBalance === true).map((offset) => offset.actualAccountId) ?? [],
    [debt.data]
  );
  const offsetHistory = useQuery({
    queryKey: ["assets-debt", "offset-history", connection?.id, id, offsetAsOfDate, trackedOffsetAccounts.join("|")],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return readOffsetHistories(getTransport(connection), { accountIds: trackedOffsetAccounts, asOfDate: offsetAsOfDate });
    },
    enabled: !!connection && connection.budgetSyncId === debt.data?.debt.budgetSyncId && trackedOffsetAccounts.length > 0,
  });
  const offsetSnapshots = useMemo((): OffsetHistorySnapshot[] | undefined => {
    if (!offsetHistory.data?.ok || !debt.data) return undefined;
    const placeholder = new Map(debt.data.offsets.map((offset) => [offset.actualAccountId, `offset:${offset.id}`]));
    return offsetHistory.data.snapshots.map((snapshot) => ({ ...snapshot, accountId: placeholder.get(snapshot.accountId) ?? snapshot.accountId }));
  }, [offsetHistory.data, debt.data]);

  const [editingBase, setEditingBase] = useState<typeof saved>(null);
  // The optional "what changed" note describes a save; on its own it is not a change.
  const dirty = !!editingBase && !!sim && !!tracking && (JSON.stringify(editingBase.simulation) !== JSON.stringify(sim) || JSON.stringify(editingBase.tracking) !== JSON.stringify({ ...tracking, changeSummary: editingBase.tracking.changeSummary }));
  const remoteChanged = saved !== editingBase && dirty;
  // Adjust this component's editable copy before rendering children when a new saved value arrives.
  // Local edits retain their original base and expose the conflict instead of being overwritten.
  if (saved !== editingBase && !dirty) {
    setEditingBase(saved);
    setSim(saved?.simulation ?? null);
    setTracking(saved?.tracking ?? null);
  }
  useLeaveGuard(dirty);
  const detail = debt.data;
  const readOnly = detail?.debt.status === "archived";
  const activatable = !!tracking?.name.trim();
  const loanTracking = useLoanTracking(detail);
  const trackedStart = loanTracking.debt?.trackingStartDueDate ?? null;
  const trackedResult = loanTracking.result;
  const trackedToday = loanTracking.today;
  const scheduleTracked = useMemo(() => (trackedResult?.ok && trackedStart
    ? { ...trackedHistory(trackedResult, trackedStart, trackedToday), onOpenLedger: () => router.replace(`${pathname}?view=${workspaceTabSlug("ledger")}`) }
    : null), [trackedResult, trackedStart, trackedToday, router, pathname]);
  const ws = useTrackingWorkspace(detail, loanTracking, directory.data);

  const recordedOpening = useRef<{ key: string; observationId: string } | null>(null);
  const save = useMutation({
    // `leaving`: saved on the way out of the page; read in onSuccess.
    mutationFn: async (options?: { leaving?: boolean }) => {
      void options;
      if (!sim || !tracking || !detail) throw new Error("Not ready");
      if (remoteChanged) throw new Error("The saved loan changed while you were editing. Reload the saved version before saving.");
      if (connection?.budgetSyncId !== detail.debt.budgetSyncId) throw new Error("Connect to this loan’s budget before saving.");
      // A draft becomes active on the first save with its loan settings complete (owner decision 2026-10-05).
      const status = tracking.status === "draft" && activatable ? "active" : tracking.status;
      const built = statesToSaveInput(sim, { ...tracking, status }, detail.debt.budgetSyncId, strategyAdvice(sim).recommended);
      if (!built.ok) throw new DebtApiError("invalid", 400, built.issues);
      if (!directory.data) throw new DebtApiError("The budget's accounts have not loaded yet.", 400);
      // A lender statement typed as the opening position is recorded first, then the loan points at it.
      if (tracking.openingStatementDraft && built.input.trackingStartDueDate) {
        setSavePhase("Recording the lender statement…");
        // A retry after a failed save reuses the statement already recorded for these figures, so none is duplicated.
        const draft = tracking.openingStatementDraft;
        const key = `${draft.date}|${draft.principalMinor}`;
        if (recordedOpening.current?.key !== key) {
          const observation = await recordDebtObservation(id, { observedOn: draft.date, recordedAt: new Date().toISOString(), principalMinor: draft.principalMinor, accruedInterestMinor: null, note: "Opening position for tracking" });
          recordedOpening.current = { key, observationId: observation.id };
        }
        built.input.openingObservationId = recordedOpening.current.observationId;
      }
      setSavePhase("Saving loan revision…");
      const next = await updateDebt(id, built.input, directory.data);
      return { next };
    },
    onSuccess: ({ next }, options) => {
      setSavePhase(null);
      const states = detailToStates(next);
      setEditingBase(states); setSim(states?.simulation ?? null); setTracking(states?.tracking ?? null);
      setIssues([]);
      toast.success(detail?.debt.status === "draft" && next.debt.status === "active"
        ? "Saved. The loan is now active."
        : next.debt.currentRevision === detail?.debt.currentRevision ? "Saved: no change to the calculation" : `Saved as revision ${next.debt.currentRevision}`);
      queryClient.setQueryData(["assets-debt", "debt", id], next);
      void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debts"] });
      void queryClient.invalidateQueries({ queryKey: ["assets-debt", "tracking", id] });
      // Tracking just turned on: show what it found.
      if (!options?.leaving && !detail?.debt.trackingStartDueDate && next.debt.trackingStartDueDate) router.replace(`${pathname}?view=${workspaceTabSlug("activity")}`);
    },
    onError: (error) => setIssues(error instanceof DebtApiError && error.issues.length ? error.issues : [{ field: "(save)", message: error instanceof Error ? error.message : "The loan could not be saved" }]),
    onSettled: () => setSavePhase(null),
  });
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const removeForever = useMutation({
    mutationFn: () => deleteDebtPermanently(id),
    onSuccess: () => {
      setDeleting(false);
      queryClient.removeQueries({ queryKey: ["assets-debt", "debt", id] });
      void queryClient.invalidateQueries({ queryKey: ["assets-debt"] });
      toast.success("Loan deleted permanently");
      router.push(LOANS_PATH);
    },
  });
  const archive = useMutation({
    mutationFn: () => archiveDebt(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["assets-debt"] });
      toast.success(detail?.debt.status === "draft" ? "Draft discarded" : "Loan archived");
      router.push(LOANS_PATH);
    },
  });

  if (debt.isLoading) return <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>;
  if (debt.isError || !detail) return <p role="alert" className="px-4 py-6 text-sm text-destructive">{(debt.error as Error)?.message ?? "Loan not found"}</p>;
  if (detail.blocked || !saved || !sim || !tracking) {
    return (
      <WorkspaceFrame title={detail.debt.name} state="Blocked" tab="activity" onTab={() => {}} disabledTabs={{ activity: "Blocked", calculation: "Blocked", setup: "Blocked" }} dirty={false}>
        <p role="status" className="m-4 rounded border border-destructive/40 px-3 py-2 text-sm">
          <span className="font-semibold">Blocked:</span> {detail.blocked?.message ?? "This loan's settings cannot be used."} Other loans are not affected.
        </p>
      </WorkspaceFrame>
    );
  }

  const staleStrategy = (() => {
    const advice = strategyAdvice(sim);
    const line = advice.lines.find((l) => l.strategy === tracking.executionStrategy);
    return line && !line.available ? `The saved engine (${line.label}) no longer fits these settings; saving will use ${advice.lines.find((l) => l.strategy === advice.recommended)?.label ?? "no engine"}.` : null;
  })();

  const tracked = loanTracking.tracked;
  // A tracked loan opens on Repayments; every other loan on Terms & Schedule (design spec 06 §4.1).
  const tab = workspaceTabFor(params?.get("view"), tracked ? "activity" : "calculation");
  const setTab = (next: WorkspaceTab) => router.replace(`${pathname}?view=${workspaceTabSlug(next)}`);
  const draft = detail.debt.status === "draft";
  const result = loanTracking.result?.ok ? loanTracking.result : null;
  const state = readOnly
    ? "Archived: read-only"
    : dirty ? "Unsaved changes"
      : draft ? "Draft"
        : detail.paidOff ? `Paid off ${detail.paidOff.paidDate}`
          : `Revision ${detail.debt.currentRevision}`;
  const toDo = result ? result.figures.counts.unrecorded + result.figures.counts.check + result.figures.counts.missing + (result.openingAdjustment ? 1 : 0) : 0;
  const unclassified = result ? result.ledger.filter((l) => l.type === "unclassified").length : 0;
  const attention = { ...(toDo ? { activity: `${toDo} to do` } : {}), ...(unclassified ? { ledger: `${unclassified} unclassified` } : {}) };
  const actions = (
    <>
      {tab === "calculation" ? <ScheduleControls comparing={comparing} onComparingChange={setComparing} onDialog={setScheduleDialog} /> : null}
      {tracked && (tab === "activity" || tab === "ledger" || tab === "assets") ? (
        <Button type="button" size="sm" variant="outline" disabled={loanTracking.refreshing || ws.run !== null} onClick={() => void loanTracking.refresh()}>
          <RefreshCw className="size-3.5" aria-hidden />{loanTracking.refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      ) : null}
      {dirty && !readOnly ? (
        <Input aria-label="What changed (optional)" placeholder="What changed (optional)" value={tracking.changeSummary} onChange={(e) => setTracking({ ...tracking, changeSummary: e.target.value })} className="h-7 w-52 text-xs" />
      ) : null}
      {dirty ? (
        <Button type="button" size="sm" variant="outline" onClick={() => { setEditingBase(saved); setSim(saved.simulation); setTracking(saved.tracking); setIssues([]); }}>
          Discard changes
        </Button>
      ) : null}
      {!readOnly && (dirty || tab === "calculation" || tab === "setup" || (draft && activatable)) ? (
        <Button type="button" size="sm" disabled={(!dirty && !(draft && activatable)) || save.isPending} onClick={() => save.mutate(undefined)}>
          {save.isPending ? savePhase ?? "Saving…" : draft && activatable ? "Save and activate" : "Save changes"}
        </Button>
      ) : null}
    </>
  );
  // A tracked loan cannot be reset: saving the sample loan over its terms would break the link to its history in Actual.
  const resetItem = tab === "calculation" && !readOnly && !tracked ? [{ label: "Reset loan", destructive: true, onSelect: () => setResetOpen(true) }] : [];
  const statementItem = tracked && !readOnly ? [{ label: "Check against lender statement", onSelect: () => ws.setDialog("statement") }] : [];
  const menu = readOnly ? [{ label: "Delete permanently", destructive: true, onSelect: () => { setTyped(""); setDeleting(true); } }] : [...resetItem, ...statementItem, {
    label: detail.debt.status === "draft" ? "Delete draft loan" : "Archive loan",
    destructive: true,
    onSelect: () =>
      setConfirm({
        title: detail.debt.status === "draft" ? "Delete this draft loan?" : "Archive this loan?",
        message: detail.debt.status === "draft" ? "The draft loan and all its saved settings are removed. Nothing changes in Actual." : "The loan keeps its history and revisions. Nothing changes in Actual.",
        destructiveLabel: detail.debt.status === "draft" ? "Delete draft loan" : "Archive",
        onConfirm: () => archive.mutate(),
      }),
  }];

  return (
    <WorkspaceFrame
      title={tracking.name || detail.debt.name}
      state={state}
      stateEmphasis={dirty}
      tab={tab}
      onTab={setTab}
      attention={attention}
      actions={actions}
      menu={menu}
      dirty={dirty}
      onSaveAndLeave={async () => {
        try {
          await save.mutateAsync({ leaving: true });
          return true;
        } catch {
          return false;
        }
      }}
    >
      <IssueList issues={issues} />
      {remoteChanged ? <div role="alert" className="mx-4 my-2 text-sm">The saved loan changed. Your edits are preserved. <Button variant="outline" size="sm" onClick={() => { setEditingBase(saved); setSim(saved?.simulation ?? null); setTracking(saved?.tracking ?? null); }}>Discard edits and reload</Button></div> : null}
      {staleStrategy && !readOnly ? <p className="mx-4 mt-2 text-xs text-muted-foreground">{staleStrategy}</p> : null}
      {tab === "activity" || tab === "ledger" ? (
        <TrackingTab tab={tab === "activity" ? "repayments" : "ledger"} detail={detail} tracking={loanTracking} directory={directory.data} digits={sim.minorDigits} ws={ws} onLinkToActual={() => setTab("setup")} />
      ) : (
        <TrackingDialogs detail={detail} tracking={loanTracking} directory={directory.data} digits={sim.minorDigits} ws={ws} />
      )}
      {tab === "assets" ? <LinkedAssetsTab detail={detail} digits={sim.minorDigits} today={loanTracking.today} owedMinor={result ? result.figures.owedInActualMinor : null} /> : null}
      {tab === "calculation" ? (
        <SimulatorView embedded sim={sim} onChange={setSim} saved={saved.simulation} chartViewKey={`assets-debt:chart-view:${id}`} title="Schedule" loanName={tracking.name || detail.debt.name} badge={state} readOnly={readOnly} revision={detail.debt.currentRevision} actions={null} tracked={scheduleTracked}
          external={{ comparing, dialog: scheduleDialog, onDialogChange: setScheduleDialog, resetOpen, onResetOpenChange: setResetOpen }} offsetTracking={trackedOffsetAccounts.length ? {
          asOfDate: offsetAsOfDate,
          onAsOfDateChange: setOffsetAsOfDate,
          snapshots: offsetSnapshots,
          loading: offsetHistory.isLoading || offsetHistory.isFetching,
          problems: offsetHistory.isError
            ? [offsetHistory.error instanceof Error ? offsetHistory.error.message : "Actual offset history could not be read."]
            : offsetHistory.data && !offsetHistory.data.ok
              ? offsetHistory.data.failures.map((failure) => `${failure.accountId}: ${failure.message}`)
              : [],
        } : undefined} />
      ) : null}
      {tab === "setup" ? (
        <LinkToActual sim={sim} setSimulation={readOnly ? undefined : setSim} tracking={tracking} setTracking={setTracking} directory={directory.data} issues={issues} rules={loanTracking.bundle?.rules ?? (detail.debt.status === "active" ? [] : null)} onEditRules={() => ws.setDialog("rules")} saved />
      ) : null}
      <ConfirmDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)} state={confirm} />
      <Dialog open={deleting} onOpenChange={(open) => !open && setDeleting(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {detail.debt.name} permanently?</DialogTitle>
            <DialogDescription>
              Everything Bench stored for this loan is deleted: its settings and revisions, matching rules, proposed and applied changes with their history, lender statements and restarts. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950/30">Nothing changes in Actual. Transactions Bench changed stay as they are, and Bench can no longer undo them.</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="confirm-loan-name" className="text-xs">Type the loan&apos;s name to confirm: <span className="font-semibold">{detail.debt.name}</span></Label>
            <Input id="confirm-loan-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
          {removeForever.isError ? <p role="alert" className="text-xs text-destructive">{String((removeForever.error as Error)?.message ?? removeForever.error)}</p> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleting(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={typed.trim() !== detail.debt.name || removeForever.isPending} onClick={() => removeForever.mutate()}>Delete permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceFrame>
  );
}
