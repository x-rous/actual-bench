"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PdfDetectionIssue = {
  message: string;
  /** The control in Statement interpretation that answers this question. */
  focus?: string;
};

/**
 * What stands between this statement and an import, in one place.
 *
 * Both the detection step and the parser details read from this: an issue that
 * appears in two views should not be two different lists that drift apart, and
 * "Fix this" should mean the same thing wherever it is offered.
 */
export function PdfDetectionIssueList({
  issues,
  extraMessages = [],
  label,
  framed = true,
  onResolve,
}: {
  issues: PdfDetectionIssue[];
  /** Parser warnings, which carry no control to focus. */
  extraMessages?: string[];
  label: string;
  framed?: boolean;
  onResolve: (issue: PdfDetectionIssue) => void;
}) {
  const byMessage = new Map(issues.map((issue) => [issue.message, issue]));
  for (const message of extraMessages) {
    if (!byMessage.has(message)) byMessage.set(message, { message });
  }
  const entries = [...byMessage.values()];
  if (entries.length === 0) return null;

  return (
    <section
      aria-label={label}
      className={cn(framed && "rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2")}
    >
      <ul className="space-y-1.5 text-xs">
        {entries.map((issue) => (
          <li key={issue.message} className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 text-foreground">{issue.message}</span>
            {issue.focus && (
              <Button size="xs" variant="outline" className="shrink-0" onClick={() => onResolve(issue)}>
                Fix this
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
