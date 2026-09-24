import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The shared Direct transport and the server-side host run inside worker
 * threads (RD-095 M3). Nothing they load may be browser code: a `"use client"`
 * module there would drag the tab's runtime - and `window` checks - into a
 * worker. Walks the real import graph rather than trusting a convention.
 *
 * What counts is what is evaluated when the module loads: value imports.
 * Type-only imports are erased, and a lazy `import()` runs only on the path
 * that calls it - `api/query.ts` reaches the tab's transport that way, and
 * only for a Direct connection in a tab, which server code never hands it.
 */

const SRC = resolve(__dirname, "../..");

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null; // A package.
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (candidate.match(/\.tsx?$/) && existsSync(candidate)) return candidate;
  }
  return null;
}

function importGraph(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    const source = readFileSync(file, "utf8");
    seen.set(file, source);
    for (const match of source.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s)?[^;]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g)) {
      if (match[2]) continue; // `import type` / `export type`: erased.
      const specifier = match[3] ?? match[4];
      const resolved = specifier ? resolveImport(file, specifier) : null;
      if (resolved) pending.push(resolved);
    }
  }
  return seen;
}

function clientModules(entry: string): string[] {
  return [...importGraph(entry)]
    .filter(([, source]) => /^\s*["']use client["']/.test(source))
    .map(([file]) => file.slice(SRC.length + 1));
}

describe("code that runs in a worker", () => {
  it.each(["lib/actual/runtimeTransport.ts", "lib/actual/runtime/nodeHost.ts", "lib/actual/serverTransport.ts"])(
    "%s loads nothing marked \"use client\"",
    (entry) => {
      expect(clientModules(join(SRC, entry))).toEqual([]);
    }
  );

  it("would notice if it did", () => {
    expect(clientModules(join(SRC, "lib/actual/browserApiTransport.ts"))).toContain("lib/actual/browser/browserHost.ts");
  });
});
