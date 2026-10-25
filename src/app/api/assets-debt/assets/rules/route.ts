import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { saveLinkRule } from "@/lib/app-db/assetLinkRuleRepository";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request) {
  try { return NextResponse.json(saveLinkRule(getAppDb(), await readJsonBody(request))); }
  catch (error) { return appDbErrorResponse(error); }
}
