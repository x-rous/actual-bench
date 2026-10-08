import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { extractSqliteWorker, instrumentSqliteWorker } from "@/lib/actual/browser/sqliteWorkerTrace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public dependency code only. No credentials, Actual calls, or budget/app DB access.
let asset: Promise<{ source: string; blobBytes: number; digest: string } | null> | undefined;
function diagnosticAsset() {
  asset ??= (async () => {
    const require = createRequire(join(process.cwd(), "package.json"));
    const bundle = await readFile(join(dirname(require.resolve("@actual-app/api")), "browser.js"), "utf8");
    const worker = extractSqliteWorker(bundle);
    if (!worker) return null;
    const source = instrumentSqliteWorker(worker.source);
    if (!source) return null;
    return { source, blobBytes: Buffer.byteLength(worker.blobPrefix + worker.source), digest: createHash("sha256").update(source).digest("hex") };
  })().catch(() => { asset = undefined; return null; });
  return asset;
}

export async function GET(request: Request) {
  const result = await diagnosticAsset();
  const url = new URL(request.url);
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (url.searchParams.get("metadata") === "1") {
    return Response.json(result ? { available: true, blobBytes: result.blobBytes, digest: result.digest } : { available: false }, { headers });
  }
  if (!result || url.searchParams.get("digest") !== result.digest) return new Response("Diagnostic worker unavailable", { status: 503, headers });
  return new Response(result.source, { headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8" } });
}
