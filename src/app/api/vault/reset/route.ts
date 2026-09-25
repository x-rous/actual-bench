import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { resetVault, summarizeVault, VaultResetRefusedError } from "@/lib/credentials/vaultState";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Reset a locked vault (F-197): clears every operator-domain secret and every
 * unattended enrolment so the vault can start again with the key Bench has,
 * or a new one. Refused (409) unless the vault is locked for a reason a reset
 * fixes, so a working vault cannot be wiped by one request.
 */
export function POST() {
  try {
    const state = resetVault(getAppDb());
    return NextResponse.json({ vault: summarizeVault(state) });
  } catch (error) {
    if (error instanceof VaultResetRefusedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return appDbErrorResponse(error);
  }
}
