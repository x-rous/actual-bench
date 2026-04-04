#!/usr/bin/env node
/**
 * Branded startup wrapper for `next start`.
 *
 * Spawns the Next.js production server, pipes its stdout through a line
 * filter that suppresses the default Next.js banner and replaces the
 * "✓ Ready in Xms" line with a single clean branded message. All other
 * output (errors, warnings, request logs) is forwarded unchanged so
 * nothing is silently dropped.
 *
 * Signal forwarding (SIGTERM / SIGINT) ensures Docker stop works correctly.
 */

import { spawn } from "child_process";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));

const version = pkg.version ?? "0.0.0";
const port = process.env.PORT ?? 3000;

// Lines emitted by `next start` on startup that we want to suppress so
// only our single branded line remains.
const SUPPRESS = [
  /▲ Next\.js/,
  /^\s*[-–]\s*(Local|Network):/,
  /^\s*$/,
];

const env = process.env.NODE_ENV ?? "development";

// Only suppress blank lines during startup — after the banner is emitted,
// allow subsequent blank lines through (e.g. request log separators).
let bannerDone = false;

function filterLine(line) {
  // Replace the "ready" line with the branded startup banner
  const readyMatch = line.match(/✓ Ready in (.+)/);
  if (readyMatch) {
    bannerDone = true;
    return [
      "",
      `🚀 Actual Bench v${version}`,
      `   Environment : ${env}`,
      `   Listening on: port ${port}`,
      `   Ready in    : ${readyMatch[1]}`,
      "",
    ].join("\n");
  }

  // Suppress Next.js banner lines (only during startup)
  if (!bannerDone && SUPPRESS.some((re) => re.test(line))) return null;

  return line;
}

const child = spawn("node_modules/.bin/next", ["start"], {
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
});

const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
rl.on("line", (line) => {
  const out = filterLine(line);
  if (out !== null) process.stdout.write(out + "\n");
});

const rlErr = createInterface({ input: child.stderr, crlfDelay: Infinity });
rlErr.on("line", (line) => process.stderr.write(line + "\n"));

// Forward Docker / shell signals so the container stops cleanly
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
