"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { getTransport } from "@/lib/actual";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import { datedBalanceFromTransactions, readAccountLedger, readMatchingHistory, toDebtMagnitude, type AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import type { OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { DateField, SelectField } from "../fields";
import { listDebtObservations } from "../../lib/debtsApi";
import { applyPosting, checkInterruptedPosting, completeInterruptedLink, type PostingActionContext } from "../../lib/postingActions";
import { declinePosting, listPostings, previewPostings, proposeReversal, type PreviewResponse } from "../../lib/postingsApi";
import { PostingPreview, WAITING_COPY, type PostingStep } from "./PostingPreview";
import type { PreviewDirectory } from "./renderPreviewRows";

/**
 * Proposed changes for one loan (RD-084 P1.6 T137).
 *
 * "Preview changes" reads Actual once through the shared transport (bounded,
 * read-only), sends that read to the server to plan and record proposals, and
 * shows each as the rows Actual will hold. Nothing here writes to Actual
 * except the user's click on **Apply this change**, and, for an interrupted
 * transfer link the user already approved, **Complete the transfer link**.
 */

const today = () => new Date().toISOString().slice(0, 10);
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const PAD_DAYS = 31;
/** Notices the loan's matching rules can resolve: offer the tab directly. */
const MATCHING_NOTICES = new Set(["no-repayment-rule", "repayment-missing", "repayment-ambiguous"]);

type Lap = { phase: string; ms: number };

/** Elapsed time per Preview phase: reading Actual in the browser, then planning on the server. */
function phaseClock() {
  const laps: Lap[] = [];
  let last = performance.now();
  return {
    laps,
    lap(phase: string) {
      const now = performance.now();
      laps.push({ phase, ms: now - last });
      last = now;
    },
  };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function describeTimings(laps: readonly Lap[]): string {
  const total = laps.reduce((sum, l) => sum + l.ms, 0);
  return `Preview took ${seconds(total)}: ${laps.map((l) => `${l.phase} ${seconds(l.ms)}`).join(", ")}.`;
}

async function transferPayees(transport: ActualBenchTransport): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const payee of await transport.getPayees()) if (payee.transferAccountId) out[payee.transferAccountId] = payee.id;
  return out;
}

/**
 * T278: with a lender feed, Pattern A is two explicit steps for one period:
 * split the payment, then link the split's principal line and the lender's
 * row. Each keeps its own Apply; this only names and orders them.
 */
export function stepsOf(postings: readonly PostingView[]): Map<string, PostingStep> {
  const out = new Map<string, PostingStep>();
  const live = postings.filter((p) => !["superseded", "declined", "reversed"].includes(String(p.status)));
  for (const split of live.filter((p) => p.postingKind === "repayment-split" && p.output.kind === "restructure")) {
    if (split.output.kind !== "restructure") continue;
    const principal = split.output.operations.find((c) => c.economicKind === "principal");
    if (!principal || principal.transferAccountId) continue; // No lender feed: one step only.
    const link = live.find((p) => p.postingKind === "repayment-link" && p.periodKey === split.periodKey && p.output.kind === "link");
    out.set(split.id, {
      index: 1, total: 2, title: "Split the payment",
      note: split.status === "applied"
        ? link ? "Done. Step 2 links the principal line and the lender's row." : "Done. Step 2 appears when the lender's row arrives in Actual."
        : "Apply this first. Step 2 then links the principal line and the lender's row.",
    });
    if (link) out.set(link.id, { index: 2, total: 2, title: "Link the lender's row", note: "Makes the split's principal line and the lender's row the two sides of one transfer. Apply it on its own." });
  }
  return out;
}

/** Step 2 directly after step 1 of the same period; everything else keeps its order. */
function orderSteps(postings: PostingView[]): PostingView[] {
  const links = postings.filter((p) => p.postingKind === "repayment-link" && p.output.kind === "link");
  const placed = new Set<string>();
  const out: PostingView[] = [];
  for (const p of postings) {
    if (placed.has(p.id)) continue;
    if (p.postingKind === "repayment-link" && p.output.kind === "link" && postings.some((q) => q.postingKind === "repayment-split" && q.periodKey === p.periodKey)) continue;
    out.push(p);
    placed.add(p.id);
    if (p.postingKind === "repayment-split") {
      for (const link of links.filter((l) => l.periodKey === p.periodKey)) {
        out.push(link);
        placed.add(link.id);
      }
    }
  }
  return out;
}

