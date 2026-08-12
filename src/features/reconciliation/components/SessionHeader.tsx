"use client";

import { AlertTriangle, ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
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
   * Leave the feature entirely.
   *
   * Lives here rather than in the toolbar because it is the one action that
   * means the same thing on every screen. With it in the phase buttons, "back"
   * retreated one step on three screens and left the feature on the fourth, and
   * finishing meant walking backwards through screens the user was done with.
   */
  onExit?: () => void;
  /**
   * Steps that cannot be returned to, and why.
   *
   * Rendered as plain text with the reason on hover rather than as a button
   * that quietly does nothing — a control that looks live and is not is worse
   * than one that is plainly unavailable.
   */
  blockedSteps?: Partial<Record<SessionStep, string>>;
  /**
   * The phase actions for this screen — normally a `PhaseNav`.
   *
   * Carried here rather than by the page toolbar so identity, position and next
   * action share one row. As two rows, the title bar and the session bar each
   * held part of the answer to "where am I and what happens next", and the
   * pairing changed shape from phase to phase.
   */
  actions?: React.ReactNode;
};

export function SessionHeader({
  session,
  current,
  period,
  statementName,
  onNavigate,
  blockedSteps,
  onExit,
  actions,
}: SessionHeaderProps) {
  const status = session?.status ?? "draft";
  const reached = reachedIndex(status);
  const currentIndex = STEPS.findIndex((step) => step.id === current);
  const outcome = outcomeLabel(status);

  /*
   * The Import screen owns the statement's identity while you are choosing one,
   * so this header stays out of it there. Showing both is how a discarded file
   * leaves a stale name and period sitting above a screen that says "no
   * statement loaded yet", and how a re-import shows two statements at once.
   */
  const showsStatement = current !== "import";
  const start = showsStatement ? period?.start ?? session?.statementStart : null;
  const end = showsStatement ? period?.end ?? session?.statementEnd : null;
  const statement = showsStatement ? statementName ?? session?.statementName : null;

  /*
   * One row, three fixed areas: which reconciliation you are in, where you are
   * in it, and what you can do next. A grid rather than a flex row so the steps
   * stay centred whatever the account is called and however many buttons the
   * phase offers — with flex they drifted as the sides changed width, and
   * staying put is the one thing a progress indicator has to do.
   */
  return (
    <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 border-b border-border/50 px-4 py-2">
      <div className="flex min-w-0 items-center gap-x-2">
        {onExit && (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onExit}
          >
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            All reconciliations
          </Button>
        )}

        <div className="flex min-w-0 items-baseline gap-x-2">
          <span className="truncate text-sm font-semibold">
            {session?.accountName ?? "Reconciliation"}
          </span>
          {session?.tag && (
            <Badge variant="outline" className="shrink-0 text-[11px]">
              {session.tag}
            </Badge>
          )}
          {start && end && (
            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              {start} → {end}
            </span>
          )}
          {statement && (
            <span className="truncate text-xs text-muted-foreground" title={statement}>
              · {statement}
            </span>
          )}
        </div>
      </div>

      <ol
        className="flex items-center gap-1"
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
                  {/* `title` reaches a mouse and nothing else. This step is not
                      focusable, so without text in the flow a keyboard or
                      screen-reader user is told the step exists and never why
                      it cannot be returned to. */}
                  {blocked && <span className="sr-only"> - {blocked}</span>}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* The forward action stays at the far right on every phase, so "what
          happens next" is always in the same place. */}
      <div className="flex min-w-0 items-center justify-end gap-2">{actions}</div>
    </div>
  );
}
