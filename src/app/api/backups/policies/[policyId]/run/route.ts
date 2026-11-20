import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { getBackupPolicy, listBackupPolicies } from "@/lib/app-db/backupRepository";
import { listAutomations } from "@/lib/app-db/automationRepository";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { startAutomationRun } from "@/lib/automation/engine";
import { reconcileBackupAutomations } from "@/lib/automation/jobs/backupReconcile";
import { BACKUP_JOB_TYPE } from "@/lib/automation/jobs/backupType";
import { runBackup } from "@/lib/backup/runBackup";
import { manualRunsInFlight, runBackupTask } from "@/lib/backup/tasks";
import { parkArchive, readArchiveRequest } from "@/lib/backup/uploadedArchive";

type RouteContext = { params: Promise<{ policyId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A large budget takes a while to export, verify and upload to two places.
export const maxDuration = 300;

/**
 * Back up now.
 *
 * Runs **through the automation engine** whenever the rule has an automation,
 * which it does unless it was created seconds ago. That is not ceremony: the
 * engine is what records a run, holds the single-run lock and updates health,
 * so a manual backup that went straight to `runBackup` finished successfully
 * and left no trace in the run history the rule links to - which is exactly
 * what someone checking "did that work?" goes looking for.
 *
 * A scheduled rule always goes through its automation (created here if the
 * reconcile has not run yet); only a manual rule is run directly.
 *
 * Two response shapes, told apart by `mode`:
 *
 *   * `"run"` (202) - the engine started the backup and it carries on in the
 *     background; the page follows it through `GET /api/automations/runs/[runId]`.
 *     Waiting for it here held the request open for as long as the backup took.
 *   * `"result"` (200, or 409 when a run is already going) - a manual rule,
 *     run in a worker (with the archive the browser exported, for a Direct
 *     budget), finishes before answering. A run that happened answers 200 whatever it concluded:
 *     a backup that failed is a result, not a transport error, and the caller
 *     needs the detail to say which destination refused it.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    ensureAutomationJobTypesRegistered();
    const { policyId } = await context.params;

    /*
     * The budget may arrive with the request.
     *
     * A direct connection's budget lives in the operator's browser, so nothing
     * on this server can fetch it. The browser exports it - the same official
     * `exportBudget` the HTTP path uses, one process closer to the data - and
     * posts the archive here as multipart, alongside the same options the JSON
     * form carries.
     */
    const upload = await readArchiveRequest(request);
    const text = (key: string): string | null => {
      const value = upload.fields[key];
      return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
    };
    const takenBefore = text("takenBefore");
    const notes = text("notes");

    const db = getAppDb();
    const policy = getBackupPolicy(db, policyId);
    if (!policy) return NextResponse.json({ error: "Backup rule not found" }, { status: 404 });

    /*
     * Only a manual rule takes its budget from the request.
     *
     * A scheduled rule runs through the automation engine, which holds the
     * single-run lock, records the run and updates health. Letting an upload
     * drive one would skip all three - and hand it a budget from whoever sent
     * the request rather than the enrolled source the rule names.
     */
    if (upload.archive && policy.scheduleKind !== "manual") {
      return NextResponse.json(
        {
          error:
            "This rule takes its budget from its own source connection, so it cannot be run from an uploaded copy.",
        },
        { status: 400 }
      );
    }

    if (policy.scheduleKind !== "manual") {
      const findAutomation = () =>
        listAutomations(db, { type: BACKUP_JOB_TYPE }).find((entry) => entry.config.data.policyId === policyId);
      let automation = findAutomation();
      // A scheduled rule without its automation yet (created a moment ago,
      // before the engine's reconcile) gets it now: a run belongs in a worker,
      // where a Direct budget can be opened, not in this request's thread.
      if (!automation) {
        reconcileBackupAutomations(db, listBackupPolicies(db));
        automation = findAutomation();
      }
      if (!automation) {
        return NextResponse.json({ error: "This rule has no automation to run it yet." }, { status: 409 });
      }

      // Through the engine, like the schedule, and without waiting for it: a
      // large backup outlasts what a reverse proxy will hold a request open
      // for (F-191). Marked manual, so the copy is kept as one taken by hand
      // instead of joining the daily series retention later prunes.
      const start = startAutomationRun(db, automation.id, {
        trigger: "manual",
        input: { version: 1, data: { manual: true, takenBefore, notes } },
      });

      if (!start.started) {
        // Already running, or the engine refused before starting - a real
        // answer, not a failure to report.
        return NextResponse.json(
          {
            mode: "result",
            result: { stored: false, verified: false, message: start.outcome.message },
            automationId: automation.id,
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { mode: "run", runId: start.runId, automationId: automation.id },
        { status: 202 }
      );
    }

    /*
     * A manual rule has no automation, so this is the only thing that stops
     * two presses running two backups at once.
     */
    const inFlight = manualRunsInFlight();
    if (inFlight.has(policyId)) {
      return NextResponse.json(
        {
          mode: "result",
          result: { stored: false, verified: false, message: "This rule is already backing up." },
          automationId: null,
        },
        { status: 409 }
      );
    }
    inFlight.add(policyId);

    const parked = upload.archive ? await parkArchive(upload.archive) : null;
    try {
      // In a worker: verifying and encrypting are synchronous and would
      // otherwise stall every other request while they ran.
      const outcome = await runBackupTask<{ stored: boolean; verified: boolean; message: string | null }>({
        kind: "backup.run",
        taskInput: { policyId, takenBefore, notes, archive: parked?.parked ?? null },
        deadlineMs: 290_000,
        inThread: async (signal) => {
          const result = await runBackup(db, policy, {
            trigger: "manual",
            tier: "manual",
            takenBefore,
            notes,
            budgetArchive: upload.archive,
            signal,
          });
          return { stored: result.stored, verified: result.verified, message: result.message ?? null };
        },
      });
      if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: outcome.status });
      return NextResponse.json({ mode: "result", result: outcome.value, automationId: null });
    } finally {
      inFlight.delete(policyId);
      await parked?.release();
    }
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
