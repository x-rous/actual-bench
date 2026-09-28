#!/usr/bin/env node

/**
 * Copies PDF.js's support data into `public/pdfjs/`, from the installed
 * package, so the app serves it from its own origin:
 *
 * - `cmaps/`: Adobe's predefined character maps. Without them a statement
 *   whose fonts use one (common in Chinese, Japanese and Korean PDFs) cannot
 *   have its text read at all.
 * - `standard_fonts/`: the standard 14 fonts, for PDFs that do not embed
 *   Helvetica or Times, so previews do not fall back to substitutes.
 * - `wasm/`: JPEG 2000 and JBIG2 image decoders and the colour-management
 *   module, for previews. `quickjs-eval.*` is left out: it only runs a PDF's
 *   own JavaScript, and scripting stays off.
 * - `iccs/`: the colour profile used for CMYK images.
 *
 * The folder is replaced on every run, so a dependency update never leaves
 * files from another PDF.js version mixed in, and `VERSION` records which
 * package it came from.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const packageJson = require.resolve("pdfjs-dist/package.json");
const packageRoot = dirname(packageJson);
const { version } = JSON.parse(readFileSync(packageJson, "utf8"));
const destination = join(root, "public", "pdfjs");
const folders = ["cmaps", "standard_fonts", "wasm", "iccs"];

const missing = folders.filter((folder) => !existsSync(join(packageRoot, folder)));
if (missing.length) {
  throw new Error(`pdfjs-dist ${version} is missing ${missing.join(", ")} in ${packageRoot}.`);
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
for (const folder of folders) {
  cpSync(join(packageRoot, folder), join(destination, folder), {
    recursive: true,
    filter: (source) => !/quickjs-eval\.(?:js|wasm)$/.test(source),
  });
}
writeFileSync(join(destination, "VERSION"), `${version}\n`);
console.log(`Copied PDF.js ${version} support assets to ${destination}`);
