import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { saveDepreciationSettings } from "@/lib/app-db/assetDepreciationRepository";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request) {
  try { return NextResponse.json(saveDepreciationSettings(getAppDb(), await readJsonBody(request))); }
  catch (error) { return appDbErrorResponse(error); }
}
