import { NextResponse } from "next/server";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { getAppDb } from "@/lib/app-db/connection";
import { inspectArtifact } from "@/lib/backup/inspect";

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
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { artifactId } = await context.params;
    const body = (await readJsonBody(request).catch(() => ({}))) as { passphrase?: string };

    const result = await inspectArtifact(getAppDb(), artifactId, {
      passphrase: typeof body?.passphrase === "string" && body.passphrase ? body.passphrase : undefined,
    });

    return NextResponse.json({ result });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
