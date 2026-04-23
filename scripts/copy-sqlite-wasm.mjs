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

if (!source) {
  throw new Error(
    `SQLite WASM asset not found. Checked:\n${sourceCandidates.join("\n")}`
  );
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`Copied SQLite WASM asset to ${destination}`);
