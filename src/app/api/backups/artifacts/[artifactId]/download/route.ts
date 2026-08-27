import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import {
  getBackupArtifact,
  getBackupDestination,
  listArtifactLocations,
} from "@/lib/app-db/backupRepository";
import { createDestinationAdapter } from "@/lib/backup/destinations";

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

    const location = listArtifactLocations(db, artifactId).find(
      (entry) => entry.status === "stored" && entry.destinationId
    );
    if (!location?.destinationId) {
      return NextResponse.json({ error: "Bench has no stored copy of this backup." }, { status: 404 });
    }

    const destination = getBackupDestination(db, location.destinationId);
    if (!destination) {
      return NextResponse.json({ error: "The destination holding it has been removed." }, { status: 404 });
    }

    const bytes = await createDestinationAdapter(db, destination).get(location.objectKey);
    const filename = location.objectKey.split("/").pop() ?? "backup.zip";

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": artifact.encrypted
          ? "application/octet-stream"
          : artifact.kind === "budget"
            ? "application/zip"
            : "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
