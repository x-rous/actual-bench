import { NextResponse } from "next/server";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { getAppDb } from "@/lib/app-db/connection";
import { compareArtifact, type BackupComparison } from "@/lib/backup/compare";
import { runBackupTask } from "@/lib/backup/tasks";
import { prepareTypedPassphrase, typedPassphraseFrom } from "@/lib/backup/typedPassphrase";

type RouteContext = { params: Promise<{ artifactId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

/**
 * Compare one budget backup with the budget as it is now: accounts added or
 * removed, and each account's transactions and balance then and now. The
 * live budget is read through its enrolment, in a worker (a Direct budget
 * can only be opened there). Read-only on both sides.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { artifactId } = await context.params;
    const passphrase = typedPassphraseFrom(await readJsonBody(request).catch(() => ({})));
    const { sealed, runHere } = prepareTypedPassphrase(passphrase);
    if (runHere) {
      return NextResponse.json({ result: await compareArtifact(getAppDb(), artifactId, { passphrase }) });
    }

    const outcome = await runBackupTask<BackupComparison>({
      kind: "backup.compare",
      taskInput: { artifactId, passphrase: sealed },
      deadlineMs: 170_000,
      inThread: (signal) => compareArtifact(getAppDb(), artifactId, { passphrase, signal }),
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: outcome.status });
    return NextResponse.json({ result: outcome.value });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
