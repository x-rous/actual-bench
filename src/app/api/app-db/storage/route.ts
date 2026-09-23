import { NextResponse } from "next/server";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { getAppDbStorageUsage } from "@/lib/app-db/storageUsage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * What Bench's own database is made of. Requested from App health rather than
 * polled with the rest of it, because counting every table is a scan.
 */
export function GET() {
  try {
    return NextResponse.json(getAppDbStorageUsage());
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
