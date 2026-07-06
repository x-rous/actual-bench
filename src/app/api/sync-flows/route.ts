import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { createSyncFlow, listSyncFlows } from "@/lib/app-db/syncFlowRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  try {
    return NextResponse.json({ flows: listSyncFlows(getAppDb()) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const flow = createSyncFlow(getAppDb(), body);
    return NextResponse.json({ flow }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
