import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractSqliteWorker, instrumentSqliteWorker } from "./sqliteWorkerTrace";

it("decodes worker source as data, including raw tabs, without executing it", () => {
  const prefix = "(self.URL || self.webkitURL).revokeObjectURL(self.location.href);";
  const source = "globalThis.mustNotRun = true;\tconsole.log('worker');";
  const literal = JSON.stringify(source).replace("\\t", "\t");
  const bundle = `var I = ${literal}, L = new Blob([${JSON.stringify(prefix)}, I], {});`;
  expect(extractSqliteWorker(bundle)).toEqual({ source, blobPrefix: prefix });
  expect("mustNotRun" in globalThis).toBe(false);
  expect(extractSqliteWorker(bundle + 'var I = "duplicate"')).toBeNull();
  expect(extractSqliteWorker("unsupported layout")).toBeNull();
});

it("keeps a $ in the worker's own names as it is, instead of reading it as a replacement pattern", () => {
  const worker = "i.register_for_idb=e=>{let r=w(function(e,t){e=$1(e),$$.set(t,e)},`vii`)};"
    + "var o=a(`sqlite3_open`,`number`,[`string`,`number`]),s=a(`sqlite3_close_v2`,`number`,[`number`]);";
  expect(instrumentSqliteWorker(worker)).toContain("e=$1(e),globalThis.__abTraceSqliteOpen(e),$$.set(t,e)");
});

it("finds the worker whatever the bundler called the variable, and only when its Blob follows the declaration", () => {
  const prefix = "(self.URL || self.webkitURL).revokeObjectURL(self.location.href);";
  const bundle = (name: string) => `var ${name} = ${JSON.stringify("worker();")}, L = new Blob([${JSON.stringify(prefix)}, ${name}], {});`;
  expect(extractSqliteWorker(bundle("F"))?.source).toBe("worker();");
  expect(extractSqliteWorker(bundle("I"))?.source).toBe("worker();");
  expect(extractSqliteWorker(`var X = "other"; ${"/* padding */".repeat(30)} new Blob([${JSON.stringify(prefix)}, X], {})`)).toBeNull();
});

it("instruments the installed @actual-app/api browser bundle, so an upgrade that moves its markers fails here", () => {
  const bundle = readFileSync(join(process.cwd(), "node_modules/@actual-app/api/dist/browser.js"), "utf8");
  const worker = extractSqliteWorker(bundle);
  expect(worker).not.toBeNull();
  const instrumented = instrumentSqliteWorker(worker!.source);
  expect(instrumented).not.toBeNull();
  expect(instrumented).toContain("__abTraceSqliteOpen(e)");
  expect(instrumented).toContain("__abTraceSqliteCall(");
});