export function PostingsPanel({ debt, directory, offsetHistories }: { debt: DebtDetail; directory: AccountDirectory | undefined; offsetHistories?: OffsetHistorySnapshot[] }) {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  // The whole loan by default: from its start date (a saved loan always has one) to today.
  const [from, setFrom] = useState(() => (debt.config.ok ? debt.config.config.terms.openingDate : shift(today(), -31)));
  const [to, setTo] = useState(today);
  const [openingCategory, setOpeningCategory] = useState("");
  const [adjustmentCategory, setAdjustmentCategory] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [payeeMap, setPayeeMap] = useState<Record<string, string>>({});
  const [completion, setCompletion] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [timings, setTimings] = useState<Lap[] | null>(null);
  const liabilityId = debt.debt.liabilityAccountId;
  const liability = directory?.accounts.find((a) => a.id === liabilityId) ?? null;
  const sign = typeof debt.debt.signConvention === "string" ? debt.debt.signConvention : "negative-is-debt";
  const postings = useQuery({ queryKey: ["assets-debt", "postings", debt.debt.id], queryFn: () => listPostings(debt.debt.id) });
  const observations = useQuery({ queryKey: ["assets-debt", "observations", debt.debt.id], queryFn: () => listDebtObservations(debt.debt.id) });

  const previewDirectory: PreviewDirectory | null = useMemo(() => directory ? {
    accounts: directory.accounts,
    categories: directory.categories,
    transferAccountByPayee: Object.fromEntries(Object.entries(payeeMap).map(([accountId, payeeId]) => [payeeId, accountId])),
  } : null, [directory, payeeMap]);

  const actionContext = (transport: ActualBenchTransport, payees: Record<string, string>): PostingActionContext => ({
    transport,
    liabilityAccountId: liabilityId ?? "",
    transferPayeeByAccount: payees,
    offBudgetAccountIds: new Set((directory?.accounts ?? []).filter((a) => a.offBudget).map((a) => a.id)),
  });

  const run = useMutation({
    mutationFn: async () => {
      if (!connection || !directory || !liabilityId) throw new Error("Connect to the budget and choose the loan's Actual account first.");
      const transport = getTransport(connection);
      const clock = phaseClock();
      const payees = await transferPayees(transport);
      setPayeeMap(payees);
      clock.lap("payees");
      // The loan account is read once, in full: it gives both dated balances and its matching history.
      const readFrom = shift(from, -PAD_DAYS);
      const readTo = shift(to, PAD_DAYS);
      const ledger = await readAccountLedger(transport, { accountId: liabilityId });
      if (!ledger.ok) throw new Error(ledger.message);
      const paymentAccountId = debt.debt.paymentAccountId && debt.debt.paymentAccountId !== liabilityId ? debt.debt.paymentAccountId : null;
      const snapshots = [
        { accountId: liabilityId, transactions: ledger.transactions.filter((t) => t.date >= readFrom && t.date <= readTo) },
        ...(paymentAccountId ? await readMatchingHistory(transport, { accountIds: [paymentAccountId], from: readFrom, to: readTo }) : []),
      ];
      clock.lap("transactions");
      const comparisonDate = observations.data?.observations[0]?.observedOn ?? to;
      const balance = datedBalanceFromTransactions(liabilityId, ledger.transactions, comparisonDate);
      const onboarding = debt.debt.onboardingDate ? datedBalanceFromTransactions(liabilityId, ledger.transactions, debt.debt.onboardingDate) : null;
      const magnitude = (b: typeof balance | null) => (b && b.ok ? toDebtMagnitude(b.balanceMinor, sign) : null);
      const comparisonMagnitude = magnitude(balance);
      const canVerifyTransferLinks = transport.canVerifyTransferLinks ? await transport.canVerifyTransferLinks({ accountId: liabilityId, sinceDate: shift(from, -PAD_DAYS) }) : false;
      clock.lap("transfer check");
      const result = await previewPostings(debt.debt.id, {
        from, to, snapshots, accountDirectory: directory, transferPayees: payees,
        capabilities: { canRestructure: typeof transport.restructureTransactionAsSplit === "function" && typeof transport.linkTransferCounterpart === "function", canVerifyTransferLinks },
        offsetHistories,
        comparison: comparisonMagnitude !== null && comparisonMagnitude >= 0 ? { comparisonDate, actualBalanceMinor: comparisonMagnitude } : null,
        parameters: {
          openingAdjustmentCategoryId: openingCategory || null,
          adjustmentCategoryId: adjustmentCategory || null,
          actualBalanceAtOnboardingMinor: magnitude(onboarding),
        },
      });
      clock.lap("planning");
      setTimings(clock.laps);
      return result;
    },
    onSuccess: (result) => { setPreview(result); setProblem(null); void queryClient.invalidateQueries({ queryKey: ["assets-debt", "postings", debt.debt.id] }); },
    onError: (error) => setProblem(error instanceof Error ? error.message : String(error)),
  });

  const act = useMutation({
    mutationFn: async ({ posting, action }: { posting: PostingView; action: "apply" | "decline" | "undo" | "check" | "complete" }) => {
      if (action === "decline") return declinePosting(posting.id);
      if (!connection || !directory) throw new Error("Connect to the budget first.");
      const transport = getTransport(connection);
      const payees = Object.keys(payeeMap).length ? payeeMap : await transferPayees(transport);
      if (action === "undo") return proposeReversal(posting.id, { accountDirectory: directory, transferPayees: payees });
      const ctx = actionContext(transport, payees);
      if (action === "apply") return applyPosting(posting, ctx);
      if (action === "complete") return completeInterruptedLink(posting, ctx);
      const checked = await checkInterruptedPosting(posting, ctx);
      if ("needsCompletion" in checked) {
        setCompletion((current) => ({ ...current, [posting.id]: checked.needsCompletion }));
        return posting;
      }
      return checked.posting;
    },
    onSuccess: () => { setProblem(null); void queryClient.invalidateQueries({ queryKey: ["assets-debt", "postings", debt.debt.id] }); },
    onError: (error) => setProblem(error instanceof Error ? error.message : String(error)),
  });

  const visible = orderSteps((postings.data ?? []).filter((p) => ["proposed", "applying", "indeterminate", "failed"].includes(String(p.status)) || (p.status === "applied" && p.appliedAt && p.appliedAt.slice(0, 10) >= shift(today(), -7))));
  const steps = stepsOf(postings.data ?? []);
  const categoryOptions = (directory?.categories ?? []).filter((c) => !c.hidden && !c.isIncome).map((c) => ({ value: c.id, label: `${c.groupName}: ${c.name}` }));
  const onBudgetLiability = liability !== null && !liability.offBudget;
  const waiting = preview?.notices.some((n) => n.code === "waiting-for-lender");

  return (
    <section aria-labelledby="proposed-changes-heading" className="flex flex-col gap-3 px-4 py-4 text-sm">
      <div>
        <h1 id="proposed-changes-heading" className="text-base font-semibold">Proposed changes</h1>
        <p className="text-xs text-muted-foreground">Bench reads Actual, works out what the loan needs, and shows the exact rows it would write. Nothing is written until you click Apply this change on a proposal.</p>
      </div>
      <div className="grid gap-3 rounded border border-border p-3 md:grid-cols-4">
        <DateField label="From" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
        {onBudgetLiability ? <SelectField label="Opening adjustment category" value={openingCategory} onChange={setOpeningCategory} options={categoryOptions} /> : null}
        {onBudgetLiability ? <SelectField label="Reconciliation adjustment category" value={adjustmentCategory} onChange={setAdjustmentCategory} options={categoryOptions} /> : null}
        <Button type="button" size="sm" className="self-end" disabled={run.isPending || !connection || !directory} onClick={() => run.mutate()}>
          {run.isPending ? "Reading Actual..." : "Preview changes"}
        </Button>
      </div>
      {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
      {timings && !run.isPending ? <p className="text-[11px] text-muted-foreground">{describeTimings(timings)}</p> : null}
      {preview?.driftMaterial ? <p role="status" className="text-xs">The model and Actual or the lender disagree beyond the drift tolerance, so every proposal needs review. Reconcile below or review each change.</p> : null}
      {preview?.notices.length ? (
        <ul aria-label="Notes from the preview" className="flex flex-col gap-1 text-xs text-muted-foreground">
          {preview.notices.map((notice) => (
            <li key={`${notice.code}-${notice.periodKey}`}>
              {notice.periodKey}: {notice.text}
              {MATCHING_NOTICES.has(notice.code) ? <> <Link href="?view=matching" className="underline underline-offset-2">Open Repayment matching</Link></> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {waiting ? <p className="text-xs">{WAITING_COPY}</p> : null}
      {previewDirectory ? (
        visible.length ? visible.map((posting) => (
          <PostingPreview
            key={posting.id}
            posting={posting}
            directory={previewDirectory}
            currencyMinorDigits={debt.debt.currencyMinorDigits}
            busy={act.isPending}
            onApply={() => act.mutate({ posting, action: "apply" })}
            onDecline={() => act.mutate({ posting, action: "decline" })}
            onUndo={() => act.mutate({ posting, action: "undo" })}
            onCheck={() => act.mutate({ posting, action: "check" })}
            onCompleteLink={() => act.mutate({ posting, action: "complete" })}
            completionDetail={completion[posting.id] ?? null}
            step={steps.get(posting.id) ?? null}
          />
        )) : <p className="text-xs text-muted-foreground">No proposals yet. Choose a period and preview changes.</p>
      ) : <p className="text-xs text-muted-foreground">Connect to the budget to preview changes.</p>}
    </section>
  );
}
