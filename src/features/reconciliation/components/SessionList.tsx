"use client";

import { ArrowRight, FileText, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReconciliationSessionRecord } from "../lib/reconciliationApi";

/**
 * Screen 1 — the reconciliation home (UX §3).
 *
 * The feature opens onto persistent sessions rather than straight into an
 * uploader: a user can stop midway through resolving discrepancies and come
 * back without losing staged decisions.
 */

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  parsed: "Parsed",
  matching: "Matching",
  needs_review: "Needs review",
  ready: "Ready to apply",
  applying: "Applying",
  partial: "Completed with issues",
  completed: "Completed",
  failed: "Failed",
};

/**
 * Status tone. Never colour alone — each badge also carries its text label, so
 * the state is readable without perceiving hue (AGENTS.md §8).
 */
function statusTone(status: string): string {
  switch (status) {
    case "completed":
      return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
    case "partial":
    case "failed":
      return "border-destructive/40 text-destructive";
    case "ready":
      return "border-sky-500/40 text-sky-600 dark:text-sky-400";
    case "needs_review":
      return "border-amber-500/40 text-amber-600 dark:text-amber-400";
    default:
      return "border-border text-muted-foreground";
  }
}

function formatPeriod(session: ReconciliationSessionRecord): string | null {
  if (!session.statementStart || !session.statementEnd) return null;
  return `${session.statementStart} → ${session.statementEnd}`;
}

type SessionListProps = {
  sessions: ReconciliationSessionRecord[];
  onOpen: (session: ReconciliationSessionRecord) => void;
  onDelete: (session: ReconciliationSessionRecord) => void;
  onNew: () => void;
};

export function SessionList({ sessions, onOpen, onDelete, onNew }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">No reconciliation sessions yet</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Check transactions you entered by hand or through automation against the bank
            statement, then apply only the changes you have reviewed.
          </p>
        </div>
        <Button onClick={onNew}>Start reconciliation</Button>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border/40">
      {sessions.map((session) => {
        const period = formatPeriod(session);
        return (
          <li key={session.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {session.accountName ?? "Unnamed account"}
                </span>
                <Badge variant="outline" className={cn("text-[11px]", statusTone(session.status))}>
                  {STATUS_LABELS[session.status] ?? session.status}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {[session.statementName, period].filter(Boolean).join(" · ") ||
                  "No statement imported yet"}
              </p>
            </div>

            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete reconciliation for ${session.accountName ?? "account"}`}
              onClick={() => onDelete(session)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpen(session)}>
              {session.status === "completed" ? "View" : "Continue"}
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
