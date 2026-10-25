"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shortDate } from "@/features/credit-cards/components/primitives/format";
import type { CapitalizationIssue } from "@/lib/asset-registry/capitalization";
import { assetMoney } from "./AssetPresentation";

const signed = (minor: number) => `${minor > 0 ? "+" : ""}${assetMoney(minor)}`;

/**
 * Shows, for each expense marked as CapEx, what Bench expected, what it found and what can be done. Matching an existing
 * adjustment only records the relationship between two transactions that are already in Actual; nothing is written to Actual.
 */
export function CapitalizationReview({ issues, today, onMatch, onOpenCashflows, onClose }: {
  issues: CapitalizationIssue[]; today: string; onMatch: (issue: CapitalizationIssue, companionId: string) => Promise<void>; onOpenCashflows: () => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  async function match(issue: CapitalizationIssue, id: string) {
    setBusy(`${issue.sourceId}:${id}`); setError("");
    try { await onMatch(issue, id); } catch (e) { setError(e instanceof Error ? e.message : "Could not match these transactions"); } finally { setBusy(""); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>{issues.length === 1 ? "1 capitalization needs review" : `${issues.length} capitalizations need review`}</DialogTitle>
      <DialogDescription>An expense marked as capital expenditure should have one matching adjustment in the asset account that adds it to the asset&apos;s value.</DialogDescription></DialogHeader>
    {issues.length === 0 && <p className="text-sm text-muted-foreground">Nothing needs review.</p>}
    <ul aria-label="Capitalizations to review" className="max-h-[60vh] divide-y overflow-auto rounded-md border text-sm">
      {issues.map((issue) => <li key={`${issue.sourceId}:${issue.reason}`} className="grid gap-2 p-3">
        <div className="flex items-baseline justify-between gap-3"><p className="font-medium">{issue.label} · {shortDate(issue.date, today)}</p><span className="tabular-nums text-muted-foreground">{signed(-issue.expectedMinor)}</span></div>
        <p className="text-xs text-muted-foreground">{issue.detail}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">Expected asset adjustment</dt><dd className="tabular-nums">{signed(issue.expectedMinor)}</dd>
          <dt className="text-muted-foreground">Recorded adjustment</dt><dd className="tabular-nums">{issue.companion ? `${signed(issue.companion.amountMinor)} · ${shortDate(issue.companion.date, today)}` : "None found"}</dd>
        </dl>
        {issue.candidates.length > 0 && <div className="grid gap-1.5"><p className="text-xs font-medium">Existing adjustment that fits</p>
          {issue.candidates.map((c) => <div key={c.id} className="flex items-center justify-between gap-3 rounded border bg-muted/30 px-2 py-1.5 text-xs"><span>{c.label} · {shortDate(c.date, today)} · <span className="tabular-nums">{signed(c.amountMinor)}</span></span>
            <Button size="xs" disabled={!!busy} aria-label={`Match ${issue.label} with the adjustment on ${c.date}`} onClick={() => void match(issue, c.id)}>{busy === `${issue.sourceId}:${c.id}` ? "Matching…" : "Match"}</Button></div>)}
          <p className="text-[11px] text-muted-foreground">Matching records that these two transactions belong together. It does not change Actual.</p></div>}
        {issue.candidates.length === 0 && issue.reason !== "mismatch" && <p className="text-xs">Record the missing adjustment with <span className="font-medium">Record</span>, or unlink the expense as CapEx in Income &amp; Expenses.</p>}
        {issue.reason === "mismatch" && <p className="text-xs">Fix the amount in Actual, or unlink the expense as CapEx in Income &amp; Expenses.</p>}
      </li>)}
    </ul>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" onClick={onOpenCashflows}>Open Income &amp; Expenses</Button><Button onClick={onClose}>Close</Button></DialogFooter>
  </DialogContent></Dialog>;
}
