import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { AppDbValidationError } from "@/lib/app-db/errors";
import {
  createSavedTransform,
  deleteSavedTransform,
  listSavedTransforms,
  reorderSavedTransforms,
  updateSavedTransform,
} from "@/lib/app-db/reconciliationTransformRepository";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function budgetFrom(url: URL): string {
  const budgetSyncId = url.searchParams.get("budgetSyncId");
  if (!budgetSyncId) throw new AppDbValidationError('Query parameter "budgetSyncId" is required');
  return budgetSyncId;
}

/** The budget's saved transforms, in run order. */
export function GET(request: Request) {
  try {
    return NextResponse.json({ transforms: listSavedTransforms(getAppDb(), budgetFrom(new URL(request.url))) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body)) throw new AppDbValidationError("Request body must be an object");
    const transform = createSavedTransform(getAppDb(), {
      budgetSyncId: String(body.budgetSyncId ?? ""),
      name: body.name,
      rule: body.rule,
    } as { budgetSyncId: string; name: string; rule: unknown });
    return NextResponse.json({ transform }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** `update` renames or replaces a rule; `reorder` sets the run order. */
export async function PATCH(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body)) throw new AppDbValidationError("Request body must be an object");
    const budgetSyncId = String(body.budgetSyncId ?? "");

    if (body.action === "reorder") {
      return NextResponse.json({ transforms: reorderSavedTransforms(getAppDb(), { budgetSyncId, ids: body.ids }) });
    }
    if (body.action === "update") {
      const transform = updateSavedTransform(getAppDb(), {
        budgetSyncId,
        id: String(body.id ?? ""),
        ...("name" in body ? { name: body.name } : {}),
        ...("rule" in body ? { rule: body.rule } : {}),
      });
      if (!transform) return NextResponse.json({ error: "Saved transform not found" }, { status: 404 });
      return NextResponse.json({ transform });
    }
    throw new AppDbValidationError("Unknown saved transform action");
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) throw new AppDbValidationError('Query parameter "id" is required');
    if (!deleteSavedTransform(getAppDb(), budgetFrom(url), id)) {
      return NextResponse.json({ error: "Saved transform not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
