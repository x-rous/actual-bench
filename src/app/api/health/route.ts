import { NextResponse } from "next/server";
import { getAppDbHealth } from "@/lib/app-db/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Infrastructure readiness probe for container orchestrators (Docker
 * HEALTHCHECK, Fly.io, PikaPods, etc). Unlike /api/app-db/health, which the
 * App Health UI reads and always answers 200 with a status field, this
 * reports readiness through the HTTP status itself, and returns nothing
 * beyond a bare status word — no paths, no error detail, no env state.
 */
export function GET() {
  try {
    const health = getAppDbHealth();
    if (health.ready) {
      return NextResponse.json({ status: "ok" }, { status: 200 });
    }
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
