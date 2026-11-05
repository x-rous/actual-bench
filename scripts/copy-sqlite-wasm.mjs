#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("@sqlite.org/sqlite-wasm/package.json"));
const sourceCandidates = [
  join(packageRoot, "sqlite-wasm", "jswasm", "sqlite3.wasm"),
  join(packageRoot, "dist", "sqlite3.wasm"),
];
const source = sourceCandidates.find((candidate) => existsSync(candidate));
const destination = join(root, "public", "sqlite", "sqlite3.wasm");
// The JavaScript that starts SQLite is served as a static file too, and loaded by the diagnostics worker when it runs, as the WASM is.
// Bundling it is not an option: the package starts its OPFS support with a worker whose address is worked out at run time, which
// Turbopack cannot follow, and the production build stops on it. OPFS is not used here. It is one self-contained file.
const moduleSource = join(packageRoot, "dist", "index.mjs");
const moduleDestination = join(root, "public", "sqlite", "sqlite3.mjs");

if (!source) {
  throw new Error(
    `SQLite WASM asset not found. Checked:\n${sourceCandidates.join("\n")}`
  );
}

if (!existsSync(moduleSource)) {
  throw new Error(`SQLite WASM module not found: ${moduleSource}`);
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
copyFileSync(moduleSource, moduleDestination);
console.log(`Copied SQLite WASM asset to ${destination}`);
console.log(`Copied SQLite WASM module to ${moduleDestination}`);
