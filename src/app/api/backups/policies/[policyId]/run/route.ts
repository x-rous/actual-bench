import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { AppDbValidationError } from "@/lib/app-db/errors";
import {
  BodyTooLargeError,
  MissingBodyError,
  declaredLengthExceeds,
  readBoundedBody,
} from "@/lib/http/boundedBody";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { getBackupPolicy } from "@/lib/app-db/backupRepository";
import { listAutomations } from "@/lib/app-db/automationRepository";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { executeAutomation } from "@/lib/automation/engine";
import { BACKUP_JOB_TYPE } from "@/lib/automation/jobs/backupType";
import { runBackup } from "@/lib/backup/runBackup";

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
 * The direct path remains as a fallback for a rule with no automation yet.
 *
 * A run that happened answers 200 whatever it concluded: a backup that failed
 * is a result, not a transport error, and the caller needs the detail to say
 * which destination refused it.
 */
type ManualRunOptions = { takenBefore?: string; notes?: string };

/**
 * How big an uploaded budget archive may be.
 *
 * A budget zip is normally a few megabytes; a long history with many
 * attachments is larger. The cap exists so a request cannot exhaust the
 * process's memory, and it is checked against the part's own size rather than
 * trusting a Content-Length the client controls.
 */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/**
 * Reads the request either way.
 *
 * `multipart/form-data` carries the archive a browser exported for a direct
 * connection; anything else is the plain JSON body a server-sourced run sends.
 * Returning both shapes from one function keeps a single "Back up now" endpoint,
 * so the caller does not have to know which kind of rule it is pressing.
 */
async function readUploadedArchive(request: Request): Promise<{
  archive: { bytes: Buffer; budgetId: string | null; budgetName: string | null } | null;
  options: ManualRunOptions;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    /*
     * An absent body still means "back up now with no options", which is what
     * the button sends. Malformed JSON is a different thing and is reported:
     * swallowing it answered 200 for a request the caller got wrong.
     */
    const raw = await request.text();
    if (!raw.trim()) return { archive: null, options: {} };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AppDbValidationError("Invalid JSON body");
    }
    return { archive: null, options: (parsed ?? {}) as ManualRunOptions };
  }

  /*
   * Bounded before the body is parsed, not only after.
   *
   * `formData()` buffers the whole request first, so a size check that runs
   * after it has already cost the memory it was meant to protect. A declared
   * Content-Length is only the client's claim and may be absent altogether on a
   * chunked request, so it is used as a cheap early refusal and the body is then
   * read through a counter that stops at the same limit either way.
   */
  if (declaredLengthExceeds(request, MAX_UPLOAD_BYTES)) {
    throw new AppDbValidationError(new BodyTooLargeError(MAX_UPLOAD_BYTES).message);
  }

  let body: ArrayBuffer;
  try {
    body = await readBoundedBody(request, MAX_UPLOAD_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError || error instanceof MissingBodyError) {
      throw new AppDbValidationError(error.message);
    }
    throw error;
  }

  const form = await new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body,
  }).formData();
  const file = form.get("archive");
  if (!(file instanceof File)) {
    throw new AppDbValidationError("The upload carried no budget archive.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AppDbValidationError(
      `The exported budget is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB this endpoint accepts.`
    );
  }
  if (file.size === 0) {
    throw new AppDbValidationError("The exported budget was empty, so there is nothing to store.");
  }

  const text = (key: string): string | null => {
    const value = form.get(key);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };

  return {
    archive: {
      bytes: Buffer.from(await file.arrayBuffer()),
      budgetId: text("budgetId"),
      budgetName: text("budgetName"),
    },
    options: {
      takenBefore: text("takenBefore") ?? undefined,
      notes: text("notes") ?? undefined,
    },
  };
}

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
    const upload = await readUploadedArchive(request);
    const options = upload.options;

    const db = getAppDb();
    const policy = getBackupPolicy(db, policyId);
    if (!policy) return NextResponse.json({ error: "Backup rule not found" }, { status: 404 });

    if (upload.archive) {
      /*
       * Only a manual rule takes its budget from the request.
       *
       * A scheduled rule runs through the automation engine, which holds the
       * single-run lock, records the run and updates health. Letting an upload
       * drive one would skip all three - and hand it a budget from whoever sent
       * the request rather than the enrolled source the rule names.
       */
      if (policy.scheduleKind !== "manual") {
        return NextResponse.json(
          {
            error:
              "This rule takes its budget from its own source connection, so it cannot be run from an uploaded copy.",
          },
          { status: 400 }
        );
      }

      const result = await runBackup(db, policy, {
        trigger: "manual",
        tier: "manual",
        takenBefore: options.takenBefore ?? null,
        notes: options.notes ?? null,
        budgetArchive: upload.archive,
      });
      return NextResponse.json({
        result: {
          stored: result.stored,
          verified: result.verified,
          message: result.message ?? null,
        },
        automationId: null,
      });
    }

    const automation = listAutomations(db, { type: BACKUP_JOB_TYPE }).find(
      (entry) => entry.config.data.policyId === policyId
    );

    // A manual rule has no automation, and one left over from a rule whose
    // source changed is disabled - running through it would refuse.
    if (automation && policy.scheduleKind !== "manual") {
      const outcome = await executeAutomation(db, automation.id, { trigger: "manual" });

      if (outcome.status === "skipped") {
        // Already running, or the engine refused before starting - a real
        // answer, not a failure to report.
        return NextResponse.json(
          { result: { stored: false, verified: false, message: outcome.message }, automationId: automation.id },
          { status: 409 }
        );
      }

      const [run] = listAutomationRuns(db, { automationId: automation.id, limit: 1 });
      const data = (run?.result?.data ?? {}) as { stored?: boolean; verified?: boolean; message?: string | null };

      return NextResponse.json({
        result: {
          stored: data.stored ?? outcome.status === "succeeded",
          verified: data.verified ?? outcome.status === "succeeded",
          message: data.message ?? run?.rollup?.message ?? outcome.message ?? null,
        },
        automationId: automation.id,
        runId: outcome.runId,
      });
    }

    const result = await runBackup(db, policy, {
      trigger: "manual",
      tier: "manual",
      takenBefore: options.takenBefore ?? null,
      notes: options.notes ?? null,
    });

    return NextResponse.json({
      result: { stored: result.stored, verified: result.verified, message: result.message ?? null },
      automationId: null,
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
