import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { reconcileJobTypes } from "@/lib/automation/engine";
import { buildAutomationHealth, overallAutomationStatus } from "@/lib/automation/health";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { getAutomationExecutor } from "@/lib/automation/executor";
import { workerSupervisorStatus } from "@/lib/workers/supervisor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    ensureAutomationJobTypesRegistered();
    const db = getAppDb();
    await reconcileJobTypes(db);
    const report = buildAutomationHealth(db);
    return NextResponse.json({
      ...report,
      overall: overallAutomationStatus(report),
      // Where jobs run, and whether that is working (RD-095).
      workers: { executor: getAutomationExecutor().name, ...workerSupervisorStatus() },
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
