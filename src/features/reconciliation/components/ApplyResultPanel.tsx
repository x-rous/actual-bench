"use client";

import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApplyConfig } from "@/lib/reconciliation/session/plan";
import { prospectiveTransaction } from "@/lib/reconciliation/session/prospective";
import { formatMinorUnits, formatShortDate } from "../lib/format";
import type { Option } from "./StagedFields";
import type { ApplyRunResult } from "@/lib/reconciliation/apply/executor";
import type { ApplyOperation, ApplyPlan } from "@/lib/reconciliation/apply/operations";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import type { VerificationReport } from "@/lib/reconciliation/apply/verification";

/**
 * What actually happened (feature spec §40).
 *
 * A partial failure is reported as a partial failure — not rounded up to
 * success, not rounded down to "it failed". The session survives it, and
 * retrying re-attempts only what did not succeed, so the honest number is also
 * the useful one.
 */

export type ApplyResultPanelProps = {
  plan: ApplyPlan;
  /** The rows behind each operation, so the record names transactions not ids. */
  items: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  /** Resolves payee ids to the names the user recognises. */
  payees: Option[];
  /** The same write settings the run used, so the record matches what happened. */
  applyConfig: ApplyConfig;
  result: ApplyRunResult;
  /** The read-back check, once it has run. `null` while it is still running. */
  verification: VerificationReport | null;
  isVerifying: boolean;
  isApplying: boolean;
  onRetry: () => void;
};

