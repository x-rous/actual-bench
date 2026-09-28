"use client";

import { useState } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One thing the reader should know or do, said the same way for every
 * statement: what happened and where, then one named action.
 *
 * - `answer`: rows are waiting on the reader. Amber, and listed first.
 * - `note`: worth knowing. Muted, so it never competes with an answer.
 */
export type PdfDetectionIssue = {
  message: string;
  kind: "answer" | "note";
  /** The button's label, naming what it does: "Choose a rule", "Show". */
  actionLabel?: string;
  /** The Statement interpretation control that settles it. */
  focus?: string;
  /** Rows to take the reader to, in page order; "Show" steps through them. */
  goTo?: { pageNumber: number; rowId: string }[];
};

/** Enough to see what needs doing without the list becoming the panel. */
const VISIBLE = 4;

/**
 * Everything that needs the reader, in one place: the detection step's only
 * list of messages. Settings that need an answer are also marked in
 * Statement interpretation, but they are named here and nowhere else.
 */
export function PdfDetectionIssueList({
  issues,
  label,
  onResolve,
}: {
  issues: PdfDetectionIssue[];
  label: string;
  /** For a `goTo` item, called with the one row being shown. */
  onResolve: (issue: PdfDetectionIssue) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Which row each "Show" button is on, by message.
  const [rowIndex, setRowIndex] = useState<Record<string, number>>({});
  const entries = [
    ...issues.filter((issue) => issue.kind === "answer"),
    ...issues.filter((issue) => issue.kind === "note"),
  ].filter((issue, index, all) => all.findIndex((entry) => entry.message === issue.message) === index);
  if (entries.length === 0) return null;
  const hasAnswers = entries.some((issue) => issue.kind === "answer");
  const shown = expanded ? entries : entries.slice(0, VISIBLE);

  return (
    <section
      aria-label={label}
      className={cn(
        "rounded-md border px-3 py-2",
        hasAnswers ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-muted/20"
      )}
    >
      <ul className="space-y-1.5 text-xs">
        {shown.map((issue) => (
          <li key={issue.message} className="flex items-start gap-2">
            {issue.kind === "answer" ? (
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            ) : (
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className={cn("min-w-0 flex-1", issue.kind === "answer" ? "text-foreground" : "text-muted-foreground")}>
              {issue.message}
            </span>
            {issue.goTo?.length ? (
              <ShowRowsButton
                rows={issue.goTo}
                index={rowIndex[issue.message] ?? 0}
                onShow={(index) => {
                  onResolve({ ...issue, goTo: [issue.goTo![index]] });
                  setRowIndex((current) => ({ ...current, [issue.message]: (index + 1) % issue.goTo!.length }));
                }}
              />
            ) : issue.focus && (
              <Button size="xs" variant="outline" className="shrink-0" onClick={() => onResolve(issue)}>
                {issue.actionLabel ?? "Fix this"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {entries.length > VISIBLE && (
        <button
          type="button"
          className="mt-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show fewer" : `Show ${entries.length - VISIBLE} more`}
        </button>
      )}
    </section>
  );
}

/**
 * "Show" for one row; "Show 1 of 3", then the next, for several - so each
 * row can be looked at in turn, with the PDF open on its page.
 */
function ShowRowsButton({
  rows,
  index,
  onShow,
}: {
  rows: { pageNumber: number; rowId: string }[];
  index: number;
  onShow: (index: number) => void;
}) {
  return (
    <Button size="xs" variant="outline" className="shrink-0 tabular-nums" onClick={() => onShow(index)}>
      {rows.length === 1 ? "Show" : `Show ${index + 1} of ${rows.length}`}
    </Button>
  );
}
