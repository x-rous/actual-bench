import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * P1.3b T201 (Constitution XIII): browser code for Assets & Debt, and the shared model builder,
 * never import a server-only module at runtime. Type-only imports are erased and allowed.
 */

const SERVER_ONLY = [/^@\/lib\/app-db(\/|$)/, /^@\/lib\/assets-debt\/services(\/|$)/, /^@\/lib\/credentials(\/|$)/, /^node:/];

/**
 * Service modules that are pure and client-safe, so the browser may import
 * them at runtime: the P1.5 offset-history reader and the P1.6 browser half of
 * applying a posting (the executor, its verifiers and recovery reads run where
 * the transport is). The second test proves none of them imports anything
 * server-only, so the allowance cannot hide a real server dependency.
 */
const CLIENT_SAFE_SERVICES = [
  "@/lib/assets-debt/services/offsetHistoryService",
  "@/lib/assets-debt/services/snapshot",
  "@/lib/assets-debt/services/applyService",
  "@/lib/assets-debt/services/verify",
  "@/lib/assets-debt/services/postingErrors",
  "@/lib/assets-debt/services/recovery",
];

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
    for (const m of source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gm)) {
      if (!m[1] && SERVER_ONLY.some((re) => re.test(m[2])) && !CLIENT_SAFE_SERVICES.includes(m[2])) offenders.push(`${file}: ${m[2]}`);
    }
  }
  expect(offenders).toEqual([]);
});

it("the client-safe service modules import nothing server-only at runtime", () => {
  const services = join(__dirname, "../../../lib/assets-debt/services");
  const offenders: string[] = [];
  for (const serviceModule of CLIENT_SAFE_SERVICES) {
    const rel = serviceModule.replace("@/lib/assets-debt/services/", "");
    const path = [join(services, `${rel}.ts`), join(services, rel, "index.ts")].find((candidate) => { try { return statSync(candidate).isFile(); } catch { return false; } });
    if (!path) { offenders.push(`${serviceModule}: missing`); continue; }
    const source = readFileSync(path, "utf8");
    for (const m of source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gm)) {
      if (m[1]) continue;
      const target = m[2].startsWith("./") ? `@/lib/assets-debt/services/${m[2].slice(2)}` : m[2].startsWith("../") ? `@/lib/assets-debt/${m[2].slice(3)}` : m[2];
      const serverOnly = [/^@\/lib\/app-db(\/|$)/, /^@\/lib\/credentials(\/|$)/, /^node:/, /better-sqlite3/].some((re) => re.test(target))
        || (/^@\/lib\/assets-debt\/services(\/|$)/.test(target) && !CLIENT_SAFE_SERVICES.includes(target));
      if (serverOnly) offenders.push(`${serviceModule}: ${m[2]}`);
    }
  }
  expect(offenders).toEqual([]);
});
