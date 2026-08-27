import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { takeSafetyRecoveryPoint } from "@/lib/backup/safetyPoint";

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
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request).catch(() => ({}))) as {
      reason?: string;
      force?: boolean;
    };

    const outcome = await takeSafetyRecoveryPoint(getAppDb(), {
      reason: typeof body?.reason === "string" && body.reason ? body.reason.slice(0, 200) : "a change in Bench",
      force: body?.force === true,
    });

    return NextResponse.json({ outcome });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
