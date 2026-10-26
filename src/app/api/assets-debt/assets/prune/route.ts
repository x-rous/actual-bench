import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { pruneStaleAssetMetadata } from "@/lib/app-db/assetMaintenanceRepository";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Drops saved links to transactions Actual no longer has, from evidence of complete reads. */
export async function POST(request: Request) {
  try { return NextResponse.json(pruneStaleAssetMetadata(getAppDb(), await readJsonBody(request))); }
  catch (error) { return appDbErrorResponse(error); }
}
