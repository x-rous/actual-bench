// Explicit compatibility guard for the self-contained Actual API 26.11.0 worker. The bundler renames its helpers from release to
// release, so the open callback is matched by shape and the two names in it are captured; the other markers have been stable.
const OPEN_CALLBACK = /r=w\(function\(e,t\)\{e=([A-Za-z_$][\w$]*)\(e\),([A-Za-z_$][\w$]*)\.set\(t,e\)\},`vii`\)/g;
const REGISTER = "i.register_for_idb=e=>{";
const CONNECTION_OPEN = "o=a(`sqlite3_open`,`number`,[`string`,`number`])";
const CONNECTION_CLOSE = "s=a(`sqlite3_close_v2`,`number`,[`number`])";
const TRACE = `(()=>{
  let files=0,connections=0;
  const category=path=>{
    if(typeof path!=="string"||!path) return "unnamed file";
    if(path==="db.sqlite"||path.endsWith("/db.sqlite")||path.endsWith("-db.sqlite")) return "main budget database";
    if(path.endsWith("-journal")) return "journal";
    if(path.endsWith("-wal")) return "write-ahead log";
    if(path.endsWith("-shm")) return "shared memory";
    if(/(?:cache|kvcache)/i.test(path)) return "cache file";
    if(/(?:tmp|temp|etilqs_)/i.test(path)) return "temporary filename";
    return "other named file";
  };
  const log=(...args)=>{try{console.info(...args)}catch{}};
  globalThis.__abTraceSqliteOpen=path=>log("[actual-bench sqlite file-open]",++files,category(path));
  globalThis.__abTraceSqliteCall=(call,kind)=>function(...args){
    log("[actual-bench sqlite connection]",++connections,kind,kind==="open"?category(args[0]):"");
    return call.apply(this,args);
  };
  log("[actual-bench sqlite diagnostics] Connection and VFS tracing installed");
})();\n`;
function unique(source: string, marker: string): boolean {
  const index = source.indexOf(marker);
  return index >= 0 && source.indexOf(marker, index + marker.length) < 0;
}
/** Observe only; retain original connection calls and VFS registration. */
export function instrumentSqliteWorker(source: string): string | null {
  const registration = source.indexOf(REGISTER);
  const callbacks = [...source.matchAll(OPEN_CALLBACK)];
  if (callbacks.length !== 1 || ![REGISTER, CONNECTION_OPEN, CONNECTION_CLOSE].every((marker) => unique(source, marker))) return null;
  const [text, decode, files] = callbacks[0];
  const callback = callbacks[0].index;
  if (callback < registration || callback > registration + 600) return null;
  return TRACE + source
    .replace(text, `r=w(function(e,t){e=${decode}(e),globalThis.__abTraceSqliteOpen(e),${files}.set(t,e)},\`vii\`)`)
    .replace(CONNECTION_OPEN, "o=globalThis.__abTraceSqliteCall(a(`sqlite3_open`,`number`,[`string`,`number`]),\"open\")")
    .replace(CONNECTION_CLOSE, "s=globalThis.__abTraceSqliteCall(a(`sqlite3_close_v2`,`number`,[`number`]),\"close\")");
}
/**
 * Decode the known vendor string literal as data; never evaluate vendor code. The bundler names the variable holding the worker
 * source differently from release to release (`I` in 26.10, `F` in 26.11), so it is found by where the Blob uses it, and must
 * be declared exactly once.
 */
export function extractSqliteWorker(bundle: string): { source: string; blobPrefix: string } | null {
  const prefix = "(self.URL || self.webkitURL).revokeObjectURL(self.location.href);";
  const use = new RegExp(`new Blob\\(\\[${JSON.stringify(prefix).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, ([A-Za-z_$][\\w$]*)\\]`).exec(bundle);
  if (!use) return null;
  const marker = `var ${use[1]} = "`;
  const start = bundle.indexOf(marker);
  if (start < 0 || bundle.indexOf(marker, start + marker.length) >= 0 || start > use.index) return null;
  const quote = start + marker.length - 1;
  let end = quote + 1;
  for (; end < bundle.length; end++) {
    if (bundle[end] === "\\") { end++; continue; }
    if (bundle[end] === '"') break;
  }
  // The Blob that uses it follows the declaration directly.
  if (use.index < end + 1 || use.index > end + 250) return null;
  try {
    const source: unknown = JSON.parse(bundle.slice(quote, end + 1).replace(/[\u0000-\u001f]/g, (char) => JSON.stringify(char).slice(1, -1)));
    return typeof source === "string" ? { source, blobPrefix: prefix } : null;
  } catch { return null; }
}
