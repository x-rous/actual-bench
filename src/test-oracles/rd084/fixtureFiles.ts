import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Reads the RD-084 golden fixtures as plain data files. The oracle has its own
 * tiny reader so it shares no code with the production harness it checks.
 */
export const FIXTURES_DIR = resolve(__dirname, "../../lib/financial-models/loan/__fixtures__");

export type OracleFixture = {
  family: string;
  name: string;
  input: Record<string, unknown>;
  events: Record<string, string>[];
  expected: Record<string, string>[];
};

function csv(text: string): Record<string, string>[] {
  const [head, ...rows] = text.trim().split("\n");
  const keys = head.split(",");
  return rows.filter(Boolean).map((r) => Object.fromEntries(r.split(",").map((v, i) => [keys[i], v])));
}

export function allFixtures(): OracleFixture[] {
  const out: OracleFixture[] = [];
  for (const family of readdirSync(FIXTURES_DIR).sort()) {
    const familyDir = join(FIXTURES_DIR, family);
    if (!statSync(familyDir).isDirectory()) continue;
    for (const name of readdirSync(familyDir).sort()) {
      const dir = join(familyDir, name);
      if (!statSync(dir).isDirectory()) continue;
      out.push({
        family,
        name,
        input: JSON.parse(readFileSync(join(dir, "input.json"), "utf8")),
        events: csv(readFileSync(join(dir, "events.csv"), "utf8")),
        expected: csv(readFileSync(join(dir, "expected.csv"), "utf8")),
      });
    }
  }
  return out;
}
