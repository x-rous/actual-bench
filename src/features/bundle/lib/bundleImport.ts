import { unzipSync, strFromU8 } from "fflate";
import type { BundleEntityKey } from "./bundleExport";

export type BundleFileEntry = {
  key: BundleEntityKey;
  filename: string;
  csvText: string;
  rowCount: number;
};

export type ReadBundleResult =
  | { ok: true; files: BundleFileEntry[] }
  | { ok: false; error: string };

const FILENAME_TO_KEY: Record<string, BundleEntityKey> = {
  "accounts.csv": "accounts",
  "payees.csv": "payees",
  "category-groups-and-categories.csv": "categories",
  "tags.csv": "tags",
  "schedules.csv": "schedules",
  "rules.csv": "rules",
};

// Dependency order for import — each entity may reference earlier ones by name
const IMPORT_ORDER: BundleEntityKey[] = [
  "categories",
  "accounts",
  "payees",
  "tags",
  "schedules",
  "rules",
];

function stripBom(text: string): string {
  return text.startsWith("﻿") ? text.slice(1) : text;
}

function countDataRows(csvText: string): number {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  return Math.max(0, lines.length - 1);
}

export async function readBundleZip(file: File): Promise<ReadBundleResult> {
  try {
    const buffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    const unzipped = unzipSync(uint8);

    const files: BundleFileEntry[] = [];
    for (const [filename, data] of Object.entries(unzipped)) {
      const key = FILENAME_TO_KEY[filename];
      if (!key) continue;
      const csvText = stripBom(strFromU8(data));
      files.push({ key, filename, csvText, rowCount: countDataRows(csvText) });
    }

    files.sort(
      (a, b) => IMPORT_ORDER.indexOf(a.key) - IMPORT_ORDER.indexOf(b.key)
    );

    return { ok: true, files };
  } catch {
    return {
      ok: false,
      error: "Could not read the ZIP file. Please check that it is a valid bundle.",
    };
  }
}
