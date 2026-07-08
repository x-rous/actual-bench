import { NextResponse } from "next/server";
import { getAppDbHealth } from "@/lib/app-db/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(getAppDbHealth());
}
