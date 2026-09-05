"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isEnrichmentOnly,
  type ApplyPlan,
  type UpdateOperation,
} from "@/lib/reconciliation/apply/operations";
import type { ApplyConfig } from "@/lib/reconciliation/session/plan";
import type { StatementFormat } from "@/lib/reconciliation/statement/normalize";
import { prospectiveTransaction } from "@/lib/reconciliation/session/prospective";
import { stagedFields } from "@/lib/reconciliation/session/staging";
import { statementText } from "@/lib/reconciliation/statement/text";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { formatMinorUnits, formatShortDate } from "../lib/format";
import type { Option } from "./StagedFields";

/**
 * Statement row by statement row, what it will look like in the budget.
 *
 * The operation list answers "what will run". This answers "what will my
 * statement look like afterwards", which is the question someone about to write
 * to their own budget is actually asking. Both are needed, and neither
 * substitutes for the other.
 *
 * One line per row, values shown as they will end up, with anything that
 * changes marked and carrying its previous value. Reproducing the workbench
 * here would only make the reader hunt for the difference twice.
 */

type ReviewRow = {
  item: ReconciliationItem;
  statementRow: StatementRow | undefined;
  transaction: ActualTransactionSnapshot | undefined;
  action: "create" | "update" | "delete" | "unchanged" | "later";
  /**
   * Bank provenance attached by this update, either alone or alongside a
   * staged change.
   *
   * A flag rather than another `action`, deliberately: the row is still an
   * update, still counted, still in the changing list, and every filter and
   * branch that reads `action` goes on behaving as it does today. Only how it
   * is *named* differs, because calling a pure provenance write "Update" in amber
   * puts a screenful of alarm next to rows where nothing of yours moves.
   */
  provenance: {
    /** The imported payee this row is about to replace, when it had one. */
    previous: string | null;
    /** Nothing besides imported payee is written by this operation. */
    only: boolean;
  } | null;
  pending: ReturnType<typeof prospectiveTransaction>;
  changedFields: Set<string>;
  /** `yes` = this run clears it, `already` = it is cleared and stays so. */
  willBeCleared: "yes" | "already" | "no";
};

const ACTION_LABELS: Record<ReviewRow["action"], string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
  unchanged: "No change",
  later: "Left for later",
};

const ACTION_TONES: Record<ReviewRow["action"], string> = {
  create: "text-sky-600 dark:text-sky-400",
  update: "text-amber-600 dark:text-amber-400",
  delete: "text-destructive",
  unchanged: "text-muted-foreground",
  later: "text-muted-foreground",
};

/** A value that will change, shown as it will be, carrying what it was. */
function Changed({
  changed,
  was,
  children,
}: {
  changed: boolean;
  was?: string | null;
  children: React.ReactNode;
}) {
  if (!changed) return <>{children}</>;
  return (
    <span
      className="text-amber-600 dark:text-amber-400"
      title={was ? `was: ${was}` : "not set before"}
    >
      {children}
    </span>
  );
}

export type ReviewComparisonProps = {
  plan: ApplyPlan;
  items: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  payees: Option[];
  categories: Option[];
  applyConfig: ApplyConfig;
  /** Null on a session recorded before the format was stored. */
  statementFormat?: StatementFormat | null;
  /** Rows with no decision, reported under the table they are absent from. */
  unresolved?: number;
};

