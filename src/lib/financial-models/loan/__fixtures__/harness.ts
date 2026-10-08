import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Golden fixture harness (research R-14, SC-003). Test support only: nothing in
 * production imports this file, and it is the one place under
 * src/lib/financial-models allowed to read files.
 *
 * Layout: `__fixtures__/<family>/SOURCES.md` records the family's sources and
 * status; each `__fixtures__/<family>/<fixture>/` holds `input.json`,
 * `events.csv`, `expected.csv` and `source.md`. A fixture without a complete
 * `source.md` does not load, so no expected value can exist without saying
 * where it came from. Expected values are never produced by the engine under
 * test: they come from the cited publication or the independent oracle in
 * src/test-oracles/rd084.
 */

export const FIXTURES_ROOT = __dirname;

export type CsvRow = Record<string, string>;

/** Keys every `source.md` must declare, as `key: value` lines. */
export const REQUIRED_SOURCE_KEYS = [
  "id",
  "country",
  "currency",
  "source-name",
  "source-url",
  "source-type",
  "verified",
  "conventions",
  "engine-versions",
  "coverage",
] as const;

export type FixtureSource = Record<(typeof REQUIRED_SOURCE_KEYS)[number], string> & {
  coverage: "reference" | "synthetic";
};

export type Fixture = {
  family: string;
  name: string;
  dir: string;
  input: Record<string, unknown>;
  events: CsvRow[];
  expected: CsvRow[];
  source: FixtureSource;
};

/** `status:` values a family's SOURCES.md may declare. */
export type FamilyStatus = "verified" | "verified-behavior" | "no-verified-source" | "gated";

export class FixtureError extends Error {}

export function parseKeyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([a-z][a-z-]*):\s*(.+)$/.exec(line.trim());
    if (match && !(match[1] in out)) out[match[1]] = match[2].trim();
  }
  return out;
}

export function parseCsv(text: string, file = "csv"): CsvRow[] {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length === 0) throw new FixtureError(`${file} has no header row`);
  if (text.includes('"')) throw new FixtureError(`${file} must not use quoted fields`);
  const header = lines[0].split(",");
  return lines.slice(1).map((line, i) => {
    const cells = line.split(",");
    if (cells.length !== header.length) throw new FixtureError(`${file} row ${i + 1} has ${cells.length} cells, expected ${header.length}`);
    return Object.fromEntries(header.map((h, j) => [h, cells[j]]));
  });
}

export function readSource(dir: string): FixtureSource {
  const path = join(dir, "source.md");
  if (!existsSync(path)) throw new FixtureError(`${dir} has no source.md`);
  const fields = parseKeyValues(readFileSync(path, "utf8"));
  const missing = REQUIRED_SOURCE_KEYS.filter((k) => !fields[k]);
  if (missing.length > 0) throw new FixtureError(`${path} is missing: ${missing.join(", ")}`);
  if (fields.coverage !== "reference" && fields.coverage !== "synthetic") {
    throw new FixtureError(`${path}: coverage must be "reference" or "synthetic"`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.verified)) throw new FixtureError(`${path}: verified must be an ISO date`);
  return fields as FixtureSource;
}

export function loadFixture(dir: string): Fixture {
  const source = readSource(dir);
  const read = (file: string) => {
    const path = join(dir, file);
    if (!existsSync(path)) throw new FixtureError(`${dir} has no ${file}`);
    return readFileSync(path, "utf8");
  };
  const parts = dir.split(/[\\/]/);
  return {
    family: parts[parts.length - 2],
    name: parts[parts.length - 1],
    dir,
    input: JSON.parse(read("input.json")) as Record<string, unknown>,
    events: parseCsv(read("events.csv"), join(dir, "events.csv")),
    expected: parseCsv(read("expected.csv"), join(dir, "expected.csv")),
    source,
  };
}

export function listFamilies(root = FIXTURES_ROOT): string[] {
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .sort();
}

export function familyStatus(family: string, root = FIXTURES_ROOT): FamilyStatus {
  const path = join(root, family, "SOURCES.md");
  if (!existsSync(path)) throw new FixtureError(`${family} has no SOURCES.md`);
  const status = parseKeyValues(readFileSync(path, "utf8")).status;
  const known: FamilyStatus[] = ["verified", "verified-behavior", "no-verified-source", "gated"];
  if (!known.includes(status as FamilyStatus)) throw new FixtureError(`${path}: unknown status ${JSON.stringify(status)}`);
  return status as FamilyStatus;
}

export function loadFamily(family: string, root = FIXTURES_ROOT): Fixture[] {
  const dir = join(root, family);
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort()
    .map((name) => loadFixture(join(dir, name)));
}

export type RowMismatch = { row: number; column: string; expected: string | undefined; actual: string | undefined };

/**
 * Row-by-row comparison. Values compare as exact strings, so minor units must
 * match to the unit and a missing or extra row is a mismatch, never ignored.
 */
export function compareRows(expected: CsvRow[], actual: CsvRow[]): RowMismatch[] {
  const mismatches: RowMismatch[] = [];
  const rows = Math.max(expected.length, actual.length);
  for (let i = 0; i < rows; i++) {
    const e = expected[i];
    const a = actual[i];
    const columns = new Set([...Object.keys(e ?? {}), ...Object.keys(a ?? {})]);
    for (const column of columns) {
      if (e?.[column] !== a?.[column]) mismatches.push({ row: i + 1, column, expected: e?.[column], actual: a?.[column] });
    }
  }
  return mismatches;
}
