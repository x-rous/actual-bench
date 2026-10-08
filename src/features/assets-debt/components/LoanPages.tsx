"use client";

import { localToday } from "../lib/calendarDate";
import { useEffect, useMemo, useState } from "react";
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
import { archiveDebt, createDebt, DebtApiError, deleteDebtPermanently, getDebt, listDebts, listMatchRules, updateDebt } from "../lib/debtsApi";
import { detailToStates, newSimulation, newTracking, statesToSaveInput, summarizeProfile, type SaveIssue, type SimulationState, type TrackingState } from "../lib/simulatorModel";
import { LOANS_PATH, loanPath } from "../lib/routes";
import { afterMatchingSetup, setUpRepaymentMatching, type AutoMatchingResult } from "../lib/autoMatching";
import { useAccountDirectory } from "../lib/useAccountDirectory";
import { SAVE_BOUNDARY } from "./saveBoundary";
import { ScheduleControls, SimulatorView } from "./simulator/SimulatorView";
import { strategyAdvice } from "../lib/strategyAdvice";
import { purgeLegacyLoanStorage } from "../lib/loanStorage";
import { LoanActivity } from "./workspace/LoanActivity";
import { MatchingEditor } from "./rules/MatchingEditor";
import { LoanSetup, loanSettingsComplete, setupChecklist } from "./workspace/LoanSetup";
import { WorkspaceFrame, workspaceTabFor, workspaceTabSlug, type WorkspaceTab } from "./workspace/WorkspaceFrame";

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
const currencyKey = (_budget: string) => "assets-debt:currency-preference";
const drafts = new Map<string, { sim: SimulationState; tracking: TrackingState }>();

