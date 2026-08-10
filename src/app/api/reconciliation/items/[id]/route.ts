import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  updateReconciliationItem,
  type ItemInput,
} from "@/lib/app-db/reconciliationRepository";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Patches one item — the write behind every user decision in the workbench:
 * changing a disposition, accepting a manual match, editing a staged field.
 *
 * Staging only. Nothing here touches the budget.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    if (!isRecord(body)) throw new AppDbValidationError("Request body must be an object");

    const patch: Partial<ItemInput> = {};
    if ("statementRowIds" in body) {
      patch.statementRowIds = (body.statementRowIds as unknown[]).filter(
        (value): value is string => typeof value === "string"
      );
    }
    if ("actualTransactionIds" in body) {
      patch.actualTransactionIds = (body.actualTransactionIds as unknown[]).filter(
        (value): value is string => typeof value === "string"
      );
    }
    if ("disposition" in body) patch.disposition = String(body.disposition ?? "");
    if ("reasonCode" in body) patch.reasonCode = body.reasonCode as string | null;
    if ("match" in body) patch.match = body.match;
    if ("guards" in body) patch.guards = body.guards;
    if ("actualSnapshot" in body) patch.actualSnapshot = body.actualSnapshot;
    if ("stagedChanges" in body) patch.stagedChanges = body.stagedChanges;

    const item = updateReconciliationItem(getAppDb(), id, patch);
    if (!item) {
      return NextResponse.json({ error: "Reconciliation item not found" }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
