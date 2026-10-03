import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { readJsonBody } from "@/lib/app-db/routeResponses";
import { anchorRequestSchema, assetsDebtErrorResponse, parseBody } from "@/lib/assets-debt/api/schemas";
import { anchorDebtAtObservation, getEffectiveDebtAnchor, listDebtAnchors } from "@/lib/assets-debt/services/anchorService";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: Context) {
  try { const { id } = await context.params; return NextResponse.json({ effective: getEffectiveDebtAnchor(getAppDb(), id), anchors: listDebtAnchors(getAppDb(), id) }); }
  catch (error) { return assetsDebtErrorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = parseBody(anchorRequestSchema, await readJsonBody(request));
    return NextResponse.json({ anchor: anchorDebtAtObservation(getAppDb(), id, body.observationId, body.carriedRemainderDecimal) }, { status: 201 });
  } catch (error) { return assetsDebtErrorResponse(error); }
}
