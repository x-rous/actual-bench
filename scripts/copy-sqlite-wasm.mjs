#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(
  root,
  "node_modules",
  "@sqlite.org",
  "sqlite-wasm",
  "sqlite-wasm",
  "jswasm",
  "sqlite3.wasm"
);
const destination = join(root, "public", "sqlite", "sqlite3.wasm");

if (!existsSync(source)) {
  throw new Error(`SQLite WASM asset not found: ${source}`);
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`Copied SQLite WASM asset to ${destination}`);
