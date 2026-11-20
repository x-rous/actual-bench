import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { takeSafetyRecoveryPoint, type SafetyPointOutcome } from "@/lib/backup/safetyPoint";
import { runBackupTask } from "@/lib/backup/tasks";
import { parkArchive, readArchiveRequest } from "@/lib/backup/uploadedArchive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Take a recovery point before something risky.
 *
 * Always answers 200 with an outcome, never an error status: the caller is
 * mid-action, and a rejected request would make "the backup did not happen"
 * indistinguishable from "your change cannot proceed". The caller decides what
 * to do about a failure — which, in the UI, is to ask.
 *
 * The body names the connection the change is being saved through, so the
 * copy is of *that* budget. A budget only the browser can export arrives as a
 * multipart archive, after a first answer of `needs-archive`. The copy is
 * taken in a worker, off the web server's thread.
 */
export async function POST(request: Request) {
  try {
    const { archive, fields } = await readArchiveRequest(request).catch(() => ({
      archive: null,
      fields: {} as Record<string, unknown>,
    }));
    const reason =
      typeof fields.reason === "string" && fields.reason ? fields.reason.slice(0, 200) : "a change in Bench";
    const connectionFingerprint =
      typeof fields.connectionFingerprint === "string" && fields.connectionFingerprint
        ? fields.connectionFingerprint
        : null;
    const force = fields.force === true || fields.force === "true";

    const parked = archive ? await parkArchive(archive) : null;
    try {
      const outcome = await runBackupTask<SafetyPointOutcome>({
        kind: "backup.safetyPoint",
        taskInput: { reason, connectionFingerprint, force, archive: parked?.parked ?? null },
        deadlineMs: 290_000,
        inThread: (signal) =>
          takeSafetyRecoveryPoint(getAppDb(), { reason, connectionFingerprint, force, budgetArchive: archive, signal }),
      });
      return NextResponse.json({
        outcome: outcome.ok ? outcome.value : ({ status: "failed", message: outcome.message } satisfies SafetyPointOutcome),
      });
    } finally {
      await parked?.release();
    }
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
