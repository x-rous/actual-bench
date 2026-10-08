"use client";

import { Fragment, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../lib/money";
import { reproducePosting } from "../../lib/postingsApi";
import { postingBasisLabel, postingStatusLabel, postingTitle } from "../../lib/postingLabels";
import type { PreviewDirectory } from "../preview/renderPreviewRows";
import { buildTransformTable } from "../preview/transformRows";
import type { ChangeFilter, ChangeRowModel } from "./changeRows";
import { basisSentence, changeContext, changeHeadline, type ContextTone } from "./changeText";
import { isEditableSplit, SplitAmounts } from "./SplitOverrideEditor";

/**
 * The Activity list (RD-084 P1.6b T289; `ux-loan-workspace.md` §3.4–§3.6).
 * One chronological table with filter chips; a row expands into what changes,
 * one line of context and the exact Actual transactions (see `ChangeDetail`).
 * Presentational: every action is a callback the Activity tab owns.
 */

export type ChangeActions = {
  apply: (posting: PostingView) => void;
  decline: (posting: PostingView) => void;
  undo: (posting: PostingView) => void;
  check: (posting: PostingView) => void;
  complete: (posting: PostingView) => void;
  edit: (posting: PostingView, interestMinor: number, reason: string | null) => void;
  /** Record the edit and apply it, in one click. */
  editApply: (posting: PostingView, interestMinor: number, reason: string | null) => void;
  /** "This is the payment": choose which payment is a due date's repayment. */
  choose?: (dueDate: string) => void;
  /** Undo the applied splits that no longer match the calculation, so they can be split again. */
  splitAgain?: (dueDates: string[]) => void;
  /** Put a recorded split already in Actual back as one transfer to the loan. */
  unsplit?: (posting: PostingView) => void;
};

const CHOOSABLE_NOTICES = new Set(["repayment-missing", "no-repayment-rule", "repayment-unusable"]);

const FILTERS: { id: ChangeFilter; label: string }[] = [
  { id: "action", label: "Needs action" },
  { id: "waiting", label: "Not found" },
  { id: "applied", label: "Applied" },
  { id: "undone", label: "Undone" },
  { id: "all", label: "All" },
];

const day = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) : iso ?? "");

function categoryName(directory: PreviewDirectory, id: string | null): string | null {
  return id ? directory.categories.find((c) => c.id === id)?.name ?? "Unknown category" : null;
}

/** "Now": the target row as Actual holds it before the change. */
export function nowSummary(posting: PostingView | null, directory: PreviewDirectory): string {
  if (!posting) return "";
  const o = posting.output;
  switch (o.kind) {
    case "restructure": return o.before.transferId ? "Transfer to loan" : categoryName(directory, o.before.categoryId) ?? "Uncategorized";
    case "convert": return categoryName(directory, o.before.categoryId) ?? "Uncategorized";
    case "link": return "Not linked";
    case "claim": return o.recordedSplit ? "Split in Actual" : "Transfer to loan";
    case "adjust-split": return "Split in Actual";
    case "create": return "Not in Actual";
    default: return "";
  }
}

/** "After": only what changes. */
export function afterSummary(posting: PostingView | null, digits: number): string {
  if (!posting) return "";
  const o = posting.output;
  switch (o.kind) {
    case "restructure": return (o.payoff ? "Payoff: " : "") + o.components.map((c) => `${c.kind.charAt(0).toUpperCase()}${c.kind.slice(1)} ${formatAmount(c.amountMinor, digits)}`).join(" · ") + (o.override ? " (edited)" : "");
    case "convert": return "Transfer to loan";
    case "link": return "Linked to the lender's row";
    case "claim":
      if (o.recordedSplit) return `Principal ${formatAmount(o.recordedSplit.principalMinor, digits)} · Interest ${formatAmount(o.recordedSplit.interestMinor, digits)}${Math.abs(o.recordedSplit.interestMinor - o.recordedSplit.calculatedInterestMinor) > 1 ? " (edited)" : ""}`;
      return o.release ? "Link released" : "Recorded as the loan transfer";
    case "adjust-split": return `Principal ${formatAmount(o.recordedSplit.principalMinor, digits)} · Interest ${formatAmount(o.recordedSplit.interestMinor, digits)}${o.edit ? " (edited)" : ""}`;
    case "create": return `${postingTitle(posting)} ${formatAmount(Math.abs(o.operations.reduce((sum, op) => sum + op.amountMinor, 0)), digits)}`;
    default: return "";
  }
}

