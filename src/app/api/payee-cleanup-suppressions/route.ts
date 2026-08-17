import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  clearPayeeCleanupSuppressions,
  createPayeeCleanupSuppression,
  listPayeeCleanupSuppressions,
} from "@/lib/app-db/payeeCleanupSuppressionRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Payee Cleanup suppressions are always budget-scoped: payee ids and names
 * belong to one budget file, so a decision made in one must never silence a
 * suggestion in another.
 */
function budgetSyncId(request: Request): string | null {
  const value = new URL(request.url).searchParams.get("budgetSyncId");
  return value && value.trim() ? value.trim() : null;
}

export function GET(request: Request) {
  try {
    const budget = budgetSyncId(request);
    if (!budget) {
      return NextResponse.json(
        { error: "budgetSyncId is required" },
        { status: 400 }
      );
    }
    return NextResponse.json({
      suppressions: listPayeeCleanupSuppressions(getAppDb(), budget),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const suppression = createPayeeCleanupSuppression(getAppDb(), body);
    return NextResponse.json({ suppression }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** "Start over": clears every decision for one budget. */
export function DELETE(request: Request) {
  try {
    const budget = budgetSyncId(request);
    if (!budget) {
      return NextResponse.json(
        { error: "budgetSyncId is required" },
        { status: 400 }
      );
    }
    const removed = clearPayeeCleanupSuppressions(getAppDb(), budget);
    return NextResponse.json({ removed });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
