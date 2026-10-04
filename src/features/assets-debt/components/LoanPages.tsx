"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { getTransport } from "@/lib/actual";
import { readOffsetHistories, type OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import { archiveDebt, createDebt, DebtApiError, getDebt, listDebts, updateDebt } from "../lib/debtsApi";
import { detailToStates, newSimulation, newTracking, statesToSaveInput, summarizeProfile, type SaveIssue, type SimulationState, type TrackingState } from "../lib/simulatorModel";
import { useAccountDirectory } from "../lib/useAccountDirectory";
import { SAVE_BOUNDARY } from "./saveBoundary";
import { SimulatorView } from "./simulator/SimulatorView";
import { strategyAdvice, TrackingSetup } from "./tracking/TrackingSetup";
import { LenderReconciliation } from "./reconciliation/LenderReconciliation";
import { PostingsPanel } from "./preview/PostingsPanel";
import { ActivityTimeline } from "./activity/ActivityTimeline";

/**
 * The loan pages (RD-084 P1.3b T204, T214, T216).
 *
 * New loan: simulate (unsaved, in memory) → Set up tracking in Actual →
 * review → Add loan to Assets & Debt or Save as draft. Nothing is saved, and
 * nothing reads Actual, until the tracking step; nothing ever writes to Actual.
 *
 * Existing loan: the same simulator from the saved configuration, with
 * unsaved changes marked and comparable with the saved loan; Save changes
 * goes through the existing revision rules.
 */

const today = () => new Date().toISOString().slice(0, 10);
const storageKey = (connectionId: string, budget: string) => `assets-debt:new-loan:${connectionId}:${budget}`;
const currencyKey = (budget: string) => `assets-debt:currency:${budget}`;

function readSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
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

function Review({ sim, tracking, children }: { sim: SimulationState; tracking: TrackingState; children: React.ReactNode }) {
  return (
    <section aria-labelledby="review-heading" className="flex flex-col gap-3 px-4 py-4">
      <h2 id="review-heading" className="text-base font-semibold">
        Review
      </h2>
      <dl className="grid grid-cols-[12rem_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Name</dt>
        <dd>{tracking.name || "Not named"}</dd>
        <dt className="text-muted-foreground">Calculation</dt>
        <dd>{summarizeProfile(sim.profile)}</dd>
        <dt className="text-muted-foreground">Lender records interest</dt>
        <dd>{tracking.lenderPattern === "embedded-interest" ? "As part of each repayment" : tracking.lenderPattern === "separate-interest" ? "As a separate transaction" : "Not answered"}</dd>
        <dt className="text-muted-foreground">Accounts</dt>
        <dd>{tracking.liabilityAccountId ? "Chosen" : "Not chosen yet"}</dd>
      </dl>
      <p className="text-sm font-medium" data-testid="save-boundary-notice">
        {SAVE_BOUNDARY}
      </p>
      {children}
    </section>
  );
}

export function NewLoanView() {
  const connection = useConnectionStore(selectActiveInstance);
  const budget = connection?.budgetSyncId ?? null;
  const key = connection && budget ? storageKey(connection.id, budget) : null;
  const existing = useQuery({ queryKey: ["assets-debt", "debts", budget], queryFn: () => listDebts(budget!), enabled: !!budget });
  const [sim, setSim] = useState<SimulationState | null>(null);
  const [tracking, setTracking] = useState<TrackingState | null>(null);
  const [step, setStep] = useState<"simulate" | "track" | "review">("simulate");
  const [issues, setIssues] = useState<SaveIssue[]>([]);
  const directory = useAccountDirectory();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Start from this tab's unsaved simulation for this budget, if any (sessionStorage is a per-tab
  // convenience, never a debt), else a fresh one using the budget's usual amount precision.
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
    try {
      sessionStorage.setItem(key, JSON.stringify({ sim, tracking }));
    } catch {
      // storage unavailable: the simulation simply is not restored on reload
    }
  }, [key, sim, tracking]);

  const dirty = !!sim && (sim.principalMinor !== null || sim.termMonths !== null);
  useLeaveGuard(dirty);

  const save = useMutation({
    mutationFn: async (status: "active" | "draft") => {
      if (!sim || !tracking || !budget) throw new Error("Not ready");
      const built = statesToSaveInput(sim, { ...tracking, status }, budget, strategyAdvice(sim).recommended);
      if (!built.ok) throw new DebtApiError("invalid", 400, built.issues);
      if (!directory.data) throw new DebtApiError("The budget's accounts have not loaded yet.", 400);
      return createDebt(built.input, directory.data);
    },
    onSuccess: (detail: DebtDetail) => {
      try {
        if (key) sessionStorage.removeItem(key);
        if (budget && sim) localStorage.setItem(currencyKey(budget), sim.currency);
      } catch {
        // storage unavailable
      }
      void queryClient.invalidateQueries({ queryKey: ["assets-debt"] });
      toast.success(detail.debt.status === "active" ? "Loan added to Assets & Debt" : "Draft saved");
      router.push(`/assets-debt/loans/${encodeURIComponent(detail.debt.id)}`);
    },
    onError: (error) => setIssues(error instanceof DebtApiError && error.issues.length ? error.issues : [{ field: "(save)", message: error instanceof Error ? error.message : "The loan could not be saved" }]),
  });

  if (!budget) return <p className="px-4 py-6 text-sm text-muted-foreground">Connect to a budget to simulate and track a loan.</p>;
  if (!sim || !tracking) return <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>;
  const complete = statesToSaveInput(sim, { ...tracking, name: "x", status: "draft", offsetAccountMap: Object.fromEntries(sim.offsets.map((o) => [o.placeholderAccountId, "x"])) }, budget, "bench-daily").ok;

  if (step === "simulate") {
    return (
      <SimulatorView
        sim={sim}
        onChange={setSim}
        title="New loan"
        badge="Not saved: simulation only"
        stepLabel="Step 1 of 3 · Model loan"
        revision={null}
        actions={
          <Button type="button" size="sm" disabled={!complete} onClick={() => setStep("track")}>
            Set up tracking in Actual
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <h1 className="text-base font-semibold">{step === "track" ? "Set up tracking in Actual" : "Review"}</h1>
        <span className="text-xs text-muted-foreground">Step {step === "track" ? "2 of 3 · Set up tracking" : "3 of 3 · Review"}</span>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setStep(step === "review" ? "track" : "simulate")}>
            Back
          </Button>
          {step === "track" ? (
            <Button type="button" size="sm" onClick={() => setStep("review")}>
              Review
            </Button>
          ) : null}
        </div>
      </header>
      <IssueList issues={issues} />
      {step === "track" ? <TrackingSetup sim={sim} setSimulation={setSim} tracking={tracking} setTracking={setTracking} directory={directory.data} issues={issues} /> : null}
      {step === "review" ? (
        <Review sim={sim} tracking={tracking}>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => save.mutate("active")} disabled={save.isPending}>
              Add loan to Assets & Debt
            </Button>
            <Button type="button" variant="outline" onClick={() => save.mutate("draft")} disabled={save.isPending}>
              Save as draft
            </Button>
          </div>
        </Review>
      ) : null}
    </div>
  );
}

