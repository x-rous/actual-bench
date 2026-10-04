"use client";

import { useState } from "react";
import { CheckCircle2, CircleSlash, Link2, Lock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { classificationLabel } from "@/lib/assets-debt/classification/policy";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { formatAmount } from "../../lib/money";
import { renderPreviewRows, type PreviewDirectory, type PreviewRow, type PreviewSide } from "./renderPreviewRows";

/**
 * One proposal, as the rows Actual will hold (RD-084 P1.6 T137; FR-175–FR-179,
 * FR-206, SC-018, SC-019).
 *
 * Left, "What Bench will write": the register-faithful rows from
 * `renderPreviewRows`, with Before/After for existing rows. Right, the
 * calculation basis. The classification banner always carries its text label;
 * colour is never the only signal. **Apply this change** is the only control
 * that leads to an Actual write, and it is offered only for an undecided,
 * non-Blocked proposal. Undo only opens a reversal proposal.
 */

export const PREVIEW_HEADER = "This is what Actual Bench will write to Actual.";
export const WAITING_COPY = "Nothing will be written for this period until the lender's row arrives.";
const COLUMNS = ["Date", "Account", "Payee", "Category", "Notes", "Amount", "Status"] as const;

const KIND_LABELS: Record<string, string> = {
  "interest-charge": "Interest charge",
  "interest-link": "Lender interest charge",
  "fee-charge": "Capitalized fee",
  "repayment-split": "Repayment split",
  "repayment-link": "Repayment transfer link",
  "opening-adjustment": "Opening adjustment",
  "reconciliation-adjustment": "Reconciliation adjustment",
  reversal: "Reversal",
};

const BANNER = {
  safe: { icon: CheckCircle2, tone: "border-emerald-600/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100", note: null },
  review: { icon: AlertTriangle, tone: "border-amber-600/40 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100", note: "Check the split and the resulting rows before applying." },
  blocked: { icon: Lock, tone: "border-border bg-muted text-foreground", note: null },
} as const;

function statusText(row: PreviewRow): string {
  return [row.reconciled ? "Reconciled" : row.cleared === "cleared" ? "Cleared" : "Not cleared", row.linkedChip ? "Linked" : null].filter(Boolean).join(", ");
}

export function PreviewTable({ rows, label }: { rows: PreviewRow[]; label: string }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No existing rows; Bench creates new ones.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs" aria-label={label} aria-rowcount={rows.length + 1} aria-colcount={COLUMNS.length}>
        <thead>
          <tr className="border-b border-border text-[11px] text-muted-foreground" aria-rowindex={1}>
            {COLUMNS.map((column, index) => <th key={column} scope="col" aria-colindex={index + 1} className={cn("px-2 py-1 font-medium", column === "Amount" && "text-right")}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const category = row.categoryName ?? "-";
            const amount = formatAmount(row.amountMinor, row.currencyMinorDigits);
            return (
              <tr key={row.key} aria-rowindex={index + 2} className={cn("border-b border-border/60", row.splitParent && "font-medium", row.transferAccountName && "bg-muted/30")}>
                <td aria-colindex={1} aria-label={`Date: ${row.date}`} className="px-2 py-1 tabular-nums">{row.date}</td>
                <td aria-colindex={2} aria-label={`Account: ${row.accountName}${row.accountBudgetStatus === "off-budget" ? ", off-budget" : ""}`} className="px-2 py-1">
                  {row.accountName}{row.accountBudgetStatus === "off-budget" ? <span className="ml-1 rounded border border-border px-1 text-[10px] text-muted-foreground">Off-budget</span> : null}
                </td>
                <td aria-colindex={3} aria-label={`Payee: ${row.payeeName || "none"}`} className={cn("px-2 py-1", row.splitChildOf && "pl-6")}>
                  {row.transferAccountName ? <Link2 aria-hidden className="mr-1 inline size-3" /> : null}{row.payeeName}
                </td>
                <td aria-colindex={4} aria-label={`Category: ${row.categoryName ?? "none"}`} className="px-2 py-1">{category}</td>
                <td aria-colindex={5} aria-label={`Notes: ${row.notes ?? "none"}`} className="max-w-[16rem] truncate px-2 py-1" title={row.notes ?? undefined}>{row.notes}</td>
                <td aria-colindex={6} aria-label={`Amount: ${amount}`} className={cn("px-2 py-1 text-right tabular-nums", row.amountMinor < 0 && "text-destructive")}>{amount}</td>
                <td aria-colindex={7} aria-label={`Status: ${statusText(row)}`} className="px-2 py-1">
                  {statusText(row)}{row.linkedChip ? <span className="ml-1 rounded border border-border px-1 text-[10px]">Linked</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type PostingPreviewProps = {
  posting: PostingView;
  directory: PreviewDirectory;
  currencyMinorDigits: number;
  busy?: boolean;
  onApply?: () => void;
  onDecline?: () => void;
  onUndo?: () => void;
  onCheck?: () => void;
  onCompleteLink?: () => void;
  completionDetail?: string | null;
  actualRowHref?: (rowId: string) => string | null;
};

export function PostingPreview({ posting, directory, currencyMinorDigits, busy, onApply, onDecline, onUndo, onCheck, onCompleteLink, completionDetail, actualRowHref }: PostingPreviewProps) {
  const existing = posting.output.kind === "restructure" || posting.output.kind === "link";
  const [side, setSide] = useState<PreviewSide>("after");
  const classification = typeof posting.classification === "string" ? posting.classification : "blocked";
  const status = typeof posting.status === "string" ? posting.status : "unknown";
  const banner = BANNER[classification];
  const BannerIcon = banner.icon;
  const rows = renderPreviewRows(posting.output, directory, currencyMinorDigits, existing ? side : "after");
  const kind = typeof posting.postingKind === "string" ? posting.postingKind : "unknown";
  const blockedRow = posting.output.kind === "restructure" ? posting.output.before.id : posting.output.kind === "link" ? posting.output.counterpartBefore.id : null;
  const href = classification === "blocked" && blockedRow && actualRowHref ? actualRowHref(blockedRow) : null;
  const canDecide = status === "proposed" && classification !== "blocked";
  const components = "components" in posting.output ? posting.output.components : [];
  const headingId = `posting-${posting.id}`;

  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <header className="flex flex-wrap items-baseline gap-2">
        <h3 id={headingId} className="text-sm font-semibold">{KIND_LABELS[kind] ?? kind} · {posting.periodKey.length === 10 ? posting.periodKey : "reversal"}</h3>
        <span className="text-[11px] text-muted-foreground">Status: {status}</span>
      </header>

      {status === "proposed" || status === "superseded" || status === "declined" ? (
        <div role="status" className={cn("flex items-start gap-2 rounded border px-3 py-2 text-xs", banner.tone)}>
          <BannerIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{classificationLabel(classification)}</p>
            {banner.note ? <p>{banner.note}</p> : null}
            <ul className="list-disc pl-4">{posting.reasons.map((reason) => <li key={reason.code}>{reason.text}</li>)}</ul>
            {href ? <a className="underline" href={href} target="_blank" rel="noreferrer">Open the row in Actual</a> : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-label="What Bench will write" className="flex min-w-0 flex-col gap-2">
          <p className="text-xs font-medium">{PREVIEW_HEADER}</p>
          {existing ? (
            <div role="group" aria-label="Show rows" className="flex gap-1">
              {(["before", "after"] as const).map((value) => (
                <Button key={value} type="button" size="sm" variant={side === value ? "default" : "outline"} aria-pressed={side === value} onClick={() => setSide(value)}>
                  {value === "before" ? "Before" : "After"}
                </Button>
              ))}
            </div>
          ) : null}
          <PreviewTable rows={rows} label={`${KIND_LABELS[kind] ?? kind} rows, ${existing ? side : "after"}`} />
        </section>
        <section aria-label="Calculation basis" className="flex flex-col gap-1 rounded border border-border p-2 text-xs">
          <p className="font-medium">Calculation basis</p>
          {components.length ? (
            <dl className="grid grid-cols-2 gap-x-2">
              {components.map((c) => <div key={c.kind} className="contents"><dt className="text-muted-foreground capitalize">{c.kind}</dt><dd className="text-right tabular-nums">{formatAmount(c.amountMinor, currencyMinorDigits)}</dd></div>)}
            </dl>
          ) : <p className="text-muted-foreground">Links existing rows; no amounts are calculated.</p>}
          <p className="text-muted-foreground">Configuration revision {posting.configRevision}{Object.keys(posting.engineVersions).length ? ` · ${Object.entries(posting.engineVersions).filter(([name]) => name.startsWith("loan-") || name === "projection").map(([, v]) => v).join(", ")}` : ""}</p>
        </section>
      </div>

      <footer className="flex flex-wrap items-center gap-2">
        {canDecide ? (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={onApply}>Apply this change</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onDecline}>Not now</Button>
          </>
        ) : null}
        {status === "applied" && posting.appliedAt ? (
          <p className="text-xs">
            Applied on {posting.appliedAt.slice(0, 10)}.{" "}
            {posting.reversalOf ? null : <Button type="button" size="sm" variant="link" className="h-auto p-0" disabled={busy} onClick={onUndo}>Undo - opens a reversal proposal.</Button>}
          </p>
        ) : null}
        {status === "indeterminate" ? (
          <>
            <p className="text-xs text-amber-700 dark:text-amber-300"><CircleSlash aria-hidden className="mr-1 inline size-3" />This change was interrupted. Bench never retries it blindly.</p>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCheck}>Check Actual</Button>
            {completionDetail ? <><p className="text-xs">{completionDetail}</p><Button type="button" size="sm" disabled={busy} onClick={onCompleteLink}>Complete the transfer link</Button></> : null}
          </>
        ) : null}
        {status === "failed" && posting.error ? <p role="alert" className="text-xs text-destructive">This change failed: {String((posting.error as { message?: unknown }).message ?? "verification found a problem")}. Check Actual, then preview again.</p> : null}
      </footer>
    </article>
  );
}
