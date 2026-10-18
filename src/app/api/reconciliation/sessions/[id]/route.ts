import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { AppDbValidationError } from "@/lib/app-db/errors";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  claimReconciliationApply,
  completeReconciliationWithoutWrites,
  finishReconciliationApply,
  saveReconciliationWork,
  deleteReconciliationSession,
  getReconciliationSession,
  listReconciliationItems,
  listStatementRows,
  updateReconciliationSession,
  type ReconciliationSessionStatus,
  type ReconciliationStatementFormat,
  type UpdateSessionInput,
} from "@/lib/app-db/reconciliationRepository";

import { reconciliationItems, reconciliationObject, reconciliationPatch, reconciliationRows } from "@/lib/app-db/reconciliationPayload";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A fresh 404 per call.
 *
 * A `Response` body is a one-shot stream: once Next.js has sent it, it is
 * consumed and locked, so a module-level instance shared by these handlers
 * would fail on the second miss with `ReadableStream is locked`.
 */
function notFound() {
  return NextResponse.json({ error: "Reconciliation session not found" }, { status: 404 });
}

/**
 * Returns the session and, unless `?shallow=1`, its statement rows and items.
 *
 * The workbench needs all three to render, and fetching them in one round trip
 * keeps a resumed session from flashing through partial states.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getAppDb();
    const session = getReconciliationSession(db, id);
    if (!session) return notFound();

    if (new URL(request.url).searchParams.get("shallow") === "1") {
      return NextResponse.json({ session });
    }

    return NextResponse.json({
      session,
      statementRows: listStatementRows(db, id),
      items: listReconciliationItems(db, id),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    if (!isRecord(body)) throw new AppDbValidationError("Request body must be an object");

    // Only known keys are forwarded; the repository validates the status value.
    const patch: UpdateSessionInput = {};
    if ("status" in body) patch.status = body.status as ReconciliationSessionStatus;
    if ("accountName" in body) patch.accountName = body.accountName as string | null;
    if ("profileId" in body) patch.profileId = body.profileId as string | null;
    if ("statementName" in body) patch.statementName = body.statementName as string | null;
    if ("tag" in body) patch.tag = body.tag as string | null;
    if ("statementStart" in body) patch.statementStart = body.statementStart as string | null;
    if ("statementEnd" in body) patch.statementEnd = body.statementEnd as string | null;
    if ("candidateStart" in body) patch.candidateStart = body.candidateStart as string | null;
    if ("candidateEnd" in body) patch.candidateEnd = body.candidateEnd as string | null;
    if ("statementFingerprint" in body) {
      patch.statementFingerprint = body.statementFingerprint as string | null;
    }
    if ("statementFormat" in body) {
      patch.statementFormat = body.statementFormat as ReconciliationStatementFormat | null;
    }
    if ("matchConfig" in body) patch.matchConfig = body.matchConfig;
    if ("totals" in body) patch.totals = body.totals;
    if ("applyResults" in body) patch.applyResults = body.applyResults;
    if ("applyConfig" in body) patch.applyConfig = body.applyConfig;
    if ("appliedAt" in body) patch.appliedAt = body.appliedAt as string | null;

    const session = updateReconciliationSession(getAppDb(), id, patch);
    if (!session) return notFound();
    return NextResponse.json({ session });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    // Cascades to the session's statement rows and items.
    if (!deleteReconciliationSession(getAppDb(), id)) return notFound();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** Atomic session edits and Apply lifecycle; no Actual requests are made here. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getAppDb();
    if (!getReconciliationSession(db, id)) return notFound();
    const body = reconciliationObject(await readJsonBody(request));
    const patches = body.itemPatches === undefined ? undefined : reconciliationItems(body.itemPatches)
      .map(({ id: itemId, ...patch }) => ({ id: itemId!, patch }));
    if (body.action === "claim") {
      if (typeof body.expected !== "string") throw new AppDbValidationError("Expected reviewed decisions");
      return NextResponse.json({ session: claimReconciliationApply(db, id, body.expected, patches) });
    }
    if (body.action === "complete") {
      if (typeof body.expected !== "string") throw new AppDbValidationError("Expected reviewed decisions");
      return NextResponse.json({ session: completeReconciliationWithoutWrites(db, id, body.expected) });
    }
    if (body.action === "finish" || body.action === "recover") {
      const patch = reconciliationPatch(body.patch);
      if (!["completed", "partial", "needs_review"].includes(patch.status ?? "") || !Array.isArray(patch.applyResults)) {
        throw new AppDbValidationError("Invalid Apply outcome");
      }
      return NextResponse.json({ session: finishReconciliationApply(db, id, {
        status: patch.status as "completed" | "partial" | "needs_review", applyResults: patch.applyResults,
        appliedAt: typeof patch.appliedAt === "string" ? patch.appliedAt : null,
      }) });
    }
    if (body.action !== "save") throw new AppDbValidationError("Unknown reconciliation action");
    return NextResponse.json({ session: saveReconciliationWork(db, id, {
      ...(body.statementRows !== undefined ? { statementRows: reconciliationRows(body.statementRows) } : {}),
      ...(body.items !== undefined ? { items: reconciliationItems(body.items) } : {}),
      itemPatches: patches,
      patch: body.patch === undefined ? {} : reconciliationPatch(body.patch),
    }) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