/** The automatic matching setup never stops a save: a failure leaves the usual required step. */
async function autoMatch(detail: DebtDetail, transport: ReturnType<typeof getTransport>): Promise<AutoMatchingResult | null> {
  try {
    return await setUpRepaymentMatching(detail, transport);
  } catch (error) {
    toast.warning(`The loan was saved, but repayment matching was not set up: ${error instanceof Error ? error.message : "setup failed"}. Open Link to Actual to retry.`);
    return null;
  }
}

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
      currency ??= localStorage.getItem(currencyKey(budget));
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
      setSavePhase("Setting up repayment matching…");
      return { detail, matching: connection ? await autoMatch(detail, getTransport(connection)) : null };
    },
    onSuccess: ({ detail, matching }: { detail: DebtDetail; matching: AutoMatchingResult | null }) => {
      setSavePhase(null);
      try {
        if (key) drafts.delete(key);
        if (budget && sim) localStorage.setItem(currencyKey(budget), sim.currency);
      } catch {
        // storage unavailable
      }
      void queryClient.invalidateQueries({ queryKey: ["assets-debt"] });
      toast.success(detail.debt.status === "active" ? "Loan added to Assets & Debt" : "Draft saved");
      const landing = matching ? afterMatchingSetup(matching, detail.debt.id, loanPath) : null;
      if (landing?.message) (landing.tone === "success" ? toast.success : toast.warning)(landing.message);
      router.push(landing?.href ?? loanPath(detail.debt.id));
    },
    onError: (error) => setIssues(error instanceof DebtApiError && error.issues.length ? error.issues : [{ field: "(save)", message: error instanceof Error ? error.message : "The loan could not be saved" }]),
  });

  if (!budget) return <p className="px-4 py-6 text-sm text-muted-foreground">Connect to a budget to simulate and track a loan.</p>;
  if (!sim || !tracking) return <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>;
  const complete = statesToSaveInput(sim, { ...tracking, name: "x", status: "draft", offsetAccountMap: Object.fromEntries(sim.offsets.map((o) => [o.placeholderAccountId, "x"])) }, budget, "bench-daily").ok;

  const toSetup = () => setTab("setup");
  const newComplete = loanSettingsComplete(setupChecklist({ sim, tracking, directory: directory.data, matchingEnabled: null }));
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
      disabledTabs={{ activity: "Available after the loan is saved", ...(complete ? {} : { setup: "Complete the calculation first" }) }}
      actions={actions}
      menu={tab === "setup" && newComplete ? [{ label: "Save as draft", onSelect: () => save.mutate("draft") }] : tab === "calculation" ? [{ label: "Reset loan", destructive: true, onSelect: () => setResetOpen(true) }] : []}
      dirty={dirty}
    >
      <IssueList issues={issues} />
      {tab === "calculation" ? (
        <SimulatorView embedded sim={sim} onChange={setSim} title="Schedule" badge="Not saved yet" revision={null} actions={null}
          external={{ comparing: false, dialog: scheduleDialog, onDialogChange: setScheduleDialog, resetOpen, onResetOpenChange: setResetOpen }} />
      ) : (
        <>
          <p className="px-4 pt-3 text-xs text-muted-foreground">{SAVE_BOUNDARY} {summarizeProfile(sim.profile)}.</p>
          <LoanSetup debtId={null} sim={sim} setSimulation={setSim} tracking={tracking} setTracking={setTracking} directory={directory.data} issues={issues} />
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
  const [remoteChanged, setRemoteChanged] = useState(false);
  useEffect(() => {
    if (saved === editingBase) return;
    const edited = editingBase && sim && tracking && (JSON.stringify(sim) !== JSON.stringify(editingBase.simulation) || JSON.stringify({ ...tracking, changeSummary: editingBase.tracking.changeSummary }) !== JSON.stringify(editingBase.tracking));
    if (edited) { setRemoteChanged(true); return; }
    setEditingBase(saved);
    setRemoteChanged(false);
    // Load (or reload after a save) the saved states into the editable copies.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the editable copy starts from each newly loaded revision
    setSim(saved?.simulation ?? null);
    setTracking(saved?.tracking ?? null);
  }, [saved, editingBase, sim, tracking]);

  // The optional "what changed" note describes a save; on its own it is not a change.
  const dirty = !!editingBase && !!sim && !!tracking && (JSON.stringify(editingBase.simulation) !== JSON.stringify(sim) || JSON.stringify(editingBase.tracking) !== JSON.stringify({ ...tracking, changeSummary: editingBase.tracking.changeSummary }));
  useLeaveGuard(dirty);
  const detail = debt.data;
  const readOnly = detail?.debt.status === "archived";
  const rules = useQuery({ queryKey: ["assets-debt", "match-rules", id], queryFn: () => listMatchRules(id), enabled: !!id });
  const checklist = sim && tracking ? setupChecklist({ sim, tracking, directory: directory.data, matchingEnabled: rules.data ? rules.data.some((r) => r.record.enabled && r.record.purpose === "repayment") : null }) : [];
  const activatable = checklist.length > 0 && loanSettingsComplete(checklist);

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
      setSavePhase("Saving loan revision…");
      const next = await updateDebt(id, built.input, directory.data);
      // A loan saved active with its accounts and no matching rule yet gets the suggested one (owner decision 2026-10-06).
      setSavePhase("Checking repayment matching…");
      const matching = connection && next.debt.status === "active" && rules.data?.length === 0 ? await autoMatch(next, getTransport(connection)) : null;
      return { next, matching };
    },
    onSuccess: ({ next, matching }, options) => {
      setSavePhase(null);
      const states = detailToStates(next);
      setEditingBase(states); setSim(states.simulation); setTracking(states.tracking); setRemoteChanged(false);
      setIssues([]);
      toast.success(detail?.debt.status === "draft" && next.debt.status === "active"
        ? "Saved. The loan is now active."
        : next.debt.currentRevision === detail?.debt.currentRevision ? "Saved: no change to the calculation" : `Saved as revision ${next.debt.currentRevision}`);
      queryClient.setQueryData(["assets-debt", "debt", id], next);
      void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debts"] });
      const landing = matching ? afterMatchingSetup(matching, id, loanPath) : null;
      if (landing?.href) {
        void queryClient.invalidateQueries({ queryKey: ["assets-debt", "match-rules", id] });
        if (landing.message) (landing.tone === "success" ? toast.success : toast.warning)(landing.message);
        // Saving on the way out of the page: the rule is set up, but the user's navigation wins.
        if (!options?.leaving) router.replace(landing.href);
      }
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

  const tab = workspaceTabFor(params?.get("view"), "activity");
  const setTab = (next: WorkspaceTab) => router.replace(`${pathname}?view=${workspaceTabSlug(next)}`);
  const done = checklist.filter((c) => c.done).length;
  const draft = detail.debt.status === "draft";
  const state = readOnly
    ? "Archived: read-only"
    : dirty ? "Unsaved changes"
      : draft ? (activatable ? "Setup complete · not active yet" : `Setup incomplete · ${done} of ${checklist.length}`)
        : detail.paidOff ? `Paid off ${detail.paidOff.paidDate} · revision ${detail.debt.currentRevision}`
          : done < checklist.length ? `Active · setup ${done} of ${checklist.length}` : `Active · revision ${detail.debt.currentRevision}`;
  const actions = (
    <>
      {tab === "calculation" ? <ScheduleControls comparing={comparing} onComparingChange={setComparing} onDialog={setScheduleDialog} /> : null}
      {dirty && !readOnly ? (
        <Input aria-label="What changed (optional)" placeholder="What changed (optional)" value={tracking.changeSummary} onChange={(e) => setTracking({ ...tracking, changeSummary: e.target.value })} className="h-7 w-52 text-xs" />
      ) : null}
      {dirty ? (
        <Button type="button" size="sm" variant="outline" onClick={() => { setEditingBase(saved); setSim(saved.simulation); setTracking(saved.tracking); setRemoteChanged(false); setIssues([]); }}>
          Discard changes
        </Button>
      ) : null}
      {!readOnly && (dirty || tab !== "activity" || (draft && activatable)) ? (
        <Button type="button" size="sm" disabled={(!dirty && !(draft && activatable)) || save.isPending} onClick={() => save.mutate(undefined)}>
          {save.isPending ? savePhase ?? "Saving…" : draft && activatable ? "Save and activate" : "Save changes"}
        </Button>
      ) : null}
    </>
  );
  const resetItem = tab === "calculation" && !readOnly ? [{ label: "Reset loan", destructive: true, onSelect: () => setResetOpen(true) }] : [];
  const menu = readOnly ? [{ label: "Delete permanently", destructive: true, onSelect: () => { setTyped(""); setDeleting(true); } }] : [...resetItem, {
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
      {remoteChanged ? <div role="alert" className="mx-4 my-2 text-sm">The saved loan changed. Your edits are preserved. <Button variant="outline" size="sm" onClick={() => { setEditingBase(saved); setSim(saved?.simulation ?? null); setTracking(saved?.tracking ?? null); setRemoteChanged(false); }}>Discard edits and reload</Button></div> : null}
      {staleStrategy && !readOnly ? <p className="mx-4 mt-2 text-xs text-muted-foreground">{staleStrategy}</p> : null}
      {tab === "activity" ? (
        <LoanActivity debt={detail} directory={directory.data} offsetHistories={offsetHistory.data?.ok ? offsetHistory.data.snapshots : undefined} initialFilter={(["action", "waiting", "applied", "undone", "all"] as const).find((f) => f === params?.get("filter")) ?? "action"} scheduleDirty={dirty} />
      ) : null}
      {tab === "calculation" ? (
        <SimulatorView embedded sim={sim} onChange={setSim} saved={saved.simulation} title="Schedule" badge={state} readOnly={readOnly} revision={detail.debt.currentRevision} actions={null}
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
      {tab === "setup" && params?.get("rule") ? (
        <MatchingEditor debtId={detail.debt.id} ruleId={params.get("rule")!} onClose={() => router.replace(`${pathname}?view=${workspaceTabSlug("setup")}`)} />
      ) : null}
      {tab === "setup" && !params?.get("rule") ? (
        <LoanSetup debtId={detail.debt.id} sim={sim} setSimulation={setSim} tracking={tracking} setTracking={setTracking} directory={directory.data} issues={issues} active={!draft}
          onEditRule={(ruleId) => router.replace(`${pathname}?view=${workspaceTabSlug("setup")}&rule=${encodeURIComponent(ruleId)}`)} />
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
