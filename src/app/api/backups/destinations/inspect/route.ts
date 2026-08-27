import { NextResponse } from "next/server";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { inspectLocalPath } from "@/lib/backup/destinations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Check a folder path while the user is still typing it, rather than at 3am
 * when the backup runs. Creates the directory if it is missing, since asking
 * someone to mkdir by hand inside a container is a good way to end up with a
 * destination that never gets configured.
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { path?: unknown };
    const path = typeof body?.path === "string" ? body.path : "";
    return NextResponse.json(await inspectLocalPath(path));
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
