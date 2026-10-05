"use client";

import { useMemo, useState } from "react";
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
import { getSchedule, listMatchRules } from "../../lib/debtsApi";
import { declinePosting, listPostings, overrideSplit, proposeReversal } from "../../lib/postingsApi";
import { backtestSummary } from "../rules/MatchingCard";
import { DateField, SelectField } from "../fields";
import { stepsOf } from "./steps";
import type { PreviewDirectory } from "../preview/renderPreviewRows";
import { LenderReconciliation } from "../reconciliation/LenderReconciliation";
import { bulkSteps, bulkSummary, runBulk, type BulkResult } from "./bulkApply";
import { changeContext, changeHeadline } from "./changeText";
import { ChangeList, type ChangeActions } from "./ChangeList";
import { buildChangeRows, countByFilter, rowsFor, type ChangeFilter, type ChangeRowModel } from "./changeRows";
import { ExtraPayments } from "./ExtraPayments";
import { LoanStatusStrip, type StripMatching } from "./LoanStatusStrip";
import { matchingFacts, repaymentTimeline } from "./matchingStrip";
import { useBackgroundRefresh } from "./useBackgroundRefresh";

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

const today = () => new Date().toISOString().slice(0, 10);
type Period = "whole" | "year" | "last12" | "custom";

