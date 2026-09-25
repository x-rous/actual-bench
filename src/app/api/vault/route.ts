import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { getVaultState } from "@/lib/credentials/vaultState";
import { VAULT_LOCK_MESSAGES } from "@/lib/credentials/vaultSummary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The operator vault's state (F-197): ready, or locked with the cause. Never
 * key material. Nothing is cached server-side, so fetching again is how App
 * Health's "Check again" works after a key file is restored or a variable set.
 */
export function GET() {
  try {
    const state = getVaultState(getAppDb());
    return NextResponse.json({
      status: state.status,
      ...(state.status === "locked"
        ? { reason: state.reason, message: VAULT_LOCK_MESSAGES[state.reason], detail: state.detail }
        : {}),
      source: state.source,
      warning: state.warning,
      keyPath: state.keyPath,
      storedSecrets: state.storedSecrets,
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
