/**
 * @jest-environment node
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const HEAVY_DIAGNOSTICS_IMPORTS = ["@sqlite.org/sqlite-wasm", "fflate"] as const;
const ALLOWED_PREFIX = "src/features/budget-diagnostics/";
const ALLOWED_TYPE_DECLARATIONS = new Set(["src/types/sqlite-wasm.d.ts"]);

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return listSourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe("budget diagnostics bundle isolation", () => {
  it("keeps sqlite-wasm and ZIP parsing imports inside the diagnostics feature", () => {
    const offenders = listSourceFiles(SRC_DIR).flatMap((file) => {
      const relativePath = relative(ROOT, file);
      const normalizedPath = relativePath.replace(/\\+/g, "/");
      if (
        normalizedPath.startsWith(ALLOWED_PREFIX) ||
        ALLOWED_TYPE_DECLARATIONS.has(normalizedPath)
      ) {
        return [];
      }

      const source = readFileSync(file, "utf8");
      return HEAVY_DIAGNOSTICS_IMPORTS.filter((moduleName) =>
        source.includes(moduleName)
      ).map((moduleName) => `${normalizedPath} imports ${moduleName}`);
    });

    expect(offenders).toEqual([]);
  });
});