export function ApplyResultPanel({
  plan,
  items,
  statementRows,
  transactions,
  payees,
  applyConfig,
  result,
  verification,
  isVerifying,
  isApplying,
  onRetry,
}: ApplyResultPanelProps) {
  const failures = result.results.filter((entry) => entry.status === "failed");

  /*
   * Every operation this session has ever produced, not only the ones still
   * outstanding. The plan deliberately excludes work that already ran — which
   * is exactly the work this screen exists to describe, so it is rebuilt here
   * from the items instead.
   */
  const operationsById = new Map<string, ApplyOperation>(
    plan.operations.map((operation) => [operation.id, operation])
  );

  const itemById = new Map(items.map((item) => [item.id, item]));

  const payeeName = (id: string | null) =>
    id ? payees.find((option) => option.id === id)?.name ?? null : null;

  /** Names a written row the way the user would recognise it. */
  const describe = (operationId: string): string => {
    const operation = operationsById.get(operationId);
    const itemId = operation?.itemId ?? operationId.split(":").slice(1).join(":");
    const item = itemById.get(itemId);
    if (!item) return "A transaction";
    const row = statementRows.get(item.statementRowIds[0] ?? "");
    if (row) return `${row.postedDate} · ${row.description}`;
    const transaction = transactions.get(item.actualTransactionIds[0] ?? "");
    if (transaction) {
      return `${transaction.date} · ${transaction.payeeName ?? transaction.notes ?? "transaction"}`;
    }
    return "A transaction";
  };

  /** What each recorded outcome did, for the written-rows list. */
  const KIND_LABELS: Record<string, string> = {
    create: "Created",
    update: "Updated",
    delete: "Deleted",
  };

  const written = result.results.filter(
    (entry) => entry.status === "applied" || entry.status === "skipped"
  );

  return (
    // Only the table scrolls, as on the review screen — the headline and the
    // retry action stay in view while you read down the list.
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      <div className="flex items-start gap-2">
        {result.complete ? (
          <CheckCircle2
            className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
        ) : (
          <AlertTriangle
            className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
        )}
        <div>
          <h2 className="text-sm font-semibold">
            {result.complete ? "Applied" : "Applied with problems"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {result.applied} change{result.applied === 1 ? "" : "s"} written
            {result.skipped > 0 && ` · ${result.skipped} already done`}
            {result.failed > 0 && ` · ${result.failed} failed`}
          </p>
        </div>
      </div>

      {result.skipped > 0 && (
        <p className="text-xs text-muted-foreground">
          Changes marked already done were written by an earlier attempt. They were recognised and
          left alone rather than repeated.
        </p>
      )}

      {/*
        Reporting what the writes returned is not the same claim as "the budget
        now says this", so the account is read back and compared. Silence here
        would be indistinguishable from not having checked.
      */}
      {isVerifying ? (
        <p className="text-xs text-muted-foreground">Checking the account against what was approved…</p>
      ) : verification ? (
        verification.ok ? (
          <p className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
            Checked the account afterwards: all {verification.checked} change
            {verification.checked === 1 ? "" : "s"} are there as approved.
          </p>
        ) : (
          <section className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
            <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              The account does not match what was approved
            </h3>
            <p className="mb-2 text-[11px] text-muted-foreground">
              These writes were reported as successful, but reading the account back tells a
              different story. Check them in Actual before relying on this reconciliation.
            </p>
            <ul className="space-y-1 text-xs">
              {verification.issues.map((issue) => {
                const operation = operationsById.get(issue.operationId);
                return (
                  <li key={`${issue.operationId}-${issue.kind}`}>
                    <span className="font-medium">{operation?.kind ?? "Change"}</span>
                    <span className="text-muted-foreground"> — {issue.detail}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )
      ) : null}

      {/*
        What was written, row by row, with the statement it came from beside it.

        The panel previously listed only failures, which left a successful apply
        — and every reopened session — showing a headline and nothing at all.
        The point of keeping the outcome is being able to read it afterwards,
        and reading it means seeing the bank's row next to what became of it.
      */}
      {written.length > 0 && (
        <section className="-mx-4 flex min-h-[18rem] flex-1 flex-col border-y border-border/60">
          <h3 className="shrink-0 border-b border-border/50 px-3 py-2 text-xs font-semibold">
            What was written
          </h3>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-xs">
              <caption className="sr-only">
                Every change written to the budget, with the statement row behind it
              </caption>
              <thead className="sticky top-0 z-10 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={3}
                    className="bg-muted px-3 pt-1.5 text-left font-semibold text-foreground"
                  >
                    From the bank statement
                  </th>
                  <th className="border-x border-border bg-background px-3 pt-1.5 text-left font-semibold text-foreground">
                    Did
                  </th>
                  <th
                    scope="colgroup"
                    colSpan={4}
                    className="bg-background px-3 pt-1.5 text-left font-semibold text-foreground"
                  >
                    Transaction in Actual
                  </th>
                </tr>
                <tr>
                  <th scope="col" className="w-16 border-b border-border bg-muted px-3 pb-1.5 text-left font-medium">
                    Date
                  </th>
                  <th scope="col" className="w-[22%] border-b border-border bg-muted px-3 pb-1.5 text-left font-medium">
                    Description
                  </th>
                  <th scope="col" className="w-24 border-b border-border bg-muted px-3 pb-1.5 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="w-20 border-x border-b border-border bg-background px-3 pb-1.5 text-left font-medium">
                    Action
                  </th>
                  <th scope="col" className="w-16 border-b border-border bg-background px-3 pb-1.5 text-left font-medium">
                    Date
                  </th>
                  <th scope="col" className="w-[18%] border-b border-border bg-background px-3 pb-1.5 text-left font-medium">
                    Payee
                  </th>
                  <th scope="col" className="border-b border-border bg-background px-3 pb-1.5 text-left font-medium">
                    Notes
                  </th>
                  <th scope="col" className="w-24 border-b border-border bg-background px-3 pb-1.5 text-right font-medium">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {written.map((entry) => {
                  const operation = operationsById.get(entry.operationId);
                  const item = operation ? itemById.get(operation.itemId) : undefined;
                  const statementRow = item
                    ? statementRows.get(item.statementRowIds[0] ?? "")
                    : undefined;
                  const transaction = item
                    ? transactions.get(item.actualTransactionIds[0] ?? "")
                    : undefined;
                  const kind = operation?.kind ?? entry.operationId.split(":")[0];
                  const deleted = kind === "delete";
                  const pending =
                    item && !deleted
                      ? prospectiveTransaction({ item, statementRow, transaction, applyConfig })
                      : null;

                  return (
                    <tr key={entry.operationId} className="border-b border-border/20">
                      <td className="whitespace-nowrap px-3 py-1 tabular-nums text-muted-foreground">
                        {statementRow ? formatShortDate(statementRow.postedDate) : "—"}
                      </td>
                      <td className="max-w-0 truncate px-3 py-1" title={statementRow?.description}>
                        {statementRow?.description ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1 text-right tabular-nums">
                        {statementRow ? formatMinorUnits(statementRow.amount) : "—"}
                      </td>

                      <td
                        className={cn(
                          "whitespace-nowrap border-x border-border/40 px-3 py-1 font-medium",
                          entry.status === "skipped" && "text-muted-foreground"
                        )}
                      >
                        {KIND_LABELS[kind] ?? kind}
                        {entry.status === "skipped" && (
                          <span className="block text-[10px] font-normal">already done</span>
                        )}
                      </td>

                      {deleted ? (
                        <td colSpan={4} className="px-3 py-1 text-muted-foreground line-through">
                          {transaction?.payeeName ?? transaction?.notes ?? "This transaction"} ·{" "}
                          {formatMinorUnits(transaction?.amount ?? 0)}
                        </td>
                      ) : (
                        <>
                          <td className="whitespace-nowrap px-3 py-1 tabular-nums text-muted-foreground">
                            {pending?.date ? formatShortDate(pending.date) : "—"}
                          </td>
                          <td className="max-w-0 truncate px-3 py-1">
                            {payeeName(pending?.payeeId ?? null) ??
                              (pending?.isNew && applyConfig.descriptionTarget === "payee"
                                ? statementRow?.description ?? "—"
                                : "—")}
                          </td>
                          <td className="max-w-0 truncate px-3 py-1" title={pending?.notes ?? undefined}>
                            {pending?.notes ?? "—"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1 text-right tabular-nums">
                            {pending && pending.amount !== null
                              ? formatMinorUnits(pending.amount)
                              : "—"}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {failures.length > 0 && (
        <section className="rounded-md border border-destructive/40 p-3">
          <h3 className="mb-2 text-xs font-semibold">What failed</h3>
          <ul className="space-y-1.5 text-xs">
            {failures.map((failure) => {
              const operation = operationsById.get(failure.operationId);
              return (
                <li key={failure.operationId}>
                  <span className="font-medium">
                    {KIND_LABELS[operation?.kind ?? ""] ?? "Change"} · {describe(failure.operationId)}
                  </span>
                  <span className="block text-muted-foreground">{failure.error}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Retrying re-attempts only these. Changes that succeeded are not written again.
          </p>
        </section>
      )}

      {/* No back button here: the progress header and the page toolbar both
          already lead out of this screen. */}
      <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-3">
        {!result.complete && (
          <Button onClick={onRetry} disabled={isApplying}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Retry what failed
          </Button>
        )}
      </div>
    </div>
  );
}