function periodRange(period: Period, opening: string, custom: { from: string; to: string }): { from: string; to: string } {
  const to = today();
  if (period === "year") return { from: `${to.slice(0, 4)}-01-01`, to };
  if (period === "last12") return { from: `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`, to };
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
  const range = periodRange(period, opening, custom);
  const refresh = useBackgroundRefresh({ debt, directory, offsetHistories, from: range.from, to: range.to });
  const postings = useQuery({ queryKey: ["assets-debt", "postings", debtId], queryFn: () => listPostings(debtId) });
  const [filter, setFilter] = useState<ChangeFilter>(initialFilter);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [completion, setCompletion] = useState<Record<string, string>>({});
  const [statements, setStatements] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const allRows = useMemo(() => buildChangeRows(postings.data ?? [], refresh.notices), [postings.data, refresh.notices]);
  // Repayment matching at a glance (rev 4): every scheduled due date, joined with the rows above.
  const schedule = useQuery({
    queryKey: ["assets-debt", "card-schedule", debtId, debt.debt.currentRevision, today()],
    queryFn: () => getSchedule(debtId, { from: opening, to: `${Number(today().slice(0, 4)) + 60}-12-31`, resolution: "events", offsetHistories }),
    staleTime: 5 * 60_000,
  });
  const rules = useQuery({ queryKey: ["assets-debt", "match-rules", debtId], queryFn: () => listMatchRules(debtId) });
  const matching = useMemo((): StripMatching | null => {
    if (!schedule.data?.ok) return null;
    const cells = repaymentTimeline(schedule.data.events, allRows, today());
    const rule = (rules.data ?? []).find((r) => r.record.purpose === "repayment" && r.record.enabled) ?? null;
    const dates = rule?.conditions?.items.find((c) => c.kind === "expected-date");
    const source = rule?.conditions?.items.find((c) => c.kind === "source-account");
    const accountId = source && "accountId" in source ? source.accountId : debt.debt.paymentAccountId;
    let lastCheck: string | null = null;
    try {
      lastCheck = rule?.record.lastBacktestJson ? `Last check: ${backtestSummary(JSON.parse(rule.record.lastBacktestJson))}` : null;
    } catch {
      lastCheck = null;
    }
    return {
      cells,
      facts: matchingFacts(schedule.data.events, allRows, cells, today()),
      accountName: directory?.accounts.find((a) => a.id === accountId)?.name ?? null,
      window: dates && "daysBefore" in dates ? { before: dates.daysBefore, after: dates.daysAfter } : null,
      ruleOn: rules.data ? !!rule : null,
      lastCheck,
      unrecordedExtra: (refresh.unscheduled ?? []).filter((p) => !p.recorded).length,
      changedExtra: (refresh.unscheduled ?? []).filter((p) => p.changed).length,
    };
  }, [schedule.data, allRows, rules.data, directory, debt.debt.paymentAccountId, refresh.unscheduled]);
  const counts = countByFilter(allRows);
  const rows = rowsFor(allRows, filter);
  const steps = useMemo(() => stepsOf(postings.data ?? []), [postings.data]);
  const previewDirectory: PreviewDirectory | null = directory ? {
    accounts: directory.accounts,
    categories: directory.categories,
    transferAccountByPayee: Object.fromEntries(Object.entries(refresh.transferPayees).map(([accountId, payeeId]) => [payeeId, accountId])),
  } : null;
  const selectedRows = allRows.filter((r) => selected.has(r.key) && r.selectable);
  const reviewCount = allRows.filter((r) => r.state === "review" || r.state === "recommended").length;

  const context = async (): Promise<PostingActionContext> => {
    if (!connection || !directory) throw new Error("Connect to the budget first.");
    const transport = getTransport(connection);
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
    await refresh.refresh();
  };

  const act = useMutation({
    mutationFn: async ({ posting, action, interestMinor, reason }: { posting: PostingView; action: "apply" | "decline" | "undo" | "check" | "complete" | "edit" | "edit-apply"; interestMinor?: number; reason?: string | null }) => {
      if (action === "decline") return declinePosting(posting.id);
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
    },
    onSuccess: async (posting, { action }) => {
      setProblem(null);
      if (action === "undo") toast.success("Undo ready to review on that row.");
      if (action === "edit") toast.success("Edit saved as a new proposal to review.");
      if (action === "apply" || action === "edit-apply" || action === "complete" || action === "check") {
        if (String(posting.status) !== "applied") toast.error("The change did not apply. See the row for why.");
        // The row shows its result now; the recalculation of later months runs in the background,
        // and Apply waits for it (see `busy`), since those months build on this one.
        await queryClient.invalidateQueries({ queryKey: ["assets-debt", "postings", debtId] });
        void afterWrite();
      } else {
        await queryClient.invalidateQueries({ queryKey: ["assets-debt", "postings", debtId] });
      }
    },
    onError: (error) => setProblem(error instanceof Error ? error.message : String(error)),
  });

  const actions: ChangeActions = {
    apply: (posting) => act.mutate({ posting, action: "apply" }),
    decline: (posting) => act.mutate({ posting, action: "decline" }),
    undo: (posting) => act.mutate({ posting, action: "undo" }),
    check: (posting) => act.mutate({ posting, action: "check" }),
    complete: (posting) => act.mutate({ posting, action: "complete" }),
    edit: (posting, interestMinor, reason) => act.mutate({ posting, action: "edit", interestMinor, reason }),
    editApply: (posting, interestMinor, reason) => act.mutate({ posting, action: "edit-apply", interestMinor, reason }),
  };

  const bulk = useMutation({
    mutationFn: async (chosen: ChangeRowModel[]) => {
      const ctx = await context();
      const steps = bulkSteps(chosen);
      setProgress({ done: 0, total: steps.length });
      // Claims write nothing, so their rows are read once for the whole batch.
      const cache = await readForClaims(steps.map((step) => step.target), ctx.transport);
      return runBulk(steps, (step) => applyPosting(step.target, ctx, cache), (done) => setProgress({ done, total: steps.length }));
    },
    onSuccess: async (outcome) => {
      setResult(outcome);
      setSelected(new Set());
      setProgress(null);
      // Stopped or finished: refresh and recalculate the rest before the user continues.
      await afterWrite();
    },
    onError: (error) => { setProgress(null); setProblem(error instanceof Error ? error.message : String(error)); },
  });

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
  const busy = act.isPending || bulk.isPending || refresh.phase === "refreshing";
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
        <LoanStatusStrip refresh={refresh} counts={{ review: reviewCount, notApplied: reviewCount }} digits={digits} onRefresh={() => void refresh.refresh()} onStatements={() => setStatements(true)} matching={matching} />
        <ExtraPayments debtId={debtId} payments={refresh.unscheduled ?? []} digits={digits} scheduleDirty={scheduleDirty} onChanged={() => void afterWrite()} />
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
            onFilter={setFilter}
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

      {selectedRows.length || progress ? (
        <div role="region" aria-label="Selected changes" className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border bg-background px-4 py-2 text-xs">
          <p aria-live="polite" className="flex-1">
            {progress ? `Applying ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : `${selectedRows.length} selected · Principal ${formatAmount(totals.principal, digits)} · Interest ${formatAmount(totals.interest, digits)}${totals.fees ? ` · Fees ${formatAmount(totals.fees, digits)}` : ""}`}
          </p>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>Clear</Button>
          <Button type="button" size="sm" disabled={busy || !selectedRows.length} onClick={() => setConfirming(true)}>
            {selectedRows.every((r) => r.selectable === "undo") ? `Apply ${selectedRows.length} undo${selectedRows.length === 1 ? "" : "s"}` : `Apply ${selectedRows.length} change${selectedRows.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      ) : null}

      <Dialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <DialogContent className="max-w-md">
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
          <div className="max-h-48 overflow-y-auto rounded border border-border">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground"><tr><th scope="col" className="px-2 py-1 font-normal">Due</th><th scope="col" className="px-2 py-1 font-normal">Change</th></tr></thead>
              <tbody>
                {bulkSteps(selectedRows).map((step) => (
                  <tr key={step.row.key} className="border-t border-border/60"><td className="px-2 py-1 tabular-nums">{step.row.dueDate}</td><td className="px-2 py-1">{previewDirectory ? changeHeadline(step.target, previewDirectory, digits) : ""}</td></tr>
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
            <Button type="button" onClick={() => { setConfirming(false); setResult(null); bulk.mutate(selectedRows); }}>Apply {selectedRows.length} change{selectedRows.length === 1 ? "" : "s"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={statements} onOpenChange={setStatements}>
        <SheetContent side="right" className="max-w-full overflow-y-auto" style={{ width: "min(640px, 96vw)", maxWidth: "none" }}>
          <SheetHeader>
            <SheetTitle>Lender statements</SheetTitle>
            <SheetDescription>Compare what your lender says with Bench&apos;s calculation and with Actual, to see which side is off. Nothing here changes Actual.</SheetDescription>
          </SheetHeader>
          <LenderReconciliation debt={debt} offsetHistories={offsetHistories} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
