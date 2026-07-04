import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    assetPath?: string[];
  }>;
};

const API_DIST_DIR = resolve(process.cwd(), "node_modules/@actual-app/api/dist");

const ASSET_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const WORKER_CLONE_GUARD = "\n(() => {\n  const scope = self;\n  const nativePostMessage = scope.postMessage.bind(scope);\n\n  function cloneSafe(value, seen = new WeakMap()) {\n    if (typeof value === \"function\") return undefined;\n    if (typeof value === \"bigint\") return String(value);\n    if (value instanceof Error) {\n      return { name: value.name, message: value.message, stack: value.stack };\n    }\n    if (value instanceof Date) return value.toISOString();\n    if (value instanceof RegExp) return String(value);\n    if (value instanceof ArrayBuffer) return value.slice(0);\n    if (ArrayBuffer.isView(value)) return new value.constructor(value);\n    if (value instanceof Map) {\n      return Array.from(value.entries()).map(([key, item]) => [\n        cloneSafe(key, seen),\n        cloneSafe(item, seen),\n      ]);\n    }\n    if (value instanceof Set) {\n      return Array.from(value.values()).map((item) => cloneSafe(item, seen));\n    }\n    if (Array.isArray(value)) return value.map((item) => cloneSafe(item, seen));\n    if (value && typeof value === \"object\") {\n      if (seen.has(value)) return seen.get(value);\n\n      const output = {};\n      seen.set(value, output);\n\n      for (const [key, item] of Object.entries(value)) {\n        const safeItem = cloneSafe(item, seen);\n        if (safeItem !== undefined) output[key] = safeItem;\n      }\n      return output;\n    }\n    return value;\n  }\n\n  function safePostMessage(message, transfer) {\n    try {\n      if (transfer === undefined) {\n        nativePostMessage(message);\n      } else {\n        nativePostMessage(message, transfer);\n      }\n    } catch (error) {\n      if (!(error instanceof DOMException) || error.name !== \"DataCloneError\") {\n        throw error;\n      }\n\n      nativePostMessage(cloneSafe(message));\n    }\n  }\n\n  try {\n    Object.defineProperty(scope, \"postMessage\", {\n      configurable: true,\n      value: safePostMessage,\n      writable: true,\n    });\n  } catch {\n    scope.postMessage = safePostMessage;\n  }\n\n  const scopePrototype = Object.getPrototypeOf(scope);\n  if (scopePrototype?.postMessage) {\n    try {\n      Object.defineProperty(scopePrototype, \"postMessage\", {\n        configurable: true,\n        value: safePostMessage,\n        writable: true,\n      });\n    } catch {}\n  }\n})();\n";


function isDirectBrowserApiDisabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off";
}

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

function isAllowedAsset(assetPath: string): boolean {
  return (
    assetPath === "worker.js" ||
    assetPath === "worker.js.map" ||
    assetPath === "sql-wasm.wasm" ||
    assetPath === "data-file-index.txt" ||
    assetPath.startsWith("data/")
  );
}

function resolveAssetPath(parts: string[]): string | null {
  if (parts.length === 0) return null;
  if (parts.some((part) => part === ".." || part.includes("\0"))) return null;

  const assetPath = parts.join("/");
  if (!isAllowedAsset(assetPath)) return null;

  const filePath = resolve(API_DIST_DIR, ...parts);
  if (filePath !== API_DIST_DIR && !filePath.startsWith(API_DIST_DIR + sep)) {
    return null;
  }

  return filePath;
}

export async function GET(_request: Request, context: RouteContext) {
  const enabled =
    !isDirectBrowserApiDisabled(process.env["DIRECT_BROWSER_API"]) &&
    !isDirectBrowserApiDisabled(process.env["NEXT_PUBLIC_DIRECT_BROWSER_API"]);

  if (!enabled) {
    return new NextResponse(null, { status: 404, headers: ASSET_HEADERS });
  }

  const params = await context.params;
  const assetPath = params.assetPath ?? [];
  const filePath = resolveAssetPath(assetPath);

  if (!filePath) {
    return new NextResponse(null, { status: 404, headers: ASSET_HEADERS });
  }

  try {
    const body = await readFile(filePath);
    const responseBody =
      assetPath.join("/") === "worker.js"
        ? WORKER_CLONE_GUARD + body.toString("utf8")
        : new Uint8Array(body);

    return new NextResponse(responseBody, {
      headers: {
        ...ASSET_HEADERS,
        "Content-Type": contentTypeFor(filePath),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404, headers: ASSET_HEADERS });
  }
}
