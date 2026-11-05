import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { deleteCashBufferScenario, listCashBufferScenarios, saveCashBufferScenario } from "@/lib/app-db/cashBufferScenarioRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Cash buffer scenarios are Bench metadata scoped to one budget; nothing is read from or written to Actual here. */
export function GET(request: Request) {
  try {
    const budget = new URL(request.url).searchParams.get("budgetSyncId")?.trim();
    if (!budget) return NextResponse.json({ error: "budgetSyncId is required" }, { status: 400 });
    return NextResponse.json({ scenarios: listCashBufferScenarios(getAppDb(), budget) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** Saves one scenario (new when it has no id) and returns the budget's full list. */
export async function PUT(request: Request) {
  try {
    return NextResponse.json({ scenarios: saveCashBufferScenario(getAppDb(), await readJsonBody(request)) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** Removes one scenario and returns the budget's full list. */
export function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    return NextResponse.json({ scenarios: deleteCashBufferScenario(getAppDb(), params.get("budgetSyncId") ?? "", params.get("id") ?? "") });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
