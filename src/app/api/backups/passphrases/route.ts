import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { forgetPassphrase, listHeldPassphrases } from "@/lib/backup/passphrases";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** What Bench is still holding, and what depends on it. Never the secret. */
export async function GET() {
  try {
    return NextResponse.json({ passphrases: listHeldPassphrases(getAppDb()) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/**
 * Forget a passphrase deliberately.
 *
 * Refused while encrypted backups still depend on it unless the caller says
 * explicitly that it means to strand them. Bench will not turn someone's
 * backups into unopenable files on a single click, but it also will not refuse
 * an operator who has decided the secret must go.
 */
export async function DELETE(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { ref?: string; strandBackups?: boolean };
    const ref = typeof body?.ref === "string" ? body.ref : "";
    if (!ref) return NextResponse.json({ error: "Which passphrase?" }, { status: 400 });

    const db = getAppDb();
    const held = listHeldPassphrases(db).find((entry) => entry.ref === ref);
    if (!held) return NextResponse.json({ error: "Bench is not holding that passphrase." }, { status: 404 });

    if (held.artifactCount > 0 && body?.strandBackups !== true) {
      return NextResponse.json(
        {
          error: `${held.artifactCount} encrypted backup(s) can only be opened with this passphrase. Forgetting it makes them unrecoverable unless you have it written down.`,
          artifactCount: held.artifactCount,
        },
        { status: 409 }
      );
    }

    forgetPassphrase(db, ref);
    return NextResponse.json({ forgotten: true, strandedBackups: held.artifactCount });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
