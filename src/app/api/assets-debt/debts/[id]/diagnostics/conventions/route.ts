import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, conventionDiagnosticRequestSchema, parseBody } from "@/lib/assets-debt/api/schemas";
import { diagnoseStoredDebtConventions } from "@/lib/assets-debt/services/conventionDiagnosticService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { observationId } = parseBody(conventionDiagnosticRequestSchema, await readJsonBody(request));
    const result = diagnoseStoredDebtConventions(getAppDb(), id, observationId);
    if (!result.ok) return NextResponse.json({ blocked: result.blocked }, { status: 409 });
    return NextResponse.json({ candidates: result.candidates });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
