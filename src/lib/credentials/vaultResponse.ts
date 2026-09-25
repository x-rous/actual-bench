import { NextResponse } from "next/server";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { getVaultSummary } from "./vaultState";
import { vaultLockedError } from "./vaultSummary";

/**
 * The answer a route gives when it needs the operator vault and the vault is
 * locked (F-197), or null when it may carry on. 409: the request is fine, the
 * server's state is what has to change.
 */
export function lockedVaultResponse(db: SqliteDatabase): NextResponse | null {
  const vault = getVaultSummary(db);
  if (vault.status === "ready") return null;
  return NextResponse.json({ error: vaultLockedError(vault), vault }, { status: 409 });
}
