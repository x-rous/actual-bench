import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  createReconciliationSession,
  listReconciliationSessions,
} from "@/lib/app-db/reconciliationRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredParam(value: string | null, name: string): string {
  if (!value) throw new AppDbValidationError(`Query parameter "${name}" is required`);
  return value;
}

/**
 * Sessions are scoped by budget, so the caller must say which budget it means.
 * The app DB is global to the Actual Bench instance and may hold sessions for
 * several budgets at once.
 */
export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const budgetSyncId = requiredParam(url.searchParams.get("budgetSyncId"), "budgetSyncId");
    return NextResponse.json({ sessions: listReconciliationSessions(getAppDb(), budgetSyncId) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body)) throw new AppDbValidationError("Request body must be an object");

    const session = createReconciliationSession(getAppDb(), {
      budgetSyncId: String(body.budgetSyncId ?? ""),
      accountId: String(body.accountId ?? ""),
      accountName: typeof body.accountName === "string" ? body.accountName : null,
      profileId: typeof body.profileId === "string" ? body.profileId : null,
      statementName: typeof body.statementName === "string" ? body.statementName : null,
      tag: typeof body.tag === "string" ? body.tag : null,
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
