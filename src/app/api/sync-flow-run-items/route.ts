import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  updateSyncFlowRunItem,
  type UpdateSyncFlowRunItemPatch,
} from "@/lib/app-db/syncRunRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BatchItemUpdate = { itemId: string; patch: UpdateSyncFlowRunItemPatch };

/**
 * Batch-update run item statuses in ONE transaction (RD-054 / PR-020 perf).
 *
 * Apply persists a status per item; doing that as a PATCH-per-item is hundreds
 * of round-trips on a large run. Buffering them and flushing here collapses that
 * to a single request + a single commit.
 */
export async function PATCH(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { items?: BatchItemUpdate[] };
    const items = Array.isArray(body.items) ? body.items : [];
    // Validate up front so a malformed entry fails fast with a clear 400 rather
    // than a TypeError that rolls back the whole transaction with a vague error.
    for (const item of items) {
      if (!item || typeof item.itemId !== "string" || typeof item.patch !== "object" || item.patch === null) {
        return NextResponse.json(
          { error: "Each item must have a string itemId and a patch object" },
          { status: 400 }
        );
      }
    }
    const db = getAppDb();
    const applyAll = db.transaction(() => {
      let updated = 0;
      for (const { itemId, patch } of items) {
        if (updateSyncFlowRunItem(db, itemId, patch)) updated += 1;
      }
      return updated;
    });
    return NextResponse.json({ updated: applyAll() });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
