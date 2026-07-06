import { NextResponse } from "next/server";
import { AppDbUnavailableError, AppDbValidationError, errorMessage } from "./errors";

export function appDbErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppDbValidationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
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
