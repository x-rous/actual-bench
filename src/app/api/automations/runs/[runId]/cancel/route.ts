import { NextResponse } from "next/server";
import { cancelRun } from "@/lib/automation/engine";

type RouteContext = { params: Promise<{ runId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stop a run. A job that honours its cancel stops on its own; in a worker, one
 * that does not is ended after a short grace period. The run then records
 * `cancelled` - or `indeterminate`, if it was stopped after it may already
 * have changed something.
 *
 * Answers 202: the stop is requested here and completes on the run's own time.
 * The page follows the run by its id, as it does after Run now.
 */
export async function POST(_request: Request, context: RouteContext) {
  const { runId } = await context.params;
  if (!cancelRun(runId)) {
    return NextResponse.json({ error: "This run is not in progress." }, { status: 409 });
  }
  return NextResponse.json({ runId }, { status: 202 });
}
