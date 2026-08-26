import { listAutomations } from "@/lib/app-db/automationRepository";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";
import { getAutomationJobType } from "./registry";
import type { SqliteDatabase } from "@/lib/app-db/types";

/**
 * The shared review queue (RD-079 / PR-043d).
 *
 * One list across job types of "an automation ran and left something for a
 * person to decide". Two deliberate boundaries:
 *
 *   * **Types that declare no classification contribute nothing** — they are
 *     absent from the queue, not shown with a zero. A bank sync triggers
 *     Actual's own import and constructs nothing reviewable; a row saying
 *     "0 items to review" would imply it might one day have some.
 *
 *   * **The queue points at the type's own review surface rather than
 *     reimplementing it.** Budget File Sync already has a preview workspace
 *     that knows how to show a duplicate or a changed source row; a second,
 *     shallower copy of that inside Automations would be a worse version of a
 *     screen that already exists, and would drift from it.
 */

export type ReviewQueueEntry = {
  automationId: string;
  automationName: string;
  type: string;
  typeLabel: string;
  /** What kinds of thing this type can leave for review. */
  subjects: readonly string[];
  /** Items the last run left needing a decision, when the type reports them. */
  pendingCount: number;
  lastRunAt: string | null;
  /** Where the user goes to actually decide. */
  href: string;
  summary: string;
};

/** Where each job type's own review surface lives. */
const REVIEW_HREF: Record<string, (config: Record<string, unknown>) => string> = {
  "budget-file-sync": () => "/sync",
};

function pendingFromResult(result: Record<string, unknown> | undefined): number {
  if (!result) return 0;
  const blocked = Number(result.blocked ?? 0);
  return Number.isFinite(blocked) ? blocked : 0;
}

export function buildReviewQueue(db: SqliteDatabase): ReviewQueueEntry[] {
  const entries: ReviewQueueEntry[] = [];

  for (const automation of listAutomations(db)) {
    const jobType = getAutomationJobType(automation.type);
    // No registered type, or a type that constructs nothing: not in the queue.
    if (!jobType?.classification) continue;

    const [lastRun] = listAutomationRuns(db, { automationId: automation.id, limit: 1 });
    const pendingCount = pendingFromResult(lastRun?.result?.data as Record<string, unknown> | undefined);
    if (pendingCount === 0) continue;

    entries.push({
      automationId: automation.id,
      automationName: automation.name,
      type: automation.type,
      typeLabel: jobType.label,
      subjects: jobType.classification.reviewSubjects,
      pendingCount,
      lastRunAt: automation.lastRunAt,
      href: REVIEW_HREF[automation.type]?.(automation.config.data) ?? "/automations",
      summary: `${pendingCount} item${pendingCount === 1 ? "" : "s"} from the last run need a decision.`,
    });
  }

  return entries.sort((a, b) => b.pendingCount - a.pendingCount);
}
