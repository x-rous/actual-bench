import { installSqliteFileDiagnostics, instrumentSqliteWorker } from "./sqliteDiagnostics";

const callback = "r=w(function(e,t){e=F(e),he.set(t,e)},`vii`)";
const worker = `var i={},he=new Map();function F(value){return value}function w(value){return value}
function a(name){return function(...args){globalThis.__testCalls.push([name,args]);return 17}}
var o=a(\`sqlite3_open\`,\`number\`,[\`string\`,\`number\`]),s=a(\`sqlite3_close_v2\`,\`number\`,[\`number\`]);
i.register_for_idb=e=>{let ${callback};i._register_for_idb(r)};
i._register_for_idb=fn=>{globalThis.__testOpen=fn};i.register_for_idb({});globalThis.__testConnection=o;globalThis.__testFiles=he;`;
type Scope = { __testOpen?: (path: string, file: number) => void; __testConnection?: (path: string, file: number) => number; __testCalls?: unknown[]; __testFiles?: Map<number,string>; __abTraceSqliteOpen?: unknown; __abTraceSqliteCall?: unknown };

afterEach(() => {
  localStorage.removeItem("ab:debug-sqlite-files");
  for (const key of ["__testOpen", "__testConnection", "__testCalls", "__testFiles", "__abTraceSqliteOpen", "__abTraceSqliteCall"] as const) delete (globalThis as Scope)[key];
  jest.restoreAllMocks();
});

it("distinguishes VFS opens from connection calls and keeps calls unchanged without logging paths", () => {
  const log = jest.spyOn(console, "info").mockImplementation(() => {});
  (globalThis as Scope).__testCalls = [];
  new Function(instrumentSqliteWorker(worker)!)();
  const scope = globalThis as Scope;
  expect(scope.__testConnection!("/blocked/documents-private-budget-db.sqlite", 8)).toBe(17);
  scope.__testOpen!("/blocked/documents-private-budget-db.sqlite", 1);
  scope.__testOpen!("", 2);
  expect(log).toHaveBeenCalledWith("[actual-bench sqlite connection]", 1, "open", "main budget database");
  expect(log).toHaveBeenCalledWith("[actual-bench sqlite file-open]", 1, "main budget database");
  expect(log).toHaveBeenCalledWith("[actual-bench sqlite file-open]", 2, "unnamed file");
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-budget");
  expect(scope.__testCalls).toEqual([["sqlite3_open", ["/blocked/documents-private-budget-db.sqlite", 8]]]);
  log.mockImplementation(() => { throw new Error("console unavailable"); });
  expect(() => scope.__testOpen!("", 3)).not.toThrow();
  expect(scope.__testFiles?.has(3)).toBe(true);
});

it("refuses partial or ambiguous instrumentation", () => {
  expect(instrumentSqliteWorker(worker.replace("he.set(t,e)", "changed(t,e)"))).toBeNull();
  expect(instrumentSqliteWorker(worker + callback)).toBeNull();
});

it("does not fetch or hook URL creation when the diagnostic flag is disabled", () => {
  const original = URL.createObjectURL;
  const restore = installSqliteFileDiagnostics();
  expect(restore).not.toBeInstanceOf(Promise);
  expect(URL.createObjectURL).toBe(original);
  (restore as () => void)();
});

it("leaves the original worker path intact when diagnostic preparation fails", async () => {
  localStorage.setItem("ab:debug-sqlite-files", "1");
  const original = URL.createObjectURL;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = jest.fn(async () => { throw new Error("unavailable"); });
  try {
    const restore = await installSqliteFileDiagnostics();
    expect(URL.createObjectURL).toBe(original);
    restore();
  } finally { globalThis.fetch = originalFetch; }
});

it("traces an already-created vendor Blob and restores URL creation", async () => {
  const original = URL.createObjectURL;
  const originalFetch = globalThis.fetch;
  const create = jest.fn((object: Blob | MediaSource) => object instanceof Blob ? "blob:original" : "blob:media");
  URL.createObjectURL = create;
  const vendor = new Blob(["abc"], { type: "text/javascript;charset=utf-8" });
  localStorage.setItem("ab:debug-sqlite-files", "1");
  const log = jest.spyOn(console, "info").mockImplementation(() => {});
  globalThis.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ available: true, blobBytes: vendor.size, digest: "a".repeat(64) }) })
    .mockResolvedValueOnce({ ok: true, text: async () => "observed vendor worker" });
  let restore: (() => void) | undefined;
  try {
    restore = await installSqliteFileDiagnostics();
    expect(URL.createObjectURL(vendor)).toBe("blob:original");
    expect(create.mock.calls[0][0]).not.toBe(vendor);
    const unrelated = new Blob(["other"]);
    URL.createObjectURL(unrelated);
    expect(create.mock.calls[1][0]).toBe(unrelated);
    restore();
    expect(URL.createObjectURL).toBe(create);
  } finally {
    restore?.(); URL.createObjectURL = original; globalThis.fetch = originalFetch; log.mockRestore();
  }
});
