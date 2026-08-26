import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { buildAutomationHealth, overallAutomationStatus } from "@/lib/automation/health";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  try {
    ensureAutomationJobTypesRegistered();
    const report = buildAutomationHealth(getAppDb());
    return NextResponse.json({ ...report, overall: overallAutomationStatus(report) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
