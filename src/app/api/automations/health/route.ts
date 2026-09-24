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
    const executor = getAutomationExecutor().name;
    const workers = { executor, ...workerSupervisorStatus() };
    // Workers that cannot start stop every automation, whatever each one's
    // own history says; the overall status must not read healthy over that.
    const workersDown = executor === "worker" && workers.preflight.status === "failed";
    return NextResponse.json({
      ...report,
      overall: workersDown ? "failing" : overallAutomationStatus(report),
      // Where jobs run, and whether that is working (RD-095).
      workers,
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
