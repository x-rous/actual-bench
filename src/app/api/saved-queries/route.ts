import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  createSavedQuery,
  listSavedQueries,
} from "@/lib/app-db/savedQueryRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  try {
    return NextResponse.json({ savedQueries: listSavedQueries(getAppDb()) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const savedQuery = createSavedQuery(getAppDb(), body);
    return NextResponse.json({ savedQuery }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
