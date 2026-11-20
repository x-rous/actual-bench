import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { getBackupArtifact } from "@/lib/app-db/backupRepository";
import { createDestinationAdapter } from "@/lib/backup/destinations";
import { readableLocations } from "@/lib/backup/inspect";

type RouteContext = { params: Promise<{ artifactId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Hand the file back to the user.
 *
 * The most important restore path there is, and the one least likely to break:
 * a downloaded ZIP goes into Actual's own "Import file" without Bench being
 * involved at all. Every cleverer path in this feature is a convenience on top
 * of this one, so it stays simple and always available.
 *
 * Encrypted artifacts are served as stored — Bench does not silently decrypt a
 * file on its way out of the server, where the plaintext would then be sitting
 * in a downloads folder.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { artifactId } = await context.params;
    const db = getAppDb();

    const artifact = getBackupArtifact(db, artifactId);
    if (!artifact) return NextResponse.json({ error: "Backup not found" }, { status: 404 });

    // Every stored copy, healthiest destination first: a second, intact copy
    // is no use if the download only ever tries the first.
    const candidates = readableLocations(db, artifactId);
    if (candidates.length === 0) {
      return NextResponse.json({ error: "Bench has no stored copy of this backup." }, { status: 404 });
    }

    const errors: string[] = [];
    for (const { location, destination } of candidates) {
      try {
        const adapter = createDestinationAdapter(db, destination);
        const filename = location.objectKey.split("/").pop() || "backup.zip";
        const headers: Record<string, string> = {
          "Content-Type": artifact.encrypted
            ? "application/octet-stream"
            : artifact.kind === "budget"
              ? "application/zip"
              : "application/vnd.sqlite3",
          "Content-Disposition": contentDisposition(filename),
        };

        // Streamed when the destination can, so a large copy is not held in
        // the server's memory on its way to the browser.
        if (adapter.getStream) {
          const { stream, sizeBytes } = await adapter.getStream(location.objectKey);
          if (sizeBytes > 0) headers["Content-Length"] = String(sizeBytes);
          return new NextResponse(stream, { headers });
        }
        const bytes = await adapter.get(location.objectKey);
        headers["Content-Length"] = String(bytes.byteLength);
        return new NextResponse(new Uint8Array(bytes), { headers });
      } catch (error) {
        errors.push(`${destination.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return NextResponse.json(
      { error: `No copy of this backup could be read. ${errors.join("; ")}` },
      { status: 502 }
    );
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/**
 * The attachment header, safe for any name.
 *
 * Object keys found by discovery come from the destination, so the name is
 * not trusted: the plain `filename` keeps only safe characters and the real
 * name travels percent-encoded in `filename*`.
 */
function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
