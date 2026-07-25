import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { deleteSavedQuery, updateSavedQuery } from "@/lib/app-db/savedQueryRepository";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const savedQuery = updateSavedQuery(getAppDb(), id, body);
    if (!savedQuery) return NextResponse.json({ error: "Saved query not found" }, { status: 404 });
    return NextResponse.json({ savedQuery });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const deleted = deleteSavedQuery(getAppDb(), id);
    if (!deleted) return NextResponse.json({ error: "Saved query not found" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
