import { extractSqliteWorker } from "./sqliteWorkerTrace";

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