const VIEWS = [
  { id: "simulator", label: "Simulator" },
  { id: "tracking", label: "Tracking setup" },
  { id: "activity", label: "Activity" },
] as const;

export function LoanView({ id }: { id: string }) {
  const connection = useConnectionStore(selectActiveInstance);
  const debt = useQuery({ queryKey: ["assets-debt", "debt", id], queryFn: () => getDebt(id) });
  const directory = useAccountDirectory();
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const view = (VIEWS.find((v) => v.id === params?.get("view"))?.id ?? "simulator") as (typeof VIEWS)[number]["id"];
  const saved = useMemo(() => (debt.data ? detailToStates(debt.data) : null), [debt.data]);
  const [sim, setSim] = useState<SimulationState | null>(null);
  const [tracking, setTracking] = useState<TrackingState | null>(null);
  const [issues, setIssues] = useState<SaveIssue[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [offsetAsOfDate, setOffsetAsOfDate] = useState(today());
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
    enabled: !!connection && trackedOffsetAccounts.length > 0,
  });
  const offsetSnapshots = useMemo((): OffsetHistorySnapshot[] | undefined => {
    if (!offsetHistory.data?.ok || !debt.data) return undefined;
    const placeholder = new Map(debt.data.offsets.map((offset) => [offset.actualAccountId, `offset:${offset.id}`]));
    return offsetHistory.data.snapshots.map((snapshot) => ({ ...snapshot, accountId: placeholder.get(snapshot.accountId) ?? snapshot.accountId }));
  }, [offsetHistory.data, debt.data]);

  useEffect(() => {
    // Load (or reload after a save) the saved states into the editable copies.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the editable copy starts from each newly loaded revision
    setSim(saved?.simulation ?? null);
    setTracking(saved?.tracking ?? null);
  }, [saved]);

  // The optional "what changed" note describes a save; on its own it is not a change.
  const dirty = !!saved && !!sim && !!tracking && (JSON.stringify(saved.simulation) !== JSON.stringify(sim) || JSON.stringify(saved.tracking) !== JSON.stringify({ ...tracking, changeSummary: saved.tracking.changeSummary }));
  useLeaveGuard(dirty);
  const detail = debt.data;
  const readOnly = detail?.debt.status === "archived";

  const save = useMutation({
    mutationFn: async () => {
      if (!sim || !tracking || !detail) throw new Error("Not ready");
      const built = statesToSaveInput(sim, tracking, detail.debt.budgetSyncId, strategyAdvice(sim).recommended);
      if (!built.ok) throw new DebtApiError("invalid", 400, built.issues);
      if (!directory.data) throw new DebtApiError("The budget's accounts have not loaded yet.", 400);
      return updateDebt(id, built.input, directory.data);
    },
    onSuccess: (next) => {
      setIssues([]);
      toast.success(next.debt.currentRevision === detail?.debt.currentRevision ? "Saved: no change to the calculation" : `Saved as revision ${next.debt.currentRevision}`);
      queryClient.setQueryData(["assets-debt", "debt", id], next);
      void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debts"] });
    },
    onError: (error) => setIssues(error instanceof DebtApiError && error.issues.length ? error.issues : [{ field: "(save)", message: error instanceof Error ? error.message : "The loan could not be saved" }]),
  });
  const archive = useMutation({
    mutationFn: () => archiveDebt(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["assets-debt"] });
      toast.success(detail?.debt.status === "draft" ? "Draft discarded" : "Loan archived");
      router.push("/assets-debt/loans");
    },
  });

  if (debt.isLoading) return <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>;
  if (debt.isError || !detail) return <p role="alert" className="px-4 py-6 text-sm text-destructive">{(debt.error as Error)?.message ?? "Loan not found"}</p>;
  if (detail.blocked || !saved || !sim || !tracking) {
    return (
      <p role="status" className="m-4 rounded border border-destructive/40 px-3 py-2 text-sm">
        <span className="font-semibold">Blocked:</span> {detail.blocked?.message ?? "This loan's settings cannot be used."} Other loans are not affected.
      </p>
    );
  }

  const staleStrategy = (() => {
    const advice = strategyAdvice(sim);
    const line = advice.lines.find((l) => l.strategy === tracking.executionStrategy);
    return line && !line.available ? `The saved engine (${line.label}) no longer fits these settings; saving will use ${advice.lines.find((l) => l.strategy === advice.recommended)?.label ?? "no engine"}.` : null;
  })();

  const actions = (
    <>
      {dirty && !readOnly ? (
        <Input aria-label="What changed (optional)" placeholder="What changed (optional)" value={tracking.changeSummary} onChange={(e) => setTracking({ ...tracking, changeSummary: e.target.value })} className="h-7 w-52 text-xs" />
      ) : null}
      {dirty ? (
        <Button type="button" size="sm" variant="outline" onClick={() => { setSim(saved.simulation); setTracking(saved.tracking); setIssues([]); }}>
          Discard changes
        </Button>
      ) : null}
      <Button type="button" size="sm" disabled={!dirty || readOnly || save.isPending} onClick={() => save.mutate()}>
        Save changes
      </Button>
      {!readOnly ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setConfirm({
              title: detail.debt.status === "draft" ? "Discard this draft?" : "Archive this loan?",
              message: detail.debt.status === "draft" ? "The draft and its settings are removed." : "The loan keeps its history and revisions. Nothing changes in Actual.",
              destructiveLabel: detail.debt.status === "draft" ? "Discard" : "Archive",
              onConfirm: () => archive.mutate(),
            })
          }
        >
          {detail.debt.status === "draft" ? "Discard draft" : "Archive"}
        </Button>
      ) : null}
    </>
  );
  const badge = readOnly ? "Archived: read-only" : dirty ? "Unsaved changes" : `Saved, revision ${detail.debt.currentRevision}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label="Loan views" className="flex gap-1 border-b border-border px-4">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-current={view === v.id ? "page" : undefined}
            onClick={() => router.replace(`${pathname}?view=${v.id}`)}
            className={cn("border-b-2 border-transparent px-3 py-2 text-xs font-medium text-muted-foreground", view === v.id && "border-primary text-foreground")}
          >
            {v.label}
          </button>
        ))}
      </nav>
      <IssueList issues={issues} />
      {staleStrategy && !readOnly ? <p className="mx-4 mt-2 text-xs text-muted-foreground">{staleStrategy}</p> : null}
      {view === "simulator" ? <SimulatorView sim={sim} onChange={setSim} saved={saved.simulation} title={tracking.name || detail.debt.name} badge={badge} readOnly={readOnly} revision={detail.debt.currentRevision} actions={actions} offsetTracking={trackedOffsetAccounts.length ? {
        asOfDate: offsetAsOfDate,
        onAsOfDateChange: setOffsetAsOfDate,
        snapshots: offsetSnapshots,
        loading: offsetHistory.isLoading || offsetHistory.isFetching,
        problems: offsetHistory.isError
          ? [offsetHistory.error instanceof Error ? offsetHistory.error.message : "Actual offset history could not be read."]
          : offsetHistory.data && !offsetHistory.data.ok
            ? offsetHistory.data.failures.map((failure) => `${failure.accountId}: ${failure.message}`)
            : [],
      } : undefined} /> : null}
      {view === "tracking" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <h1 className="text-base font-semibold">{detail.debt.name}: tracking setup</h1>
            <span role="status" className="rounded-full border border-border px-2 py-0.5 text-[11px]">
              {badge}
            </span>
            <div className="ml-auto flex gap-2">{actions}</div>
          </div>
          <p className="px-4 pt-3 text-xs text-muted-foreground">{SAVE_BOUNDARY}</p>
          <TrackingSetup sim={sim} setSimulation={setSim} tracking={tracking} setTracking={setTracking} directory={directory.data} issues={issues} />
        </div>
      ) : null}
      {view === "activity" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <PostingsPanel debt={detail} directory={directory.data} offsetHistories={offsetHistory.data?.ok ? offsetHistory.data.snapshots : undefined} />
          <ActivityTimeline debtId={detail.debt.id} currencyMinorDigits={detail.debt.currencyMinorDigits} />
          <LenderReconciliation debt={detail} offsetHistories={offsetHistory.data?.ok ? offsetHistory.data.snapshots : undefined} />
        </div>
      ) : null}
      <ConfirmDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)} state={confirm} />
    </div>
  );
}
