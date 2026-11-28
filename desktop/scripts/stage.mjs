#!/usr/bin/env node
/**
 * Stages what the desktop app ships, into desktop/.stage/:
 *
 *   server/   the Actual Bench Next.js standalone build, with its static files
 *   runtime/  the Node binary that runs it (this script's own Node)
 *
 * The build runs on a clean copy of the repository: only the files git would
 * check out (`git ls-files`, tracked plus untracked-but-not-ignored). Next's
 * file tracing copies much of the project into the standalone output, so a
 * build in a working copy would ship gitignored files such as `agents/` and
 * `.env.local`. CI builds from a clean checkout anyway; this makes a local
 * build ship the same thing.
 *
 * The bundled Node must be the version in .nvmrc: `better-sqlite3`'s binary is
 * installed for the Node that runs `npm ci` here, which is this one.
 *
 * Usage: node scripts/stage.mjs [--allow-node-mismatch]
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopDir, "..");
const stageDir = join(desktopDir, ".stage");
const allowNodeMismatch = process.argv.includes("--allow-node-mismatch");
const isWindows = process.platform === "win32";

/** Separate packages with their own installs; the Bench build never needs them. */
const EXCLUDED_DIRS = ["desktop/", "docs-site/"];

function log(message) {
  console.log(`[stage] ${message}`);
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", shell: isWindows, ...options });
}

function checkNodeVersion() {
  const wanted = readFileSync(join(repoRoot, ".nvmrc"), "utf8").trim().replace(/^v/, "");
  const actual = process.version.replace(/^v/, "");
  if (wanted === actual) return;
  const message = `Node ${actual} is running this script, but .nvmrc pins ${wanted}. The app would ship Node ${actual}.`;
  if (allowNodeMismatch) {
    log(`warning: ${message}`);
    return;
  }
  throw new Error(`${message} Use Node ${wanted}, or pass --allow-node-mismatch for a local test build.`);
}

function exportCleanTree() {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean)
    .filter((file) => !EXCLUDED_DIRS.some((dir) => file.startsWith(dir)))
    // A file deleted in the working tree is still listed until it is staged.
    .filter((file) => existsSync(join(repoRoot, file)));

  const buildDir = mkdtempSync(join(tmpdir(), "actual-bench-desktop-"));
  for (const file of files) {
    const target = join(buildDir, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(repoRoot, file), target, { dereference: false });
  }
  log(`copied ${files.length} files to ${buildDir}`);
  return buildDir;
}

/**
 * Replaces every symlink with a real copy of its target. Turbopack aliases
 * external packages (`.next-build/node_modules/better-sqlite3-<hash>`) with
 * relative symlinks into `node_modules`; installers do not carry symlinks
 * reliably (Windows needs a privilege to create them).
 */
function materializeSymlinks(root, dir = root) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = resolve(dirname(path), readlinkSync(path));
      if (relative(root, target).startsWith("..")) {
        throw new Error(`Symlink ${relative(root, path)} points outside the bundle (${target}).`);
      }
      unlinkSync(path);
      cpSync(target, path, { recursive: true, dereference: true });
    } else if (entry.isDirectory()) {
      materializeSymlinks(root, path);
    }
  }
}

/** Files that must never ship, wherever the trace put them (node_modules aside). */
function findForbidden(dir, root = dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(root, path).split(sep).join("/");
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      if (["agents", "secrets", ".git", ".claude"].includes(entry.name)) found.push(`${rel}/`);
      else findForbidden(path, root, found);
      continue;
    }
    if (/^\.env(\..*)?$/.test(entry.name) && entry.name !== ".env.example") found.push(rel);
    if (/\.(sqlite|sqlite3|db)(-wal|-shm)?$/.test(entry.name) && !rel.startsWith("demo/")) found.push(rel);
    if (entry.name === "vault.key") found.push(rel);
  }
  return found;
}

function stage(buildDir) {
  const distDir = join(buildDir, ".next-build");
  const standalone = join(distDir, "standalone");
  if (!existsSync(join(standalone, "server.js"))) {
    throw new Error(`No standalone build at ${standalone}. Did \`next build\` succeed?`);
  }

  rmSync(stageDir, { recursive: true, force: true });
  const serverDir = join(stageDir, "server");
  cpSync(standalone, serverDir, { recursive: true, verbatimSymlinks: true });
  materializeSymlinks(serverDir);
  cpSync(join(distDir, "static"), join(serverDir, ".next-build", "static"), { recursive: true });
  cpSync(join(buildDir, "public"), join(serverDir, "public"), { recursive: true });

  // The demo seed is for the hosted demo image only.
  rmSync(join(serverDir, "demo"), { recursive: true, force: true });

  const forbidden = findForbidden(serverDir);
  if (forbidden.length > 0) {
    throw new Error(`Refusing to stage: the server bundle contains private files:\n  ${forbidden.join("\n  ")}`);
  }

  // better-sqlite3 ships one prebuilt binary per platform; Next's trace keeps
  // those for this machine's CPU, so each OS/CPU is built on its own runner.
  const target = `${process.platform}-${process.arch}`;
  const nativeModule = join(serverDir, "node_modules", "better-sqlite3", "prebuilds", `${target}.node`);
  if (!existsSync(nativeModule)) {
    throw new Error(`better-sqlite3's binary for ${target} is missing from the bundle (${nativeModule}).`);
  }

  const runtimeDir = join(stageDir, "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const nodeName = isWindows ? "node.exe" : "node";
  cpSync(process.execPath, join(runtimeDir, nodeName));
  log(`bundled Node ${process.version} from ${process.execPath}`);
}

function sizeOf(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? sizeOf(path) : statSync(path).size;
  }
  return total;
}

checkNodeVersion();
const buildDir = exportCleanTree();
try {
  log("installing dependencies (npm ci)");
  run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: buildDir });
  log("building Actual Bench (npm run build)");
  run("npm", ["run", "build"], {
    cwd: buildDir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ACTUAL_BENCH_DIST_DIR: ".next-build" },
  });
  stage(buildDir);
  log(`staged ${(sizeOf(stageDir) / 1024 / 1024).toFixed(0)} MB in ${relative(process.cwd(), stageDir) || basename(stageDir)}`);
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}
