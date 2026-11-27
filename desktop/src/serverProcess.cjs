"use strict";

/**
 * Runs the Actual Bench server (the Next.js standalone build) as a child
 * process on a bundled Node runtime, bound to 127.0.0.1 only.
 *
 * Why a bundled Node and not Electron's own: the server then runs on exactly
 * the Node version the Docker image uses (`.nvmrc`), and `better-sqlite3`'s
 * prebuilt binary for that Node works as-is, with no rebuild for Electron's ABI.
 */

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

/**
 * The port Bench tries first. Fixed rather than random because the browser
 * keeps Bench's local settings (theme, layout) per origin, and the port is
 * part of the origin: a new port each launch would forget them.
 */
const PREFERRED_PORT = 47806;
const PORT_ATTEMPTS = 20;
const HEALTH_TIMEOUT_MS = 90_000;
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

function isPortFree(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** The preferred port, or the next free one after it. */
async function findFreePort({ host = "127.0.0.1", preferred = PREFERRED_PORT, attempts = PORT_ATTEMPTS, isFree = isPortFree } = {}) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = preferred + offset;
    if (await isFree(port, host)) return port;
  }
  throw new Error(`No free port between ${preferred} and ${preferred + attempts - 1} on ${host}.`);
}

/** Appends to `server.log`, moving a large one to `server.log.1` first. */
function openServerLog(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, "server.log");
  try {
    if (fs.statSync(file).size > LOG_ROTATE_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // No log yet.
  }
  return { file, stream: fs.createWriteStream(file, { flags: "a" }) };
}

/**
 * The environment the server runs with. Electron's own variables are left out
 * so the bundled Node is plain Node.
 */
function serverEnv({ baseEnv, port, dataDir, extra = {} }) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (key.startsWith("ELECTRON_")) continue;
    env[key] = value;
  }
  return {
    ...env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    ACTUAL_BENCH_DB_PATH: path.join(dataDir, "actual-bench.sqlite"),
    ...extra,
  };
}

/** Starts the server and returns the child process. Output goes to the log. */
function startServer({ nodePath, serverDir, env, log }) {
  const child = spawn(nodePath, [path.join(serverDir, "server.js")], {
    cwd: serverDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stamp = () => new Date().toISOString();
  log.write(`\n[${stamp()}] starting Actual Bench server on port ${env.PORT}\n`);
  child.stdout.on("data", (chunk) => log.write(chunk));
  child.stderr.on("data", (chunk) => log.write(chunk));
  child.on("exit", (code, signal) => {
    log.write(`[${stamp()}] server exited (code ${code}, signal ${signal})\n`);
  });
  return child;
}

/**
 * Resolves once `/api/health` answers OK. Rejects when the server exits first
 * or the timeout passes.
 */
function waitForHealth({ baseUrl, child, timeoutMs = HEALTH_TIMEOUT_MS, intervalMs = 250, fetchImpl = fetch }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const onExit = (code) => finish(new Error(`The Actual Bench server stopped while starting (exit code ${code}).`));
    child.once("exit", onExit);
    const timer = setTimeout(
      () => finish(new Error(`The Actual Bench server did not start within ${Math.round(timeoutMs / 1000)} seconds.`)),
      timeoutMs
    );

    const poll = async () => {
      if (settled) return;
      try {
        const response = await fetchImpl(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
        if (response.ok) return finish();
      } catch {
        // Not listening yet.
      }
      setTimeout(poll, intervalMs);
    };
    void poll();
  });
}

/** Stops the server; resolves once it has exited (or after a grace period). */
function stopServer(child, graceMs = 5_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, graceMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

module.exports = {
  PREFERRED_PORT,
  findFreePort,
  openServerLog,
  serverEnv,
  startServer,
  stopServer,
  waitForHealth,
};
