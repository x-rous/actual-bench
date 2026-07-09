import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  createSyncMapping,
  getAllSyncMappingsForFlow,
  getSyncMappingBySource,
  listSyncMappings,
} from "@/lib/app-db/syncMappingRepository";
import type { SyncMappingInput } from "@/lib/app-db/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  try {
    const flowId = request.nextUrl.searchParams.get("flowId") ?? undefined;
    const sourceItemKey = request.nextUrl.searchParams.get("sourceItemKey") ?? undefined;

    // Single mapping lookup for apply-time revalidation.
    if (flowId && sourceItemKey) {
      return NextResponse.json({ mapping: getSyncMappingBySource(getAppDb(), flowId, sourceItemKey) });
    }
    // A flow's mappings must be returned complete: preview classification and
    // apply de-duplication rely on the full history to avoid re-creating dupes.
    if (flowId) {
      return NextResponse.json({ mappings: getAllSyncMappingsForFlow(getAppDb(), flowId) });
    }
    return NextResponse.json({ mappings: listSyncMappings(getAppDb()) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as SyncMappingInput | SyncMappingInput[];
    const db = getAppDb();
    // A batch (array) is written in ONE transaction — one commit for the whole
    // apply run instead of an HTTP round-trip + commit per mapping.
    if (Array.isArray(body)) {
      const createAll = db.transaction(() => body.map((input) => createSyncMapping(db, input)));
      return NextResponse.json({ mappings: createAll() }, { status: 201 });
    }
    const mapping = createSyncMapping(db, body);
    return NextResponse.json({ mapping }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
