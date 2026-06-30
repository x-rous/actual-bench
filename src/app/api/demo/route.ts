import { NextResponse } from "next/server";

// Read env at request time, not build time, so the same image behaves as a
// normal self-host build unless the demo vars are present in the environment.
export const dynamic = "force-dynamic";

/**
 * Demo connection endpoint.
 *
 * Returns the public demo connection — but ONLY when the deployment opts in via
 * DEMO_MODE=1 and every demo var is set. Self-hosters never set these, so this
 * route 404s for them and the "Try the live demo" button stays hidden.
 *
 * The demo API key is intentionally exposed to the browser: it only gates a
 * throwaway, self-resetting sandbox (see docs/DEMO_DEPLOYMENT.md).
 */
export function GET() {
  const { DEMO_MODE, DEMO_BASE_URL, DEMO_API_KEY, DEMO_BUDGET_SYNC_ID } =
    process.env;

  if (
    DEMO_MODE !== "1" ||
    !DEMO_BASE_URL ||
    !DEMO_API_KEY ||
    !DEMO_BUDGET_SYNC_ID
  ) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json({
    baseUrl: DEMO_BASE_URL,
    apiKey: DEMO_API_KEY,
    budgetSyncId: DEMO_BUDGET_SYNC_ID,
  });
}
