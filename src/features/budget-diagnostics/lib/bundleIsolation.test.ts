/**
 * @jest-environment node
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const SQLITE_IMPORTS = ["@sqlite.org/sqlite-wasm"] as const;
const FFLATE_IMPORTS = ["fflate"] as const;
const SQLITE_ALLOWED_PREFIXES = ["src/features/budget-diagnostics/"];
const FFLATE_ALLOWED_PREFIXES = ["src/features/budget-diagnostics/", "src/features/bundle/"];
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
      if (ALLOWED_TYPE_DECLARATIONS.has(normalizedPath)) return [];

      const source = readFileSync(file, "utf8");
      const violations: string[] = [];

      for (const moduleName of SQLITE_IMPORTS) {
        const allowed = SQLITE_ALLOWED_PREFIXES.some((p) => normalizedPath.startsWith(p));
        if (!allowed && source.includes(moduleName)) {
          violations.push(`${normalizedPath} imports ${moduleName}`);
        }
      }

      for (const moduleName of FFLATE_IMPORTS) {
        const allowed = FFLATE_ALLOWED_PREFIXES.some((p) => normalizedPath.startsWith(p));
        if (!allowed && source.includes(moduleName)) {
          violations.push(`${normalizedPath} imports ${moduleName}`);
        }
      }

      return violations;
    });

    expect(offenders).toEqual([]);
  });
});
