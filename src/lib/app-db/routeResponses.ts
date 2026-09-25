import { NextResponse } from "next/server";
import { VaultLockedError } from "@/lib/sync/vault";
import { AppDbUnavailableError, AppDbValidationError, errorMessage } from "./errors";

export function appDbErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppDbValidationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }

  // The request was fine; the server's vault is what has to change (F-197).
  if (error instanceof VaultLockedError) {
    return NextResponse.json({ error: error.message, code: "VAULT_LOCKED" }, { status: 409 });
  }

  if (error instanceof AppDbUnavailableError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
  }

  return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    throw new AppDbValidationError("Invalid JSON body");
  }
}