export function ReviewComparison({
  plan,
  items,
  statementRows,
  transactions,
  payees,
  categories,
  applyConfig,
  statementFormat = null,
  unresolved = 0,
}: ReviewComparisonProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [search, setSearch] = useState("");

  const nameOf = (options: Option[], id: string | null) =>
    id ? options.find((option) => option.id === id)?.name ?? null : null;

  const rows = useMemo<ReviewRow[]>(() => {
    const operationByItem = new Map(plan.operations.map((operation) => [operation.itemId, operation]));

    const built = items.map((item) => {
      const statementRow = statementRows.get(item.statementRowIds[0] ?? "");
      const transaction = transactions.get(item.actualTransactionIds[0] ?? "");
      const operation = operationByItem.get(item.id);

      const action: ReviewRow["action"] = operation
        ? operation.kind
        : item.disposition === "unresolved"
          ? "later"
          : "unchanged";

      /*
       * Deliberately not added to `changedFields`: that set is what the review
       * screen counts as staged user fields ("3 payees, 2 notes") and what puts
       * a cell in amber. Provenance is neither.
       */
      const provenanceOperation: UpdateOperation | null =
        operation?.kind === "update" && operation.importedPayee != null ? operation : null;
      const provenance = provenanceOperation
        ? {
            previous: transaction?.importedPayee?.trim() || null,
            only: isEnrichmentOnly(provenanceOperation),
          }
        : null;

      const changedFields = new Set<string>(stagedFields(item.stagedChanges));
      const clearedByThisRun =
        (operation?.kind === "update" && operation.cleared === true) ||
        (operation?.kind === "create" && operation.cleared === true);
      if (clearedByThisRun) changedFields.add("cleared");

      const willBeCleared: ReviewRow["willBeCleared"] = clearedByThisRun
        ? "yes"
        : transaction?.cleared
          ? "already"
          : "no";

      return {
        willBeCleared,
        item,
        statementRow,
        transaction,
        action,
        provenance,
        pending: prospectiveTransaction({ item, statementRow, transaction, applyConfig, statementFormat }),
        changedFields,
      };
    });

    // Statement order, so the reader can follow their own document down the
    // page rather than reconciling two orderings in their head.
    return built.sort((a, b) => {
      const left = a.statementRow?.postedDate ?? a.transaction?.date ?? "";
      const right = b.statementRow?.postedDate ?? b.transaction?.date ?? "";
      if (left !== right) return left < right ? -1 : 1;
      return (a.statementRow?.sourceRowNumber ?? 0) - (b.statementRow?.sourceRowNumber ?? 0);
    });
  }, [plan, items, statementRows, transactions, applyConfig, statementFormat]);

  const changing = rows.filter((row) => row.action !== "unchanged" && row.action !== "later");
  const quiet = rows.filter((row) => row.action === "unchanged" || row.action === "later");
  const shown = showUnchanged ? rows : changing;

  /*
   * Searched across both sides at once. Someone looking for a row is looking
   * for a merchant or an amount and does not know, or care, which of the two
   * columns it will turn up in.
   */
  const needle = search.trim().toLowerCase();
  const visible = needle
    ? shown.filter((row) => {
        const payeeName = nameOf(payees, row.pending.payeeId);
        return [
          row.statementRow?.importedPayee,
          row.statementRow?.bankNotes,
          row.statementRow?.bankReference,
          row.statementRow ? formatMinorUnits(row.statementRow.amount) : null,
          row.statementRow?.postedDate,
          payeeName,
          row.pending.notes,
          row.transaction?.payeeName,
          row.transaction?.notes,
          row.pending.amount !== null ? formatMinorUnits(row.pending.amount) : null,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
    : shown;

  // Bled to the full width of the page, like the workbench grid: this is the
  // table the screen exists for, and every column in it is earning its space.
  return (
    // `min-h` so a short viewport shrinks the table rather than erasing it.
    <section className="-mx-4 flex min-h-[14rem] flex-1 flex-col border-y border-border/60">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your statement, after applying
        </h3>

        <div className="relative flex items-center">
          <Search className="absolute left-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search…"
            aria-label="Search the rows being applied"
            className="h-6 w-44 rounded border border-border bg-background pl-6 pr-6 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear the search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {quiet.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(event) => setShowUnchanged(event.target.checked)}
            />
            Also show the {quiet.length} rows nothing happens to
          </label>
        )}

        <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {visible.length} of {shown.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">
            Each statement row and the transaction it will correspond to after applying
          </caption>
          {/*
            Same treatment as the workbench grid: group headings carry the side,
            a band runs down the statement's columns, and every cell paints an
            opaque background of its own so the sticky header does not let the
            rows show through it.
          */}
          <thead className="sticky top-0 z-10 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th
                scope="colgroup"
                colSpan={3}
                className="bg-muted px-2 pt-1.5 text-left font-semibold text-foreground"
              >
                From the bank statement
              </th>
              <th
                scope="col"
                className="border-x border-border bg-background px-2 pt-1.5 text-left font-semibold text-foreground"
              >
                Will
              </th>
              <th
                scope="colgroup"
                colSpan={6}
                className="bg-background px-2 pt-1.5 text-left font-semibold text-foreground"
              >
                Resulting transaction in Actual
              </th>
            </tr>
            <tr>
              <th scope="col" className="w-14 border-b border-border bg-muted px-2 pb-1.5 text-left font-medium">
                Date
              </th>
              {/* Capped: the statement side is context, the resulting side is
                  what the user is agreeing to and needs the room. */}
              <th scope="col" className="w-[20%] border-b border-border bg-muted px-2 pb-1.5 text-left font-medium">
                Description
              </th>
              <th scope="col" className="w-20 border-b border-border bg-muted px-2 pb-1.5 text-right font-medium">
                Amount
              </th>
              <th
                scope="col"
                className="w-32 border-x border-b border-border bg-background px-2 pb-1.5 text-left font-medium"
              >
                Action
              </th>
              <th scope="col" className="w-14 border-b border-border bg-background px-2 pb-1.5 text-left font-medium">
                Date
              </th>
              <th scope="col" className="w-[16%] border-b border-border bg-background px-2 pb-1.5 text-left font-medium">
                Payee
              </th>
              <th scope="col" className="w-[26%] border-b border-border bg-background px-2 pb-1.5 text-left font-medium">
                Notes
              </th>
              <th scope="col" className="w-[14%] border-b border-border bg-background px-2 pb-1.5 text-left font-medium">
                Category
              </th>
              <th scope="col" className="w-20 border-b border-border bg-background px-2 pb-1.5 text-right font-medium">
                Amount
              </th>
              <th scope="col" className="w-16 border-b border-border bg-background px-2 pb-1.5 text-left font-medium">
                Cleared
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const deleted = row.action === "delete";
              const payeeName = nameOf(payees, row.pending.payeeId);
              const categoryName = nameOf(categories, row.pending.categoryId);

              return (
                <tr key={row.item.id} className="border-b border-border/20">
                  <td className="whitespace-nowrap px-2 py-1 tabular-nums text-muted-foreground">
                    {row.statementRow ? formatShortDate(row.statementRow.postedDate) : "-"}
                  </td>
                  <td
                    className="max-w-0 truncate px-2 py-1"
                    title={
                      row.statementRow
                        ? [row.statementRow.importedPayee, row.statementRow.bankNotes]
                            .filter(Boolean)
                            .join(" · ")
                        : undefined
                    }
                  >
                    {statementText(row.statementRow) || "-"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                    {row.statementRow ? formatMinorUnits(row.statementRow.amount) : "-"}
                  </td>

                  {/*
                    Amber means "your data is changing". A row that only gains
                    the bank's merchant text is muted instead — unless it is
                    replacing an imported payee that was already there, which is
                    the one case where something is genuinely being overwritten
                    and earns both the colour and a line saying what it was.
                  */}
                  <td
                    className={cn(
                      "border-x border-border/40 px-2 py-1 font-medium",
                      row.provenance?.only
                        ? row.provenance.previous
                          ? ACTION_TONES.update
                          : "text-muted-foreground"
                        : ACTION_TONES[row.action],
                      !row.provenance?.previous && "whitespace-nowrap"
                    )}
                    title={
                      row.provenance
                        ? row.provenance.previous
                          ? `Records the statement description as this transaction's imported payee, replacing: ${row.provenance.previous}`
                          : "Records the statement description as this transaction's imported payee."
                        : undefined
                    }
                  >
                    {row.provenance?.only
                      ? "Bank text"
                      : row.provenance
                        ? `${ACTION_LABELS[row.action]} + bank text`
                        : ACTION_LABELS[row.action]}
                    {row.provenance && (
                      // The visible label carries the distinction; this spells
                      // out the field and destination for assistive technology.
                      <span className="sr-only">
                        {row.provenance.only
                          ? " - records the statement description as the imported payee; payee, notes and category are unchanged"
                          : " - also records the statement description as the imported payee"}
                      </span>
                    )}
                    {row.provenance?.previous && (
                      <span
                        className="block max-w-28 truncate text-[11px] font-normal"
                        title={`Imported payee was: ${row.provenance.previous}`}
                      >
                        was: {row.provenance.previous}
                      </span>
                    )}
                  </td>

                  {deleted ? (
                    <td colSpan={6} className="px-2 py-1 text-muted-foreground line-through">
                      {row.transaction?.payeeName ?? row.transaction?.notes ?? "This transaction"}{" "}
                      · {formatMinorUnits(row.transaction?.amount ?? 0)}
                    </td>
                  ) : (
                    <>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-muted-foreground">
                        <Changed changed={row.changedFields.has("date")} was={row.transaction?.date}>
                          {row.pending.date ? formatShortDate(row.pending.date) : "-"}
                        </Changed>
                      </td>
                      <td className="max-w-0 truncate px-2 py-1" title={payeeName ?? undefined}>
                        <Changed
                          changed={row.changedFields.has("payeeId")}
                          was={row.transaction?.payeeName}
                        >
                          {/* A payee about to be resolved from the bank's text has
                              no id yet; the prospective row knows which name it
                              will be resolved from. */}
                          {payeeName ?? row.pending.payeeName ?? "-"}
                        </Changed>
                      </td>
                      <td className="max-w-0 truncate px-2 py-1" title={row.pending.notes ?? undefined}>
                        <Changed
                          changed={row.changedFields.has("notes")}
                          was={row.transaction?.notes}
                        >
                          {row.pending.notes ?? "-"}
                        </Changed>
                      </td>
                      <td className="max-w-0 truncate px-2 py-1" title={categoryName ?? undefined}>
                        <Changed
                          changed={row.changedFields.has("categoryId")}
                          was={row.transaction?.categoryName}
                        >
                          {categoryName ?? "-"}
                        </Changed>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                        <Changed
                          changed={row.changedFields.has("amount")}
                          was={
                            row.transaction ? formatMinorUnits(row.transaction.amount) : undefined
                          }
                        >
                          {row.pending.amount !== null ? formatMinorUnits(row.pending.amount) : "-"}
                        </Changed>
                      </td>
                      {/* Whether this row ends up cleared, since that is a
                          choice made on this screen and its effect is otherwise
                          invisible until afterwards. */}
                      <td className="whitespace-nowrap px-2 py-1">
                        {row.willBeCleared === "yes" ? (
                          <span className="text-emerald-600 dark:text-emerald-400">Yes</span>
                        ) : row.willBeCleared === "already" ? (
                          <span className="text-muted-foreground">Already</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {needle ? "No rows match that search." : "Nothing will change in your budget."}
          </p>
        )}
      </div>

      <div className="shrink-0 space-y-1 border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <p>
          Values in amber are changing - hover one to see what it is now. Everything else is shown
          as it already stands.
        </p>
        {unresolved > 0 && (
          <p>
            {unresolved} row{unresolved === 1 ? "" : "s"} still have no decision. They will be left
            exactly as they are - you can come back to them.
          </p>
        )}
      </div>
    </section>
  );
}
