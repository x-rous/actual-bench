import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { readSafetySettings, writeSafetySettings } from "@/lib/backup/safetyPoint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ safetyPoints: readSafetySettings(getAppDb()) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await readJsonBody(request)) as {
      enabled?: boolean;
      debounceMinutes?: number;
    };
    const settings = writeSafetySettings(getAppDb(), {
      enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
      debounceMinutes: typeof body?.debounceMinutes === "number" ? body.debounceMinutes : undefined,
    });
    return NextResponse.json({ safetyPoints: settings });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
