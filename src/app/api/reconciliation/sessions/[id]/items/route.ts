import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  getReconciliationSession,
  listReconciliationItems,
  replaceReconciliationItems,
  type ItemInput,
} from "@/lib/app-db/reconciliationRepository";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new AppDbValidationError("Expected an array of ids");
  return value.filter((id): id is string => typeof id === "string");
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ items: listReconciliationItems(getAppDb(), id) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/**
 * Replaces the session's items wholesale — the write behind a (re-)match.
 *
 * Re-running the matcher regenerates the whole graph, so a partial update would
 * leave items from the previous run stranded.
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getAppDb();
    if (!getReconciliationSession(db, id)) {
      return NextResponse.json({ error: "Reconciliation session not found" }, { status: 404 });
    }

    const body = await readJsonBody(request);
    if (!isRecord(body) || !Array.isArray(body.items)) {
      throw new AppDbValidationError("Request body must contain an items array");
    }

    const items: ItemInput[] = body.items.map((item, index) => {
      if (!isRecord(item)) throw new AppDbValidationError(`Item ${index} must be an object`);
      return {
        id: typeof item.id === "string" ? item.id : undefined,
        statementRowIds: stringArray(item.statementRowIds),
        actualTransactionIds: stringArray(item.actualTransactionIds),
        disposition: String(item.disposition ?? ""),
        reasonCode: typeof item.reasonCode === "string" ? item.reasonCode : null,
        match: item.match,
        guards: item.guards,
        actualSnapshot: item.actualSnapshot,
        stagedChanges: item.stagedChanges,
      };
    });

    const count = replaceReconciliationItems(db, id, items);
    return NextResponse.json({ count });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
