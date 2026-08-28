import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { buildRecoverySheet } from "@/lib/backup/recoverySheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The recovery sheet, as Markdown to print or keep with your passwords.
 *
 * Served as a file rather than rendered in the app on purpose: its whole value
 * is being readable when this app is not running.
 */
export async function GET() {
  try {
    const sheet = buildRecoverySheet(getAppDb());
    return new Response(sheet, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="actual-bench-recovery-sheet.md"`,
      },
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