const STATE_LABEL: Record<ChangeRowModel["state"], string> = {
  recommended: "Recommended", review: "Review", blocked: "Blocked", waiting: "Waiting", applying: "Applying", applied: "Applied",
  "undo-pending": "Undo pending", undone: "Undone", failed: "Failed", interrupted: "Interrupted",
};

function statusText(row: ChangeRowModel): string {
  const error = row.posting?.error as { cause?: unknown; detail?: unknown } | null | undefined;
  if (row.state === "undone" && error?.cause === "changed-in-actual") return `Changed in Actual: ${String(error.detail ?? "")}`;
  if (row.state === "waiting") return row.notice && CHOOSABLE_NOTICES.has(row.notice.code) ? "Not found" : "Waiting";
  if (row.state === "applied" && row.posting?.appliedAt) return `Applied ${row.posting.appliedAt.slice(0, 10)}`;
  if (row.state === "blocked") return `Blocked: ${row.posting?.reasons[0]?.text ?? ""}`;
  return STATE_LABEL[row.state];
}

export function ChangeList({
  rows, filter, onFilter, counts, selected, onToggle, onToggleAll, expanded, onExpand, directory, digits, busy, actions, completion, stepNote, toolbar,
}: {
  rows: ChangeRowModel[];
  filter: ChangeFilter;
  onFilter: (filter: ChangeFilter) => void;
  counts: Record<ChangeFilter, number>;
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onToggleAll: (keys: string[], on: boolean) => void;
  expanded: ReadonlySet<string>;
  onExpand: (key: string) => void;
  directory: PreviewDirectory;
  digits: number;
  busy: boolean;
  actions: ChangeActions;
  completion: Record<string, string>;
  /** T278: "Step 1 of 2" / "Step 2 of 2" notes for the two-step lender flow. */
  stepNote: (row: ChangeRowModel) => string | null;
  /** Controls shown on the same row as the filter chips, before them (the period). */
  toolbar?: React.ReactNode;
}) {
  const selectable = rows.filter((r) => r.selectable).map((r) => r.key);
  const allOn = selectable.length > 0 && selectable.every((key) => selected.has(key));
  return (
    <section aria-label="Changes" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {toolbar}
        <div role="group" aria-label="Filter changes" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button key={f.id} type="button" size="sm" variant={filter === f.id ? "default" : "outline"} aria-pressed={filter === f.id} className="h-7" onClick={() => onFilter(f.id)}>
              {f.label} {counts[f.id]}
            </Button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          {filter === "action" ? "Nothing needs your action. Applied changes and due dates with no payment found are under their filters." : "Nothing here."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[880px] text-xs">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="w-8 px-2 py-2">
                  <Checkbox aria-label="Select all available changes" checked={allOn} disabled={busy || selectable.length === 0} onCheckedChange={(on) => onToggleAll(selectable, on)} />
                </th>
                <th scope="col" className="px-2 py-2">Due</th>
                <th scope="col" className="px-2 py-2">Paid</th>
                <th scope="col" className="px-2 py-2 text-right">Payment</th>
                <th scope="col" className="px-2 py-2">Now</th>
                <th scope="col" className="px-2 py-2">After</th>
                <th scope="col" className="px-2 py-2">Status</th>
                <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = expanded.has(row.openKey);
                const title = row.posting ? postingTitle(row.posting) : row.notice?.text ?? "";
                return (
                  <Fragment key={row.key}>
                    <tr className={cn("border-t border-border align-top", row.state === "undo-pending" && "bg-amber-50/60 dark:bg-amber-950/20")}>
                      <td className="px-2 py-2">
                        {row.selectable ? <Checkbox aria-label={`Select ${title} due ${row.dueDate}`} checked={selected.has(row.key)} disabled={busy} onCheckedChange={() => onToggle(row.key)} /> : null}
                      </td>
                      <th scope="row" className="px-2 py-2 text-left font-medium tabular-nums">{row.missedDates && row.missedDates.length > 1 ? `${day(row.missedDates[0])} to ${day(row.missedDates.at(-1)!)}` : day(row.dueDate)}</th>
                      <td className="px-2 py-2 tabular-nums">{day(row.paidDate)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.paymentMinor === null ? "" : formatAmount(row.paymentMinor, digits)}</td>
                      <td className="px-2 py-2">
                        {row.posting ? nowSummary(row.posting, directory) : (
                          <span className="text-muted-foreground">
                            {row.missedDates && row.missedDates.length > 1
                              ? `No payment to this loan was found for these ${row.missedDates.length} due dates in a row. If they were paid, choose the payment for each, starting with the oldest.`
                              : row.notice?.text}
                          </span>
                        )}
                        {!row.posting && row.notice && CHOOSABLE_NOTICES.has(row.notice.code) && actions.choose ? (
                          <Button type="button" variant="link" size="sm" className="ml-2 h-auto p-0 text-xs" disabled={busy} onClick={() => actions.choose!(row.missedDates?.[0] ?? row.dueDate)}>Choose the payment{row.missedDates && row.missedDates.length > 1 ? ` for ${day(row.missedDates[0])}` : ""}</Button>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {row.posting ? <span><span className="text-muted-foreground">{title}: </span>{afterSummary(row.posting, digits)}</span> : null}
                        {stepNote(row) ? <span className="block text-[11px] text-muted-foreground">{stepNote(row)}</span> : null}
                      </td>
                      <td className="px-2 py-2">
                        <span className={cn("inline-block max-w-full rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          row.state === "blocked" || row.state === "failed" ? "bg-red-50 text-destructive dark:bg-red-950/40"
                            : row.state === "review" || row.state === "undo-pending" || row.state === "interrupted" || (row.state === "waiting" && statusText(row) === "Not found") ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                              : row.state === "applied" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : row.state === "recommended" ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                                  : "bg-muted text-muted-foreground")}>{statusText(row)}</span>
                        {row.notice?.code === "split-again" && row.notice.dueDates?.length && actions.splitAgain ? (
                          <Button type="button" size="sm" variant="outline" className="ml-2 h-6 px-2 text-xs" disabled={busy} title={row.notice.text} onClick={() => actions.splitAgain!(row.notice!.dueDates!)}>
                            {row.notice.dueDates.length === 1 ? "Split again" : `Split ${row.notice.dueDates.length} again`}
                          </Button>
                        ) : null}
                        {row.state === "applied" && row.posting && !row.posting.reversalOf ? (
                          <Button type="button" variant="link" size="sm" className="ml-2 h-auto p-0 text-xs" disabled={busy} onClick={() => actions.undo(row.posting!)}>Undo</Button>
                        ) : null}
                        {row.state === "applied" && row.posting?.output.kind === "claim" && row.posting.output.recordedSplit && actions.unsplit ? (
                          <Button type="button" variant="link" size="sm" className="ml-2 h-auto p-0 text-xs" disabled={busy} title="Put the payment back as one transfer to the loan; Bench then proposes the split again" onClick={() => actions.unsplit!(row.posting!)}>Unsplit</Button>
                        ) : null}
                        {row.state === "undo-pending" && row.undo ? (
                          <span className="ml-2 inline-flex gap-1">
                            <Button type="button" size="sm" className="h-6 px-2 text-xs" disabled={busy || row.undo.classification === "blocked" || String(row.undo.status) !== "proposed"} onClick={() => actions.apply(row.undo!)}>Apply undo</Button>
                            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busy || String(row.undo.status) !== "proposed"} onClick={() => actions.decline(row.undo!)}>Cancel</Button>
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {row.posting ? (
                          <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} details for ${title} due ${row.dueDate}`} onClick={() => onExpand(row.openKey)}>
                            {open ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                    {open && row.posting ? (
                      <tr className="border-t border-border/60 bg-muted/10">
                        <td colSpan={8} className="px-3 py-3">
                          <ChangeDetail row={row} directory={directory} digits={digits} busy={busy} actions={actions} completion={completion} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const TONE: Record<ContextTone, string> = {
  neutral: "text-foreground",
  quiet: "text-muted-foreground",
  warn: "text-amber-800 dark:text-amber-300",
  bad: "text-destructive",
};

/**
 * The expanded row (§3.6 rev 2): what changes (the split's amounts are editable in place), one
 * line of context, the exact Actual transactions as one now-to-after table (open by default),
 * then the actions. How it was calculated and earlier versions are disclosures.
 */
export function ChangeDetail({ row, directory, digits, busy, actions, completion }: { row: ChangeRowModel; directory: PreviewDirectory; digits: number; busy: boolean; actions: ChangeActions; completion: Record<string, string> }) {
  const posting = row.posting!;
  const undoPending = row.state === "undo-pending" && !!row.undo;
  const shown = undoPending ? row.undo! : posting;
  const status = String(posting.status);
  const proposed = status === "proposed" && !undoPending;
  const editable = proposed && isEditableSplit(posting);
  const context = changeContext(shown);
  const basis = basisSentence(shown);
  const [tableOpen, setTableOpen] = useState(true);
  const [calcOpen, setCalcOpen] = useState(false);
  const appliedOn = status === "applied" && posting.appliedAt ? ` · applied ${posting.appliedAt.slice(0, 10)}` : "";
  return (
    <div className="flex flex-col gap-3 text-xs">
      {editable ? (
        <SplitAmounts
          key={posting.id}
          posting={posting}
          digits={digits}
          busy={busy}
          onApply={(edit) => (edit ? actions.editApply(posting, edit.interestMinor, edit.reason) : actions.apply(posting))}
          onSave={(interest, reason) => actions.edit(posting, interest, reason)}
          onDecline={() => actions.decline(posting)}
        />
      ) : (
        <p className="text-sm font-semibold">{changeHeadline(shown, directory, digits)}{undoPending ? "" : appliedOn}</p>
      )}

      {context || basis ? (
        <div className="flex items-start gap-2 leading-relaxed">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div>
            {context ? <p className={TONE[context.tone]}>{context.text}</p> : null}
            {basis ? <p className="text-muted-foreground">{basis}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" aria-expanded={tableOpen} onClick={() => setTableOpen((v) => !v)}>
          {tableOpen ? "Hide" : "Show"} exact Actual transactions
        </Button>
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" aria-expanded={calcOpen} onClick={() => setCalcOpen((v) => !v)}>
          {calcOpen ? "Hide how it was calculated" : "How it was calculated"}
        </Button>
      </div>

      {tableOpen ? <TransformTableView output={shown.output} directory={directory} digits={digits} columns={undoPending ? ["Now", "After undo"] : status === "applied" || status === "reversed" ? ["Before", "Now"] : ["Now", "After"]} /> : null}

      {calcOpen ? (
        <section aria-label="How it was calculated" className="flex flex-col gap-1 rounded border border-border p-2">
          {"components" in shown.output && shown.output.components.length ? (
            <dl className="grid max-w-xs grid-cols-2 gap-x-2">
              {shown.output.components.map((c) => <div key={c.kind} className="contents"><dt className="capitalize text-muted-foreground">{c.kind}</dt><dd className="text-right tabular-nums">{formatAmount(c.amountMinor, digits)}</dd></div>)}
            </dl>
          ) : null}
          <p className="text-muted-foreground">{postingBasisLabel(shown)}</p>
          {["applied", "reversed"].includes(status) && ["interest-charge", "fee-charge", "repayment-split"].includes(String(posting.postingKind)) ? <Recheck postingId={posting.id} digits={digits} /> : null}
          {Object.keys(shown.engineVersions).length ? (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Technical details</summary>
              <p className="break-words">{Object.entries(shown.engineVersions).map(([name, version]) => `${name}: ${version}`).join(" · ")}</p>
            </details>
          ) : null}
        </section>
      ) : null}

      {row.notice ? <p className="text-muted-foreground">{row.notice.text}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {proposed && !editable && posting.classification !== "blocked" ? (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={() => actions.apply(posting)}>Apply this change</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => actions.decline(posting)}>Not now</Button>
          </>
        ) : null}
        {proposed && posting.postingKind === "repayment-split" && actions.choose && !(posting.output.kind === "restructure" && posting.output.payoff) ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => actions.choose!(row.dueDate)}>Choose a different payment</Button>
        ) : null}
        {undoPending && String(row.undo!.status) === "proposed" ? (
          <>
            <Button type="button" size="sm" disabled={busy || row.undo!.classification === "blocked"} onClick={() => actions.apply(row.undo!)}>Apply undo</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => actions.decline(row.undo!)}>Cancel</Button>
          </>
        ) : null}
        {status === "applied" && !undoPending && !posting.reversalOf ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => actions.undo(posting)}>Undo</Button>
        ) : null}
        {status === "indeterminate" ? (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={() => actions.check(posting)}>Check Actual</Button>
            {completion[posting.id] ? <><p>{completion[posting.id]}</p><Button type="button" size="sm" disabled={busy} onClick={() => actions.complete(posting)}>Complete the transfer link</Button></> : null}
          </>
        ) : null}
        {row.undo && String(row.undo.status) === "indeterminate" ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => actions.check(row.undo!)}>Check Actual for the undo</Button> : null}
      </div>

      {row.earlier.length ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground">History ({row.earlier.length} earlier version{row.earlier.length === 1 ? "" : "s"})</summary>
          <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
            {row.earlier.map((p) => <li key={p.id}>{p.createdAt.slice(0, 16).replace("T", " ")} · {afterSummary(p, digits)} · {postingStatusLabel(p)}</li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** A cell that changes reads "now → after", with the new value emphasised. */
function ChangedCell({ value }: { value: string }) {
  const [before, after] = value.split(" → ");
  if (after === undefined) return <>{value}</>;
  return <><span className="text-muted-foreground line-through decoration-muted-foreground/50">{before}</span> → <span className="font-medium">{after}</span></>;
}

/** The exact Actual transactions: one table, each row as it is now and what it becomes. */
export function TransformTableView({ output, directory, digits, columns }: { output: PostingView["output"]; directory: PreviewDirectory; digits: number; columns: [string, string] }) {
  const table = buildTransformTable(output, directory, digits);
  const money = (minor: number | null) => (minor === null ? "-" : formatAmount(minor, digits));
  return (
    <div className="flex flex-col gap-1 rounded border border-border">
      <div className="overflow-x-auto">
        <table aria-label="Exact Actual transactions" className="w-full min-w-[860px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-1.5 font-normal">Account</th>
              <th scope="col" className="px-2 py-1.5 font-normal">Payee</th>
              <th scope="col" className="px-2 py-1.5 font-normal">Category</th>
              <th scope="col" className="px-2 py-1.5 font-normal">Notes</th>
              <th scope="col" className="px-2 py-1.5 text-right font-normal">{columns[0]}</th>
              <th scope="col" className="w-4 px-1 py-1.5"><span className="sr-only">becomes</span></th>
              <th scope="col" className="px-2 py-1.5 text-right font-normal">{columns[1]}</th>
              <th scope="col" className="px-2 py-1.5 font-normal"><span className="sr-only">What happens</span></th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.key} className="border-t border-border/60 align-top">
                <td className="px-2 py-1.5 font-medium">{r.accountName}</td>
                <td className={cn("px-2 py-1.5", r.sub && "pl-6")}>
                  <ChangedCell value={r.payee} />
                  {r.changes.map((c) => <span key={c} className="block text-[11px] text-muted-foreground">{c}</span>)}
                </td>
                <td className="px-2 py-1.5"><ChangedCell value={r.category} /></td>
                <td className="px-2 py-1.5"><ChangedCell value={r.notes} /></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(r.nowMinor)}</td>
                <td aria-hidden="true" className="px-1 py-1.5 text-center text-muted-foreground">→</td>
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">{money(r.afterMinor)}</td>
                <td className="px-2 py-1.5"><span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{r.tag}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-0.5 px-2 pb-1.5 text-[11px] text-muted-foreground">
        {!table.anyFieldChanges ? <p>Dates and cleared status stay the same.</p> : null}
        {table.technical ? (
          <details>
            <summary className="cursor-pointer">Technical details</summary>
            <p>{table.technical}</p>
            {table.rowIds.length ? <p className="break-all">Actual row ids: {table.rowIds.join(", ")}</p> : null}
          </details>
        ) : null}
      </div>
    </div>
  );
}

/** FR-182: recompute an applied change from its stored inputs alone (no Actual access) and compare. */
function Recheck({ postingId, digits }: { postingId: string; digits: number }) {
  const check = useMutation({ mutationFn: () => reproducePosting(postingId) });
  const line = (parts: { kind: string; amountMinor: number }[]) => parts.map((c) => `${c.kind} ${formatAmount(c.amountMinor, digits)}`).join(", ") || "none";
  const label = check.data?.status === "exact-match" ? "Exact match" : check.data?.status === "not-calculated" ? "Not an engine calculation" : check.data?.status === "not-reproducible" ? "Not reproducible" : "Mismatch";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button type="button" size="sm" variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>Re-check calculation</Button>
      {check.data ? <p role="status">Stored {line(check.data.stored)} · Recomputed {line(check.data.recomputed)} · <span className="font-semibold">{label}</span>. {check.data.detail}</p> : null}
      {check.isError ? <p role="alert" className="text-destructive">{String((check.error as Error)?.message ?? check.error)}</p> : null}
    </div>
  );
}
