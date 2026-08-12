import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  getReconciliationSession,
  listStatementRows,
  replaceStatementRows,
  type StatementRowInput,
} from "@/lib/app-db/reconciliationRepository";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ statementRows: listStatementRows(getAppDb(), id) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/**
 * Replaces the session's statement rows wholesale.
 *
 * PUT rather than POST because this is idempotent by design: re-importing a
 * statement into an existing session must not append to the previous parse.
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getAppDb();
    if (!getReconciliationSession(db, id)) {
      return NextResponse.json({ error: "Reconciliation session not found" }, { status: 404 });
    }

    const body = await readJsonBody(request);
    if (!isRecord(body) || !Array.isArray(body.statementRows)) {
      throw new AppDbValidationError("Request body must contain a statementRows array");
    }

    const rows: StatementRowInput[] = body.statementRows.map((row, index) => {
      if (!isRecord(row)) {
        throw new AppDbValidationError(`Statement row ${index} must be an object`);
      }
      return {
        id: String(row.id ?? ""),
        sourceRowNumber: Number(row.sourceRowNumber ?? index + 1),
        postedDate: String(row.postedDate ?? ""),
        amount: Number(row.amount),
        importedPayee: String(row.importedPayee ?? ""),
        bankNotes: typeof row.bankNotes === "string" ? row.bankNotes : null,
        bankReference: typeof row.bankReference === "string" ? row.bankReference : null,
        externalId: typeof row.externalId === "string" ? row.externalId : null,
        transactionDate: typeof row.transactionDate === "string" ? row.transactionDate : null,
        originalAmount:
          typeof row.originalAmount === "number" ? row.originalAmount : null,
        originalCurrency:
          typeof row.originalCurrency === "string" ? row.originalCurrency : null,
        fingerprint: String(row.fingerprint ?? ""),
        raw: row.raw ?? null,
      };
    });

    const count = replaceStatementRows(db, id, rows);
    return NextResponse.json({ count });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
