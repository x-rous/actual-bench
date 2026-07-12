import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { parseFxCsv, previewFxImport, commitFxImport } from "@/lib/fx/services/importFxRates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * CSV FX-rate import (RD-056 / PR-025d). `mode: "preview"` validates and
 * categorizes rows (no writes); `mode: "commit"` applies them as one batch with
 * versioned replacement and returns the batch counts.
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as {
      csv?: string;
      filename?: string;
      mode?: "preview" | "commit";
      overrideProvider?: boolean;
      overrideManual?: boolean;
    } | null;
    if (!body?.csv) {
      return NextResponse.json({ error: "csv content is required." }, { status: 400 });
    }
    const rows = parseFxCsv(body.csv);
    const options = { overrideProvider: body.overrideProvider, overrideManual: body.overrideManual };

    if (body.mode === "commit") {
      const batch = commitFxImport(getAppDb(), body.filename ?? "upload.csv", rows, options);
      return NextResponse.json({ batch });
    }
    return NextResponse.json(previewFxImport(getAppDb(), rows, options));
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
