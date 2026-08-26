import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { reconcileJobTypes } from "@/lib/automation/engine";
import { buildAutomationHealth, overallAutomationStatus } from "@/lib/automation/health";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    ensureAutomationJobTypesRegistered();
    const db = getAppDb();
    await reconcileJobTypes(db);
    const report = buildAutomationHealth(db);
    return NextResponse.json({ ...report, overall: overallAutomationStatus(report) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
