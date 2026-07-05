import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { NextResponse } from "next/server";
import { DIRECT_MODE_HEADERS, isDirectBrowserApiEnabled } from "@/lib/directMode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    assetPath?: string[];
  }>;
};

const CACHE_CONTROL = "public, max-age=86400, must-revalidate";

const WORKER_CLONE_GUARD = `
(() => {
  const scope = self;
  const nativePostMessage = scope.postMessage.bind(scope);

  function cloneSafe(value, seen = new WeakMap()) {
    if (typeof value === "function") return undefined;
    if (typeof value === "bigint") return String(value);
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return String(value);
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (ArrayBuffer.isView(value)) return new value.constructor(value);
    if (value instanceof Map) {
      return Array.from(value.entries()).map(([key, item]) => [
        cloneSafe(key, seen),
        cloneSafe(item, seen),
      ]);
    }
    if (value instanceof Set) {
      return Array.from(value.values()).map((item) => cloneSafe(item, seen));
    }
    if (Array.isArray(value)) return value.map((item) => cloneSafe(item, seen));
    if (value && typeof value === "object") {
      if (seen.has(value)) return seen.get(value);

      const output = {};
      seen.set(value, output);

      for (const [key, item] of Object.entries(value)) {
        const safeItem = cloneSafe(item, seen);
        if (safeItem !== undefined) output[key] = safeItem;
      }
      return output;
    }
    return value;
  }

  function safePostMessage(message, transfer) {
    try {
      if (transfer === undefined) {
        nativePostMessage(message);
      } else {
        nativePostMessage(message, transfer);
      }
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "DataCloneError") {
        throw error;
      }

      nativePostMessage(cloneSafe(message));
    }
  }

  try {
    Object.defineProperty(scope, "postMessage", {
      configurable: true,
      value: safePostMessage,
      writable: true,
    });
  } catch {
    scope.postMessage = safePostMessage;
  }

  const scopePrototype = Object.getPrototypeOf(scope);
  if (scopePrototype?.postMessage) {
    try {
      Object.defineProperty(scopePrototype, "postMessage", {
        configurable: true,
        value: safePostMessage,
        writable: true,
      });
    } catch {}
  }
})();
`;

function contentTypeFor(pathname: string): string {
  switch (extname(pathname)) {
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".sqlite":
    case ".data":
      return "application/octet-stream";
    case ".txt":
    case ".sql":
      return "text/plain; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

const STATIC_ASSET_PATHS = new Map([
  [
    "worker.js",
    join(
      /*turbopackIgnore: true*/ process.cwd(),
      "node_modules",
      "@actual-app",
      "api",
      "dist",
      "worker.js"
    ),
  ],
  [
    "worker.js.map",
    join(
      /*turbopackIgnore: true*/ process.cwd(),
      "node_modules",
      "@actual-app",
      "api",
      "dist",
      "worker.js.map"
    ),
  ],
  [
    "sql-wasm.wasm",
    join(
      /*turbopackIgnore: true*/ process.cwd(),
      "node_modules",
      "@actual-app",
      "api",
      "dist",
      "sql-wasm.wasm"
    ),
  ],
  [
    "data-file-index.txt",
    join(
      /*turbopackIgnore: true*/ process.cwd(),
      "node_modules",
      "@actual-app",
      "api",
      "dist",
      "data-file-index.txt"
    ),
  ],
]);

function isUnsafePathPart(part: string): boolean {
  return (
    part === "" ||
    part === "." ||
    part === ".." ||
    part.includes("\0") ||
    part.includes("/") ||
    part.includes("\\")
  );
}

function resolveAssetPath(parts: string[]): string | null {
  if (parts.length === 0 || parts.some(isUnsafePathPart)) return null;

  const assetPath = parts.join("/");
  const staticFilePath = STATIC_ASSET_PATHS.get(assetPath);
  if (staticFilePath) return staticFilePath;

  if (parts[0] !== "data" || parts.length === 1) return null;

  return join(
    /*turbopackIgnore: true*/ process.cwd(),
    "node_modules",
    "@actual-app",
    "api",
    "dist",
    "data",
    ...parts.slice(1)
  );
}

function etagFor(body: string | Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body));
  return '"sha256-' + hash.digest("base64url") + '"';
}

function responseHeaders(filePath: string, etag: string): Record<string, string> {
  return {
    ...DIRECT_MODE_HEADERS,
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": CACHE_CONTROL,
    ETag: etag,
  };
}

export async function GET(request: Request, context: RouteContext) {
  if (!isDirectBrowserApiEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const params = await context.params;
  const assetPath = params.assetPath ?? [];
  const filePath = resolveAssetPath(assetPath);

  if (!filePath) {
    return new NextResponse(null, { status: 404, headers: DIRECT_MODE_HEADERS });
  }

  try {
    const body = await readFile(filePath);
    const responseBody =
      assetPath.join("/") === "worker.js"
        ? WORKER_CLONE_GUARD + body.toString("utf8")
        : new Uint8Array(body);
    const etag = etagFor(responseBody);
    const headers = responseHeaders(filePath, etag);

    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers });
    }

    return new NextResponse(responseBody, { headers });
  } catch {
    return new NextResponse(null, { status: 404, headers: DIRECT_MODE_HEADERS });
  }
}
