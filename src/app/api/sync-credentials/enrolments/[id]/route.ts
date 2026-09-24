import { NextResponse } from "next/server";
import { getEnrolment } from "@/lib/credentials/enrolments";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * How an enrolment started by `POST /api/sync-credentials` is going (RD-095
 * M4): `verifying`, then `enrolled` or `failed` with a reason. Holds no
 * secrets. An unknown id - expired, or from before a restart - is a 404, and
 * nothing was stored for it unless it had already been `enrolled`.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const enrolment = getEnrolment(id);
  if (!enrolment) {
    return NextResponse.json(
      { error: "This enrolment is no longer being tracked. Check Connections, and enrol again if it is not listed." },
      { status: 404 }
    );
  }
  return NextResponse.json(enrolment);
}
