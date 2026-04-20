import { unzipSync, strFromU8 } from "fflate";
import type { SnapshotMetadata } from "../types";

export type UnzippedSnapshot = {
  dbBytes: Uint8Array;
  metadata: SnapshotMetadata | null;
  hadMetadata: boolean;
};

function normalizeZipPath(path: string): string {
  return path.replace(/^\.?\//, "");
}

function parseMetadata(bytes: Uint8Array | undefined): SnapshotMetadata | null {
  if (!bytes) return null;
  const parsed = JSON.parse(strFromU8(bytes)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("metadata.json must contain a JSON object");
  }
  return parsed as SnapshotMetadata;
}

export function unzipSnapshot(bytes: ArrayBuffer): UnzippedSnapshot {
  const files = unzipSync(new Uint8Array(bytes));
  let dbBytes: Uint8Array | null = null;
  let metadataBytes: Uint8Array | undefined;

  for (const [path, fileBytes] of Object.entries(files)) {
    const normalized = normalizeZipPath(path);
    if (normalized === "db.sqlite") {
      dbBytes = fileBytes;
    } else if (normalized === "metadata.json") {
      metadataBytes = fileBytes;
    }
  }

  if (!dbBytes) {
    throw new Error("Export ZIP is missing db.sqlite");
  }

  return {
    dbBytes,
    metadata: parseMetadata(metadataBytes),
    hadMetadata: Boolean(metadataBytes),
  };
}
