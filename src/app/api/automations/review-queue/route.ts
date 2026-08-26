import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { buildReviewQueue } from "@/lib/automation/reviewQueue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  try {
    ensureAutomationJobTypesRegistered();
    return NextResponse.json({ entries: buildReviewQueue(getAppDb()) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
