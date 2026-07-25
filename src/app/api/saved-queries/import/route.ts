import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { importSavedQueries } from "@/lib/app-db/savedQueryRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One-time migration endpoint (RD-064 / PR-029): accepts the user's legacy
 * localStorage saved queries as `{ queries: [...] }` and inserts the ones not
 * already present, deduping by name+query so re-running is harmless.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const result = importSavedQueries(getAppDb(), body);
    return NextResponse.json(result);
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
