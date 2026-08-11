"use client";

import { AlertTriangle, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReconciliationSessionRecord } from "../lib/reconciliationApi";

/**
 * Which reconciliation this is, and how far it has got.
 *
 * A session is a thing with a life of its own — imported, worked through,
 * reviewed, applied — but every screen looked much the same, so the only way to
 * tell a finished reconciliation from one still being decided was to notice
 * which buttons were disabled. This states it.
 *
 * The steps come from the **session's own status**, not from the screen being
 * looked at, so revisiting the workbench of an applied session still says
 * Applied. Where you are is marked separately, as the current step.
 */

export type SessionStep = "import" | "reconcile" | "review" | "applied";

const STEPS: { id: SessionStep; label: string }[] = [
  { id: "import", label: "Import" },
  { id: "reconcile", label: "Reconcile" },
  { id: "review", label: "Review" },
  { id: "applied", label: "Applied" },
];

/**
 * How far the session itself has got, as an index into `STEPS`.
 *
 * `partial` and `failed` count as having reached Applied: the writing happened,
 * and what is left is a retry rather than a step not yet taken.
 */
function reachedIndex(status: string): number {
  switch (status) {
    case "draft":
    case "parsed":
      return 0;
    case "matching":
    case "needs_review":
      return 1;
    case "ready":
      return 2;
    case "applying":
    case "completed":
    case "partial":
    case "failed":
      return 3;
    default:
      return 0;
  }
}

/**
 * Whether the session has *finished* the step it has reached.
 *
 * Distinct from having reached it: `applying` has reached Applied but is still
 * doing it, so it keeps the in-progress dot. Everything terminal is done, even
 * when it went badly — a failed apply is a step taken, not one outstanding.
 */
function isTerminal(status: string): boolean {
  return status === "completed" || status === "partial" || status === "failed";
}

/** The word for a finished session, which is not always "Applied". */
function outcomeLabel(status: string): string | null {
  switch (status) {
    case "completed":
      return "Applied";
    case "partial":
      return "Applied with problems";
    case "failed":
      return "Apply failed";
    case "applying":
      return "Applying…";
    default:
      return null;
  }
}

export type SessionHeaderProps = {
  session: ReconciliationSessionRecord | undefined;
  /** The screen being shown, which need not be as far as the session has got. */
  current: SessionStep;
  /** Statement period from the working session, when fresher than the record. */
  period?: { start: string; end: string } | null;
  statementName?: string | null;
  /** Navigate to a step. Only offered for steps the session has already reached. */
  onNavigate?: (step: SessionStep) => void;
  /**
   * Steps that cannot be returned to, and why.
   *
   * Rendered as plain text with the reason on hover rather than as a button
   * that quietly does nothing — a control that looks live and is not is worse
   * than one that is plainly unavailable.
   */
  blockedSteps?: Partial<Record<SessionStep, string>>;
};

export function SessionHeader({
  session,
  current,
  period,
  statementName,
  onNavigate,
  blockedSteps,
}: SessionHeaderProps) {
  const status = session?.status ?? "draft";
  const reached = reachedIndex(status);
  const currentIndex = STEPS.findIndex((step) => step.id === current);
  const outcome = outcomeLabel(status);

  const start = period?.start ?? session?.statementStart;
  const end = period?.end ?? session?.statementEnd;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/50 px-4 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-semibold">{session?.accountName ?? "Reconciliation"}</span>
        {session?.tag && (
          <Badge variant="outline" className="text-[11px]">
            {session.tag}
          </Badge>
        )}
        {start && end && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {start} → {end}
          </span>
        )}
        {(statementName ?? session?.statementName) && (
          <span className="text-xs text-muted-foreground">
            · {statementName ?? session?.statementName}
          </span>
        )}
      </div>

      <ol
        className="ml-auto flex flex-wrap items-center gap-1"
        aria-label={`Progress: ${STEPS[currentIndex]?.label ?? ""}`}
      >
        {STEPS.map((step, index) => {
          // The step it has reached counts as done once the session is
          // finished with it — otherwise the last step never ticks.
          const done = index < reached || (index === reached && isTerminal(status));
          const isCurrent = index === currentIndex;
          // Only somewhere the session has actually been. Offering Review on a
          // session with nothing decided would lead to an empty screen.
          const blocked = blockedSteps?.[step.id];
          const reachable = Boolean(onNavigate) && index <= reached && !isCurrent && !blocked;

          const content = (
            <span
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors",
                isCurrent && "bg-accent font-medium text-accent-foreground",
                !isCurrent && done && "text-foreground",
                !isCurrent && !done && "text-muted-foreground",
                reachable && "hover:bg-accent/60"
              )}
            >
              {done && status === "failed" && index === reached ? (
                <AlertTriangle className="h-3 w-3 text-destructive" aria-hidden="true" />
              ) : done ? (
                <Check
                  className={cn(
                    "h-3 w-3",
                    status === "partial" && index === reached
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  )}
                  aria-hidden="true"
                />
              ) : (
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isCurrent ? "bg-foreground" : "bg-muted-foreground/40"
                  )}
                  aria-hidden="true"
                />
              )}
              {/* The last step says what actually happened, since "Applied"
                  would be a lie on a run that partly failed. */}
              {step.id === "applied" && outcome ? outcome : step.label}
            </span>
          );

          return (
            <li key={step.id} className="flex items-center gap-1">
              {index > 0 && (
                <span className="text-muted-foreground/40" aria-hidden="true">
                  ›
                </span>
              )}
              {reachable ? (
                <button type="button" onClick={() => onNavigate?.(step.id)}>
                  {content}
                </button>
              ) : (
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  title={blocked ?? undefined}
                  className={cn(blocked && "cursor-not-allowed opacity-60")}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
