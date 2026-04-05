import { parseCsvLine } from "@/lib/csv";
import type { Tag } from "@/types/entities";

/** Valid hex color: # followed by 3 or 6 hex digits. */
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export type TagsImportResult = {
  tags: Omit<Tag, "id">[];
  skipped: number;
};

export type TagsImportError = { error: string };

/**
 * Parses a CSV string into a list of tags to create.
 * Required column: name. Optional: color, description.
 * Rows with empty name are skipped. Invalid hex colors are ignored (color cleared).
 */
export function importTagsFromCsv(text: string): TagsImportResult | TagsImportError {
  const allLines = text.split(/\r?\n/);
  const nonEmpty = allLines.filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2) return { error: "CSV has no data rows." };

  const headers = parseCsvLine(nonEmpty[0]).map((h) => h.trim().toLowerCase());
  const nameIdx  = headers.indexOf("name");
  if (nameIdx === -1) return { error: 'CSV must have a "name" column.' };

  const colorIdx = headers.indexOf("color");
  const descIdx  = headers.indexOf("description");

  const tags: Omit<Tag, "id">[] = [];
  let skipped = 0;

  for (let i = 1; i < allLines.length; i++) {
    const line = allLines[i];
    if (!line.trim()) continue;

    const fields = parseCsvLine(line);
    const name = fields[nameIdx]?.trim() ?? "";
    if (!name) { skipped++; continue; }

    const rawColor = colorIdx >= 0 ? (fields[colorIdx]?.trim() ?? "") : "";
    const color = rawColor && HEX_COLOR_RE.test(rawColor) ? rawColor : undefined;

    const description = descIdx >= 0 ? (fields[descIdx]?.trim() || undefined) : undefined;

    tags.push({ name, color, description });
  }

  return { tags, skipped };
}
