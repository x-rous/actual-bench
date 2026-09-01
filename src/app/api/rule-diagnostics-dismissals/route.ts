import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  createRuleDiagnosticsDismissal,
  deleteRuleDiagnosticsDismissals,
  listRuleDiagnosticsDismissals,
} from "@/lib/app-db/ruleDiagnosticsDismissalRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Dismissals are always budget-scoped: rule ids and signatures belong to one
 * budget file, and two budgets can hold rules that look identical. A decision
 * in one must never silence a genuine finding in another.
 */
function budgetSyncId(request: Request): string | null {
  const value = new URL(request.url).searchParams.get("budgetSyncId");
  return value && value.trim() ? value.trim() : null;
}

export function GET(request: Request) {
  try {
    const budget = budgetSyncId(request);
    if (!budget) {
      return NextResponse.json({ error: "budgetSyncId is required" }, { status: 400 });
    }
    return NextResponse.json({
      dismissals: listRuleDiagnosticsDismissals(getAppDb(), budget),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const dismissal = createRuleDiagnosticsDismissal(getAppDb(), body);
    return NextResponse.json({ dismissal }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/**
 * Garbage collection: the ids of records whose rules no longer exist by either
 * identity, worked out client-side after a scan (see `lib/dismissals.ts`) and
 * sent here as one call rather than one request per stale row.
 */
export async function DELETE(request: Request) {
  try {
    const budget = budgetSyncId(request);
    if (!budget) {
      return NextResponse.json({ error: "budgetSyncId is required" }, { status: 400 });
    }
    const body = await readJsonBody(request);
    const raw = (body as { ids?: unknown })?.ids;
    if (!Array.isArray(raw)) {
      return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
    }
    const ids = raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    const removed = deleteRuleDiagnosticsDismissals(getAppDb(), ids, budget);
    return NextResponse.json({ removed });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
