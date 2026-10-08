"use client";

import { localToday, previousYear } from "../../lib/calendarDate";
import { useLocalToday } from "../../lib/useLocalToday";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getTransport } from "@/lib/actual";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import type { OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { formatAmount } from "../../lib/money";
import { applyPosting, checkInterruptedPosting, completeInterruptedLink, readForClaims, type PostingActionContext } from "../../lib/postingActions";
import { clearRepaymentChoice, getSchedule, listMatchRules, setRepaymentChoice } from "../../lib/debtsApi";
import { declinePosting, listPostings, overrideSplit, proposeReversal, proposeUnsplit } from "../../lib/postingsApi";
import { DateField, SelectField } from "../fields";
import { stepsOf } from "./steps";
import type { PreviewDirectory } from "../preview/renderPreviewRows";
import { LenderReconciliation } from "../reconciliation/LenderReconciliation";
import { bulkSteps, bulkSummary, runBulk, type BulkResult } from "./bulkApply";
import { canPrepareReversal, prepareBulkReversal, type ReversalAction } from "./bulkReversal";
import { BulkApplyDialog, type BulkRun } from "./BulkApplyDialog";
import { changeContext, changeHeadline } from "./changeText";
import { ChangeList, type ChangeActions } from "./ChangeList";
import { buildChangeRows, countByFilter, groupMissedRows, rowsFor, type ChangeFilter, type ChangeRowModel } from "./changeRows";
import { ExtraPayments } from "./ExtraPayments";
import { ChoosePayment } from "./ChoosePayment";
import { LoanStatusStrip, type StripMatching } from "./LoanStatusStrip";
import { matchingFacts, repaymentTimeline } from "./matchingStrip";
import { useBackgroundRefresh } from "./useBackgroundRefresh";
import { withLoanOperation } from "../../lib/operationGate";
import { syncIfNeeded } from "../../lib/syncFreshness";

/**
 * The loan workspace's Activity tab (RD-084 P1.6b T289–T291;
 * `ux-loan-workspace.md` §3). One question: is this loan OK, and what do I
 * need to do? A status strip, one chronological list with filters, a bulk bar
 * on selection, and the lender statement drawer.
 *
 * Every write starts from a click here (SC-018): single Apply, bulk Apply
 * after its confirmation, Undo, Apply undo. The background refresh is
 * read-only and lives in `useBackgroundRefresh`.
 */

const today = localToday;
type Period = "whole" | "year" | "last12" | "custom";

function periodRange(period: Period, opening: string, custom: { from: string; to: string }, to = today()): { from: string; to: string } {
  if (period === "year") return { from: `${to.slice(0, 4)}-01-01`, to };
  if (period === "last12") return { from: previousYear(to), to };
  if (period === "custom") return custom;
  return { from: opening, to };
}

export function LoanActivity({ debt, directory, offsetHistories, initialFilter = "action", scheduleDirty = false }: { debt: DebtDetail; directory: AccountDirectory | undefined; offsetHistories?: OffsetHistorySnapshot[]; initialFilter?: ChangeFilter; /** Unsaved changes on Terms & Schedule (recording an extra payment waits for them). */ scheduleDirty?: boolean }) {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const debtId = debt.debt.id;
  const digits = debt.debt.currencyMinorDigits;
  const opening = debt.config.ok ? debt.config.config.terms.openingDate : today();
  const [period, setPeriod] = useState<Period>("whole");
  const [custom, setCustom] = useState({ from: opening, to: today() });
  const calendarToday = useLocalToday();
  const range = periodRange(period, opening, custom, calendarToday);
  const refresh = useBackgroundRefresh({ debt, directory, offsetHistories, from: range.from, to: range.to, scheduleDirty });
  const postings = useQuery({ queryKey: ["assets-debt", "postings", debtId], queryFn: () => listPostings(debtId) });
  const [filter, setFilter] = useState<ChangeFilter>(initialFilter);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [completion, setCompletion] = useState<Record<string, string>>({});
  const [statements, setStatements] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [run, setRun] = useState<BulkRun | null>(null);
  // Read by the running batch between changes ("Stop after this change").
  const stopAfterCurrent = useRef(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const allRows = useMemo(() => buildChangeRows(postings.data ?? [], refresh.notices), [postings.data, refresh.notices]);
  const paidOff = debt.paidOff ?? null;
  const effectiveOffsets = refresh.offsetHistories ?? offsetHistories;
  const offsetsReady = debt.offsets.filter((offset) => offset.useActualBalance).every((offset) => effectiveOffsets?.some((history) => history.accountId === offset.actualAccountId));
  // Repayment matching at a glance (rev 4): every scheduled due date, joined with the rows above.
  const schedule = useQuery({
    queryKey: ["assets-debt", "activity-schedule", connection?.id, debtId, debt.debt.currentRevision, calendarToday, refresh.status?.at, effectiveOffsets ?? null],
    queryFn: () => getSchedule(debtId, { from: opening, to: `${Number(today().slice(0, 4)) + 60}-12-31`, resolution: "events", offsetHistories: effectiveOffsets }),
    enabled: offsetsReady,
    staleTime: 5 * 60_000,
  });
  const rules = useQuery({ queryKey: ["assets-debt", "match-rules", debtId], queryFn: () => listMatchRules(debtId) });
  const matching = useMemo((): StripMatching | null => {
    if (!schedule.data?.ok) return null;
    // Paid off: no repayment is expected after the one the payoff settled.
    const events = paidOff ? schedule.data.events.filter((e) => e.date <= paidOff.dueDate) : schedule.data.events;
    const cells = repaymentTimeline(events, allRows, calendarToday);
    const rule = (rules.data ?? []).find((r) => r.record.purpose === "repayment" && r.record.enabled) ?? null;
    const dates = rule?.conditions?.items.find((c) => c.kind === "expected-date");
    const source = rule?.conditions?.items.find((c) => c.kind === "source-account");
    const accountId = source && "accountId" in source ? source.accountId : debt.debt.paymentAccountId;
    // Live, from this refresh (the rule's stored check goes stale as payments arrive).
    const found = cells.filter((c) => c.state === "applied" || c.state === "edited" || c.state === "found" || c.state === "blocked").length;
    const missed = cells.filter((c) => c.state === "missing").length;
    const lastCheck = cells.length ? `${found} found, ${missed} not found` : null;
    return {
      cells,
      facts: matchingFacts(events, allRows, cells, calendarToday),
      accountName: directory?.accounts.find((a) => a.id === accountId)?.name ?? null,
      window: dates && "daysBefore" in dates ? { before: dates.daysBefore, after: dates.daysAfter } : null,
      ruleOn: rules.data ? !!rule : null,
      lastCheck,
      unrecordedExtra: (refresh.unscheduled ?? []).filter((p) => !p.recorded && !p.dismissed && p.direction !== "out").length,
      takenOut: (refresh.unscheduled ?? []).filter((p) => p.direction === "out").length,
      changedExtra: (refresh.unscheduled ?? []).filter((p) => p.changed).length,
    };
  }, [schedule.data, allRows, rules.data, directory, debt.debt.paymentAccountId, refresh.unscheduled, paidOff, calendarToday]);
  const counts = countByFilter(allRows);
  const rows = groupMissedRows(rowsFor(allRows, filter));
  const steps = useMemo(() => stepsOf(postings.data ?? []), [postings.data]);
  const previewDirectory: PreviewDirectory | null = directory ? {
    accounts: directory.accounts,
    categories: directory.categories,
    transferAccountByPayee: Object.fromEntries(Object.entries(refresh.transferPayees).map(([accountId, payeeId]) => [payeeId, accountId])),
  } : null;
  const selectedRows = allRows.filter((r) => selected.has(r.key) && r.selectable);
  const selectedApplied = selectedRows.filter((row) => row.selectable === "reverse");
  const onlyApplied = selectedApplied.length > 0 && selectedApplied.length === selectedRows.length;
  const onlyProposals = selectedRows.length > 0 && selectedApplied.length === 0;
  const reviewCount = allRows.filter((r) => r.state === "review" || r.state === "recommended").length;

  const context = async (sync: "always" | "if-stale" = "always"): Promise<PostingActionContext> => {
    if (!connection || !directory || connection.budgetSyncId !== debt.debt.budgetSyncId || directory.budgetSyncId !== debt.debt.budgetSyncId) throw new Error("Connect to this loan’s budget first.");
    if (debt.debt.status === "archived") throw new Error("Archived loans are read-only.");
    const active = selectActiveInstance(useConnectionStore.getState());
    if (active?.id !== connection.id || active.budgetSyncId !== debt.debt.budgetSyncId) throw new Error("The active connection changed. Reopen this loan before applying.");
    const transport = getTransport(connection);
    // Pull server changes before every explicit operation; a bulk run does this once.
    await syncIfNeeded(connection.id, transport, sync);
    let payees = refresh.transferPayees;
    if (!Object.keys(payees).length) {
      payees = {};
      for (const payee of await transport.getPayees()) if (payee.transferAccountId) payees[payee.transferAccountId] = payee.id;
    }
    return {
      transport,
      liabilityAccountId: debt.debt.liabilityAccountId ?? "",
      transferPayeeByAccount: payees,
      offBudgetAccountIds: new Set(directory.accounts.filter((a) => a.offBudget).map((a) => a.id)),
    };
  };

  /** After anything is written, the cached status is no longer true and later months may change. */
  const afterWrite = async () => {
    refresh.invalidate();
    await queryClient.invalidateQueries({ queryKey: ["assets-debt", "postings", debtId] });
    void queryClient.invalidateQueries({ queryKey: ["assets-debt", "attention"] });
    // A payoff applied or undone changes whether the loan shows as paid off.
    void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debt", debtId] });
    void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debts"] });
    void queryClient.invalidateQueries({ queryKey: ["assets-debt", "card-schedule"] });
    void queryClient.invalidateQueries({ queryKey: ["assets-debt", "card-balance"] });
    void queryClient.invalidateQueries({ queryKey: ["assets-debt", "activity-schedule"] });
    void queryClient.invalidateQueries({ queryKey: ["balances"] });
    await refresh.refresh();
  };

  const act = useMutation({
    mutationFn: async ({ posting, action, interestMinor, reason }: { posting: PostingView; action: "apply" | "decline" | "undo" | "unsplit" | "check" | "complete" | "edit" | "edit-apply"; interestMinor?: number; reason?: string | null }) => withLoanOperation(connection?.id ?? "disconnected", async () => {
      if (debt.debt.status === "archived" || connection?.budgetSyncId !== debt.debt.budgetSyncId) throw new Error("Connect to the active loan’s budget before making changes.");
      if (action === "decline") return declinePosting(posting.id);
      if (action === "unsplit") {
        if (!directory) throw new Error("Connect to the budget first.");
        return proposeUnsplit(posting.id, { accountDirectory: directory, transferPayees: (await context()).transferPayeeByAccount });
      }
      if (action === "edit") return overrideSplit(posting.id, { interestMinor: interestMinor!, reason: reason ?? null });
      if (action === "undo") {
        if (!directory) throw new Error("Connect to the budget first.");
        return proposeReversal(posting.id, { accountDirectory: directory, transferPayees: (await context()).transferPayeeByAccount });
      }
      const ctx = await context();
      if (action === "apply") return applyPosting(posting, ctx);
      // The edit is recorded first (a new Review proposal with both values), then applied as is.
      if (action === "edit-apply") return applyPosting(await overrideSplit(posting.id, { interestMinor: interestMinor!, reason: reason ?? null }), ctx);
      if (action === "complete") return completeInterruptedLink(posting, ctx);
      const checked = await checkInterruptedPosting(posting, ctx);
      if ("needsCompletion" in checked) {
        setCompletion((current) => ({ ...current, [posting.id]: checked.needsCompletion }));
        return posting;
      }
      return checked.posting;
    }),
    onSuccess: async (posting, { action }) => {
      setProblem(null);
      if (action === "undo") toast.success("Undo ready to review on that row.");
      if (action === "unsplit") toast.success("Unsplit ready to review on that row.");
      if (action === "edit") toast.success("Edit saved as a new proposal to review.");
      if (action === "apply" || action === "edit-apply" || action === "complete" || action === "check") {
        if (String(posting.status) !== "applied") toast.error("The change did not apply. See the row for why.");
        // The row shows its result now. No full refresh after a single apply (owner decision
        // 2026-10-07): later months already count this payment from Actual; the list, the loan
        // (paid off) and the loans list are reloaded, and a bulk apply or Refresh re-reads Actual.
        refresh.invalidate();
        await queryClient.invalidateQueries({ queryKey: ["assets-debt", "postings", debtId] });
        void queryClient.invalidateQueries({ queryKey: ["assets-debt", "attention"] });
        void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debt", debtId] });
        void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debts"] });
        void queryClient.invalidateQueries({ queryKey: ["assets-debt", "card-schedule"] });
        void queryClient.invalidateQueries({ queryKey: ["assets-debt", "card-balance"] });
        void queryClient.invalidateQueries({ queryKey: ["assets-debt", "activity-schedule"] });
        void queryClient.invalidateQueries({ queryKey: ["balances"] });
      } else {
        await queryClient.invalidateQueries({ queryKey: ["assets-debt", "postings", debtId] });
      }
    },
    onError: (error) => setProblem(error instanceof Error ? error.message : String(error)),
  });

  // "This is the payment" (owner decision 2026-10-07): the due date being chosen for, if any.
  const [choosing, setChoosing] = useState<string | null>(null);
  const choice = useMutation({
    mutationFn: async ({ dueDate, paymentId }: { dueDate: string; paymentId: string | null }) => {
      if (debt.debt.status === "archived" || connection?.budgetSyncId !== debt.debt.budgetSyncId) throw new Error("Connect to this active loan’s budget before choosing payments.");
      return paymentId ? setRepaymentChoice(debtId, { dueDate, transactionId: paymentId }) : clearRepaymentChoice(debtId, dueDate);
    },
    onSuccess: async (_r, { paymentId }) => {
      setChoosing(null);
      toast.success(paymentId ? "Payment chosen. Bench lined the others up around it." : "Choice forgotten. Bench matches this due date again.");
      await afterWrite();
    },
    onError: (error) => setProblem(error instanceof Error ? error.message : String(error)),
  });

  // "Split again" (owner decision 2026-10-07): undo the applied splits that drifted, newest first;
  // once the undos are applied the months come back as new splits to apply.
  const splitAgain = useMutation({
    mutationFn: async (dueDates: string[]) => withLoanOperation(connection?.id ?? "disconnected", async () => {
      if (!directory) throw new Error("Connect to the budget first.");
      const payees = (await context()).transferPayeeByAccount;
      const applied = (postings.data ?? []).filter((p) => String(p.status) === "applied" && p.postingKind === "repayment-split" && dueDates.includes(p.periodKey)).sort((a, b) => b.periodKey.localeCompare(a.periodKey));
      for (const posting of applied) await proposeReversal(posting.id, { accountDirectory: directory, transferPayees: payees });
      return applied.length;
    }),
    onSuccess: async (count) => {
      toast.success(count === 1 ? "Undo ready on that row. Apply it, then apply the new split." : `${count} undos ready. Apply them, then apply the new splits.`);
      await queryClient.invalidateQueries({ queryKey: ["assets-debt", "postings", debtId] });
    },
    onError: (error) => setProblem(error instanceof Error ? error.message : String(error)),
  });

  const prepareSelected = useMutation({
    mutationFn: async ({ chosen, action }: { chosen: ChangeRowModel[]; action: ReversalAction }) => withLoanOperation(connection?.id ?? "disconnected", async () => {
      const ctx = await context();
      if (!directory) throw new Error("Connect to the budget first.");
      const propose = action === "unsplit" ? proposeUnsplit : proposeReversal;
      return prepareBulkReversal(chosen, action, (posting) => propose(posting.id, { accountDirectory: directory, transferPayees: ctx.transferPayeeByAccount }));
    }),
    onSuccess: async (outcome, { action }) => {
      setProblem(outcome.stopped ? `${outcome.prepared.length} proposals prepared · stopped at ${outcome.stopped.row.dueDate}: ${outcome.stopped.reason}. ${outcome.remaining} remaining proposals were not prepared. Nothing was changed in Actual.` : null);
      await queryClient.invalidateQueries({ queryKey: ["assets-debt", "postings", debtId] });
      setSelected(new Set(outcome.prepared.map((row) => row.key)));
      if (outcome.prepared.length) {
        setFilter("action");
        toast.success(`${outcome.prepared.length} ${action === "unsplit" ? "unsplit" : "undo"} proposals ready to review. Apply them to proceed.`);
      }
    },
    onError: (error) => setProblem(error instanceof Error ? error.message : String(error)),
  });

  const actions: ChangeActions = {
    choose: (dueDate) => setChoosing(dueDate),
    splitAgain: (dueDates) => splitAgain.mutate(dueDates),
    apply: (posting) => act.mutate({ posting, action: "apply" }),
    decline: (posting) => act.mutate({ posting, action: "decline" }),
    undo: (posting) => act.mutate({ posting, action: "undo" }),
    unsplit: (posting) => act.mutate({ posting, action: "unsplit" }),
    check: (posting) => act.mutate({ posting, action: "check" }),
    complete: (posting) => act.mutate({ posting, action: "complete" }),
    edit: (posting, interestMinor, reason) => act.mutate({ posting, action: "edit", interestMinor, reason }),
    editApply: (posting, interestMinor, reason) => act.mutate({ posting, action: "edit-apply", interestMinor, reason }),
  };

  const bulk = useMutation({
    mutationFn: async (chosen: ChangeRowModel[]) => withLoanOperation(connection?.id ?? "disconnected", async () => {
      const ctx = await context("always");
      // Cleared loan-side rows are marked together at the end in one batch write, where the
      // connection has one (Direct), instead of one settled write per split.
      if (ctx.transport.batchWriteTransactionsForSync) ctx.clearLater = [];
      const steps = bulkSteps(chosen);
      // Claims write nothing, so their rows are read once for the whole batch.
      const cache = await readForClaims(steps.map((step) => step.target), ctx.transport);
      const outcome = await runBulk(
        steps,
        (step) => applyPosting(step.target, ctx, cache),
        (done) => setRun((current) => (current ? { ...current, done } : current)),
        () => stopAfterCurrent.current,
      );
      if (ctx.clearLater?.length) {
        const ids = ctx.clearLater;
        setRun((current) => (current ? { ...current, phase: "clearing", clearing: ids.length } : current));
        let failure: string | null = null;
        try {
          await ctx.transport.batchWriteTransactionsForSync!({ updated: ids.map((id) => ({ id, cleared: true })), deleted: [] });
          // Verified like every write: read the loan account back and check each row is cleared.
          const rows = await ctx.transport.listTransactionsForSync({ accountId: ctx.liabilityAccountId, resolveNames: false });
          const notCleared = ids.filter((id) => !rows.some((r) => r.id === id && r.cleared));
          if (notCleared.length) failure = `${notCleared.length} of them did not take`;
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }
        if (failure) {
          const message = `The splits were applied, but marking ${ids.length} loan-side row${ids.length === 1 ? "" : "s"} cleared again did not complete (${failure}). Mark ${ids.length === 1 ? "it" : "them"} cleared in Actual.`;
          setProblem(message);
          setRun((current) => (current ? { ...current, clearProblem: message } : current));
        }
      }
      return outcome;
    }),
    onSuccess: async (outcome) => {
      setResult(outcome);
      setSelected(new Set());
      // Stopped or finished: refresh and recalculate the rest before the user continues.
      setRun((current) => (current ? { ...current, phase: "refreshing", result: outcome } : current));
      try {
        await afterWrite();
      } finally {
        setRun((current) => (current ? { ...current, phase: "done" } : current));
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setProblem(message);
      setRun((current) => (current ? { ...current, phase: "done", result: current.result ?? { applied: [], stopped: current.steps[current.done] ? { row: current.steps[current.done].row, reason: message } : null, notAttempted: current.steps.slice(current.done + 1).map((s) => s.row) } } : current));
    },
  });

  const startBulk = (chosen: ChangeRowModel[]) => {
    stopAfterCurrent.current = false;
    setConfirming(false);
    setResult(null);
    setRun({ steps: bulkSteps(chosen), done: 0, phase: "applying", stopRequested: false, clearing: 0, result: null, clearProblem: null });
    bulk.mutate(chosen);
  };

  // The period sits on the same row as the filter chips.
  const periodControls = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Period</span>
      <SelectField
        hideLabel
        label="Period"
        value={period}
        options={[{ value: "whole", label: "Whole loan" }, { value: "year", label: "This year" }, { value: "last12", label: "Last 12 months" }, { value: "custom", label: "Custom" }]}
        onChange={(v) => setPeriod(v as Period)}
        className="w-40"
      />
      {period === "custom" ? (
        <>
          <DateField hideLabel label="From" value={custom.from} onChange={(from) => setCustom((c) => ({ ...c, from }))} />
          <span className="text-xs text-muted-foreground">to</span>
          <DateField hideLabel label="To" value={custom.to} onChange={(to) => setCustom((c) => ({ ...c, to }))} />
        </>
      ) : null}
    </div>
  );

  const totals = selectedRows.reduce((sum, r) => {
    const output = r.selectable === "apply" ? r.posting?.output : null;
    if (output && "components" in output) for (const c of output.components) sum[c.kind === "principal" ? "principal" : c.kind === "interest" ? "interest" : "fees"] += c.amountMinor;
    return sum;
  }, { principal: 0, interest: 0, fees: 0 });
  const readOnly = debt.debt.status === "archived" || connection?.budgetSyncId !== debt.debt.budgetSyncId;
  const busy = readOnly || act.isPending || bulk.isPending || prepareSelected.isPending || splitAgain.isPending || choice.isPending || refresh.phase === "refreshing";
  const edited = selectedRows.filter((r) => r.posting?.output.kind === "restructure" && r.posting.output.override);
  // The context lines the selected changes share, each said once (§3.8 rev 2).
  const sharedNotes = (() => {
    const notes = new Map<string, { text: string; tone: string; count: number }>();
    for (const row of selectedRows) {
      const target = row.selectable === "undo" ? row.undo : row.posting;
      const note = target ? changeContext(target) : null;
      if (!note || note.text.startsWith("Edited:")) continue;
      const entry = notes.get(note.text) ?? { text: note.text, tone: note.tone, count: 0 };
      entry.count += 1;
      notes.set(note.text, entry);
    }
    return [...notes.values()];
  })();
  const kinds = (() => {
    const n = (pred: (r: ChangeRowModel) => boolean) => selectedRows.filter(pred).length;
    return [
      [n((r) => r.selectable === "apply" && r.posting?.output.kind === "restructure"), "split"],
      [n((r) => r.selectable === "apply" && r.posting?.output.kind === "link"), "transfer link"],
      [n((r) => r.selectable === "apply" && r.posting?.output.kind === "convert"), "conversion"],
      [n((r) => r.selectable === "apply" && (r.posting?.output.kind === "create" || r.posting?.output.kind === "claim")), "other change"],
      [n((r) => r.selectable === "undo"), "undo"],
    ].filter(([count]) => (count as number) > 0).map(([count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`).join(", ");
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex flex-col gap-3 px-4 py-4 text-sm">
        <LoanStatusStrip refresh={refresh} paidOffOn={paidOff?.paidDate ?? null} counts={{ review: reviewCount, notApplied: reviewCount }} digits={digits} onRefresh={() => { if (!busy) void refresh.refresh(); }} onStatements={() => setStatements(true)} matching={matching} />
        <ExtraPayments debtId={debtId} payments={refresh.unscheduled ?? []} digits={digits} scheduleDirty={scheduleDirty} readOnly={busy} onChanged={() => void afterWrite()} />
        {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
        {result ? (
          <div role="status" className={result.stopped ? "flex items-start gap-2 rounded border border-amber-500/50 bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950/30" : "flex items-start gap-2 rounded border border-border px-3 py-2 text-xs"}>
            <p className="flex-1">{bulkSummary(result)}</p>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={() => setResult(null)}>Dismiss</Button>
          </div>
        ) : null}
        {previewDirectory ? (
          <ChangeList
            toolbar={periodControls}
            rows={rows}
            filter={filter}
            onFilter={(next) => { setFilter(next); setSelected(new Set()); }}
            counts={counts}
            selected={selected}
            onToggle={(key) => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
            onToggleAll={(keys, on) => setSelected((current) => { const next = new Set(current); for (const key of keys) { if (on) next.add(key); else next.delete(key); } return next; })}
            expanded={expanded}
            onExpand={(key) => setExpanded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
            directory={previewDirectory}
            digits={digits}
            busy={busy}
            actions={actions}
            completion={completion}
            stepNote={(row) => { const step = row.posting ? steps.get(row.posting.id) : undefined; return step ? `Step ${step.index} of ${step.total}: ${step.title}` : null; }}
          />
        ) : <p className="text-xs text-muted-foreground">Connect to the budget to see this loan&apos;s changes.</p>}
      </div>

      {selectedRows.length ? (
        <div role="region" aria-label="Selected changes" className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border bg-background px-4 py-2 text-xs">
          <p aria-live="polite" className="flex-1">
            {selectedApplied.length ? `${selectedRows.length} changes selected` : `${selectedRows.length} selected · Principal ${formatAmount(totals.principal, digits)} · Interest ${formatAmount(totals.interest, digits)}${totals.fees ? ` · Fees ${formatAmount(totals.fees, digits)}` : ""}`}
          </p>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>Clear</Button>
          {selectedApplied.length ? (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy || !onlyApplied} onClick={() => prepareSelected.mutate({ chosen: selectedRows, action: "undo" })}>Undo selected</Button>
              <Button type="button" variant="outline" size="sm" disabled={busy || !onlyApplied || !selectedRows.every((row) => canPrepareReversal(row, "unsplit"))} onClick={() => prepareSelected.mutate({ chosen: selectedRows, action: "unsplit" })}>Unsplit selected</Button>
              <p className="basis-full text-muted-foreground">Prepares proposals for review before Apply. Undo restores Bench changes or releases a match; Unsplit turns the whole payment into one loan transfer.</p>
            </>
          ) : null}
          {onlyProposals ? (
            <Button type="button" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
              {selectedRows.every((r) => r.selectable === "undo") ? `Apply ${selectedRows.length} undo${selectedRows.length === 1 ? "" : "s"}` : `Apply ${selectedRows.length} change${selectedRows.length === 1 ? "" : "s"}`}
            </Button>
          ) : null}
          {selectedApplied.length && !onlyApplied ? <p className="basis-full text-muted-foreground">Select applied changes separately from proposals.</p> : null}
        </div>
      ) : null}

      <ChoosePayment
        dueDate={choosing}
        options={refresh.paymentOptions ?? []}
        chosenId={refresh.repaymentChoices?.find((c) => c.key === choosing)?.paymentId ?? null}
        digits={digits}
        busy={busy}
        onChoose={(paymentId) => choosing && choice.mutate({ dueDate: choosing, paymentId })}
        onClear={() => choosing && choice.mutate({ dueDate: choosing, paymentId: null })}
        onClose={() => setChoosing(null)}
      />
      <Dialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Apply {selectedRows.length} change{selectedRows.length === 1 ? "" : "s"} to Actual?</DialogTitle>
            <DialogDescription>
              {kinds}. Principal {formatAmount(totals.principal, digits)} · Interest {formatAmount(totals.interest, digits)}{totals.fees ? ` · Fees ${formatAmount(totals.fees, digits)}` : ""}.
            </DialogDescription>
          </DialogHeader>
          {sharedNotes.length ? (
            <ul className="flex flex-col gap-1 text-xs">
              {sharedNotes.map((note) => <li key={note.text} className={note.tone === "warn" || note.tone === "bad" ? "text-amber-800 dark:text-amber-300" : ""}>{note.count === selectedRows.length ? (selectedRows.length > 1 ? `All ${note.count}: ` : "") : `${note.count} of ${selectedRows.length}: `}{note.text}</li>)}
            </ul>
          ) : null}
          <div className="max-h-[50vh] overflow-y-auto rounded border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background text-left text-muted-foreground"><tr><th scope="col" className="px-3 py-1.5 font-normal">Due</th><th scope="col" className="px-3 py-1.5 font-normal">Change</th></tr></thead>
              <tbody>
                {bulkSteps(selectedRows).map((step) => (
                  <tr key={step.row.key} className="border-t border-border/60"><td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{step.row.dueDate}</td><td className="px-3 py-1.5">{previewDirectory ? changeHeadline(step.target, previewDirectory, digits) : ""}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">They run in this order, oldest first (undos newest first). Each is checked against Actual just before it is written. If one fails or Actual changed, Bench stops there and recalculates the rest before you continue.</p>
          {edited.length ? (
            <div className="rounded border border-amber-500/40 p-2 text-xs">
              <p className="font-medium">Edited by you</p>
              <ul>{edited.map((r) => <li key={r.key}>{r.dueDate}: {r.posting?.reasons.find((reason) => reason.code === "edited-split")?.text}</li>)}</ul>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button type="button" disabled={busy || !onlyProposals} onClick={() => startBulk(selectedRows)}>Apply {selectedRows.length} change{selectedRows.length === 1 ? "" : "s"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkApplyDialog
        run={run}
        headline={(step) => (previewDirectory ? changeHeadline(step.target, previewDirectory, digits) : "")}
        onStop={() => { stopAfterCurrent.current = true; setRun((current) => (current ? { ...current, stopRequested: true } : current)); }}
        onDone={() => setRun(null)}
        onContinue={() => {
          // The rest was recalculated by the refresh: select what is still there to apply, to review first.
          const keys = new Set((run?.result?.notAttempted ?? []).map((r) => r.key));
          setSelected(new Set(rows.filter((r) => keys.has(r.key) && r.selectable).map((r) => r.key)));
          setRun(null);
        }}
      />

      <Sheet open={statements} onOpenChange={setStatements}>
        <SheetContent side="right" className="max-w-full overflow-y-auto" style={{ width: "min(640px, 96vw)", maxWidth: "none" }}>
          <SheetHeader>
            <SheetTitle>Lender statements</SheetTitle>
            <SheetDescription>Compare what your lender says with Bench&apos;s calculation and with Actual, to see which side is off. Nothing here changes Actual.</SheetDescription>
          </SheetHeader>
          <LenderReconciliation debt={debt} offsetHistories={refresh.offsetHistories ?? offsetHistories} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
