import { NextResponse } from "next/server";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { getAppDb } from "@/lib/app-db/connection";
import { inspectArtifact, type InspectionResult } from "@/lib/backup/inspect";
import { runBackupTask } from "@/lib/backup/tasks";
import { getAutomationExecutor } from "@/lib/automation/executor";
import { sealSecret, type SealedSecret } from "@/lib/sync/vault";

type RouteContext = { params: Promise<{ artifactId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Open a backup and report what is inside it, without restoring anything.
 *
 * The question in front of a list of backups is rarely "is this file intact"
 * but "is this the one" — does it still have the account, does it stop before
 * the bad import. Answering it by restoring would mean creating a budget,
 * looking, and cleaning up.
 *
 * Opened in a worker, so a large copy does not stall the server. A passphrase
 * typed for this one look travels to the worker sealed with the vault key,
 * like an enrolment check's secret; with the vault locked there is nothing to
 * seal it with, and that one case is opened here instead.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { artifactId } = await context.params;
    const body = (await readJsonBody(request).catch(() => ({}))) as { passphrase?: string };
    const passphrase = typeof body?.passphrase === "string" && body.passphrase ? body.passphrase : undefined;

    let sealed: SealedSecret | null = null;
    let sealable = true;
    if (passphrase) {
      try {
        sealed = sealSecret(passphrase);
      } catch {
        sealable = false;
      }
    }

    if (!sealable && getAutomationExecutor().name === "worker") {
      const result = await inspectArtifact(getAppDb(), artifactId, { passphrase });
      return NextResponse.json({ result });
    }

    const outcome = await runBackupTask<InspectionResult>({
      kind: "backup.inspect",
      taskInput: { artifactId, passphrase: sealed },
      deadlineMs: 110_000,
      inThread: (signal) => inspectArtifact(getAppDb(), artifactId, { passphrase, signal }),
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: outcome.status });
    return NextResponse.json({ result: outcome.value });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
