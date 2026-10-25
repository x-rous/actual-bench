import { saveAssetCashflows } from "@/lib/app-db/assetCashflowRepository";
import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readRegistry, saveAsset, saveBookMetadata } from "@/lib/app-db/assetRepository";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  try { return NextResponse.json(readRegistry(getAppDb(), new URL(request.url).searchParams.get("budgetSyncId") ?? "")); }
  catch (error) { return appDbErrorResponse(error); }
}
export async function POST(request: Request) {
  try { return NextResponse.json(saveAsset(getAppDb(), await readJsonBody(request))); }
  catch (error) { return appDbErrorResponse(error); }
}
export async function PATCH(request: Request) {
  try { return NextResponse.json(saveBookMetadata(getAppDb(), await readJsonBody(request))); }
  catch (error) { return appDbErrorResponse(error); }
}

export async function PUT(request: Request) {
  try { return NextResponse.json(saveAssetCashflows(getAppDb(), await readJsonBody(request))); }
  catch (error) { return appDbErrorResponse(error); }
}
