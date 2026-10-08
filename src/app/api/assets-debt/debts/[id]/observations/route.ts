import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { assetsDebtErrorResponse, observationRequestSchema, parseBody } from "@/lib/assets-debt/api/schemas";
import { currentDebtObservations, debtObservationHistory, recordManualDebtObservation } from "@/lib/assets-debt/services/observationService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ observations: currentDebtObservations(getAppDb(), id), history: debtObservationHistory(getAppDb(), id) });
  } catch (error) { return assetsDebtErrorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = parseBody(observationRequestSchema, await readJsonBody(request));
    const observation = recordManualDebtObservation(getAppDb(), { debtId: id, ...body }, new Date().toISOString());
    return NextResponse.json({ observation }, { status: 201 });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
