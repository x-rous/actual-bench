import { runtimeDiagnosticEnabled } from "../runtime/diagnostics";
export { instrumentSqliteWorker } from "./sqliteWorkerTrace";

function report(message: string): void {
  try { console.info(`[actual-bench sqlite diagnostics] ${message}`); } catch { /* Diagnostic only. */ }
}

/** Observe the cached worker Blob's URL creation during init, independent of import order. */
export function installSqliteFileDiagnostics(): (() => void) | Promise<() => void> {
  if (!runtimeDiagnosticEnabled("ab:debug-sqlite-files")) {
    if (runtimeDiagnosticEnabled("ab:debug-timing")) report("File/connection tracing disabled: ab:debug-sqlite-files is not 1");
    return () => {};
  }
  if (typeof URL.createObjectURL !== "function") { report("Object URL tracing unavailable; original worker retained"); return () => {}; }
  return prepareSqliteFileDiagnostics();
}

async function prepareSqliteFileDiagnostics(): Promise<() => void> {
  const endpoint = "/api/actual-runtime-diagnostics/worker";
  let blobBytes: number;
  let digest: string;
  let diagnosticBlob: Blob;
  try {
    const response = await fetch(`${endpoint}?metadata=1`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const data: unknown = await response.json();
    if (!response.ok || !data || typeof data !== "object" || !("available" in data) || data.available !== true
      || !("blobBytes" in data) || typeof data.blobBytes !== "number" || !Number.isSafeInteger(data.blobBytes) || data.blobBytes <= 0
      || !("digest" in data) || typeof data.digest !== "string" || !/^[a-f0-9]{64}$/.test(data.digest)) {
      report("Worker layout unsupported; original worker retained"); return () => {};
    }
    blobBytes = data.blobBytes;
    digest = data.digest;
    // Fetch before init: asset failures leave the original worker path untouched.
    const script = await fetch(`${endpoint}?digest=${digest}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!script.ok) { report("Diagnostic worker download unavailable; original worker retained"); return () => {}; }
    diagnosticBlob = new Blob([await script.text()], { type: "text/javascript;charset=utf-8" });
  } catch { report("Diagnostic asset unavailable; original worker retained"); return () => {}; }
  const original = URL.createObjectURL;
  let observed = false;
  const traced: typeof URL.createObjectURL = (object) => {
    if (object instanceof Blob && object.size === blobBytes && object.type === "text/javascript;charset=utf-8") {
      observed = true;
      report("Supported worker selected; awaiting worker startup confirmation");
      return original.call(URL, diagnosticBlob);
    }
    return original.call(URL, object);
  };
  try { URL.createObjectURL = traced; }
  catch { report("Object URL tracing unavailable; original worker retained"); return () => {}; }
  return () => {
    if (URL.createObjectURL === traced) URL.createObjectURL = original;
    if (!observed) report("Worker Blob did not match; original worker retained");
  };
}
