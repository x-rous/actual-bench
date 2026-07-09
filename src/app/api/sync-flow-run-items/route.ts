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
