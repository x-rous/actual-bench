import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  listReconciliationProfiles,
  saveReconciliationProfile,
} from "@/lib/app-db/reconciliationRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Import profiles hold the column mapping *and* the user's match configuration
 * — including which Actual field the statement text is compared against, which
 * is a property of how that account's transactions are created.
 */
export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const budgetSyncId = url.searchParams.get("budgetSyncId");
    if (!budgetSyncId) {
      throw new AppDbValidationError('Query parameter "budgetSyncId" is required');
    }
    const accountId = url.searchParams.get("accountId") ?? undefined;
    return NextResponse.json({
      profiles: listReconciliationProfiles(getAppDb(), budgetSyncId, accountId),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** Upserts by (budget, account, name) — re-saving means "keep my latest mapping". */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body)) throw new AppDbValidationError("Request body must be an object");

    const profile = saveReconciliationProfile(getAppDb(), {
      budgetSyncId: String(body.budgetSyncId ?? ""),
      accountId: String(body.accountId ?? ""),
      name: String(body.name ?? ""),
      mapping: body.mapping,
      matchConfig: body.matchConfig,
    });

    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
