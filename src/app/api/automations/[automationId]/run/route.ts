import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { executeAutomation } from "@/lib/automation/engine";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";

type RouteContext = { params: Promise<{ automationId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Run now. A run already in flight is refused with 409 rather than queued — the
 * user asked for a run, and silently doing nothing (or doubling up) is worse
 * than saying "it is already running".
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    ensureAutomationJobTypesRegistered();
    const { automationId } = await context.params;
    const outcome = await executeAutomation(getAppDb(), automationId, { trigger: "manual" });

    if (outcome.status === "skipped") {
      const notFound = outcome.message === "Automation not found";
      return NextResponse.json(
        { error: outcome.message ?? "The automation did not run." },
        { status: notFound ? 404 : 409 }
      );
    }

    return NextResponse.json({ outcome });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
