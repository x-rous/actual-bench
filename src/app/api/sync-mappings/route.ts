import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  createSyncMapping,
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
    return NextResponse.json({ mappings: listSyncMappings(getAppDb(), { flowId, limit: 500 }) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as SyncMappingInput;
    const mapping = createSyncMapping(getAppDb(), body);
    return NextResponse.json({ mapping }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
