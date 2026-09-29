import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * P1.3b T201 (Constitution XIII): browser code for Assets & Debt, and the shared model builder,
 * never import a server-only module at runtime. Type-only imports are erased and allowed.
 */

const SERVER_ONLY = [/^@\/lib\/app-db(\/|$)/, /^@\/lib\/assets-debt\/services(\/|$)/, /^@\/lib\/credentials(\/|$)/, /^node:/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.includes("TestKit") ? [path] : [];
  });
}

it("no runtime import of a server-only module from the simulator or the model builder", () => {
  const roots = [join(__dirname, ".."), join(__dirname, "../../../lib/assets-debt/model")];
  const offenders: string[] = [];
  for (const file of roots.flatMap(files)) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gms)) {
      if (!m[1] && SERVER_ONLY.some((re) => re.test(m[2]))) offenders.push(`${file}: ${m[2]}`);
    }
  }
  expect(offenders).toEqual([]);
});
