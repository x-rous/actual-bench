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
 * The port Bench tries first. A stable port matters because the browser
 * keeps Bench's local settings (theme, layout) per origin, and the port is
 * part of the origin: a new port each launch would forget them. The port that
 * worked is remembered (see `main.cjs`) and tried first next time.
 */
const PREFERRED_PORT = 47806;
const PORT_ATTEMPTS = 20;
const HEALTH_TIMEOUT_MS = 90_000;
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

/**
 * Binds and releases a port. Resolves `{ port }` with the port actually bound
 * (port 0 asks the OS for a free one), or `{ error }` with the error code.
 * On Windows, Hyper-V, WSL2 and Docker reserve ranges of ports; binding one
 * fails with EACCES even though nothing is listening on it.
 */
function tryPort(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => resolve({ error: error.code || error.message }));
    server.listen({ port, host, exclusive: true }, () => {
      const bound = server.address().port;
      server.close(() => resolve({ port: bound }));
    });
  });
}

function validPort(value) {
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : null;
}

/**
 * The port for Bench's server: the one that worked last time, else the
 * preferred range, else any free port the OS picks. Throws only when even
 * the OS can't provide one.
 */
async function findFreePort({
  host = "127.0.0.1",
  remembered = null,
  preferred = PREFERRED_PORT,
  attempts = PORT_ATTEMPTS,
  probe = tryPort,
} = {}) {
  const candidates = [];
  if (validPort(remembered)) candidates.push(remembered);
  for (let offset = 0; offset < attempts; offset += 1) {
    if (!candidates.includes(preferred + offset)) candidates.push(preferred + offset);
  }
  const failures = new Map();
  for (const port of candidates) {
    const result = await probe(port, host);
    if (result.port) return result.port;
    failures.set(result.error, (failures.get(result.error) || 0) + 1);
  }
  const fallback = await probe(0, host);
  if (fallback.port) return fallback.port;
  const summary = [...failures].map(([code, count]) => `${code} x${count}`).join(", ");
  throw new Error(
    `Could not open a port on ${host}: ports ${preferred}-${preferred + attempts - 1} failed (${summary}), ` +
      `and the system gave no free port (${fallback.error}).`
  );
}

/** The port remembered in `file`, or null. */
function readRememberedPort(file) {
  try {
    return validPort(JSON.parse(fs.readFileSync(file, "utf8")).port);
  } catch {
    return null;
  }
}

/** Remembers the port Bench used; a failure only costs the next launch a new port. */
function rememberPort(file, port) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ port })}\n`);
  } catch {
    // Not critical.
  }
}

/**
 * Appends to `server.log`, moving a large one to `server.log.1` first.
 *
 * Returns a writer that never throws: a log that can't be opened or written
 * (read-only file, full disk) reports asynchronously, and an unhandled stream
 * error would crash the app. Logging then stops; the server keeps running.
 */
function openServerLog(logDir, { createWriteStream = fs.createWriteStream } = {}) {
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, "server.log");
  try {
    if (fs.statSync(file).size > LOG_ROTATE_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // No log yet.
  }
  let broken = false;
  const stream = createWriteStream(file, { flags: "a" });
  stream.on("error", (error) => {
    if (broken) return;
    broken = true;
    console.error(`Actual Bench: cannot write ${file}: ${error.message}`);
  });
  const log = {
    write(chunk) {
      if (!broken) stream.write(chunk);
    },
  };
  return { file, stream: log };
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
  // A runtime that can't be started reports here, maybe without any `exit`.
  // Listening also keeps it from becoming an uncaught exception.
  child.on("error", (error) => {
    log.write(`[${stamp()}] server process error: ${error.message}\n`);
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
      child.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onExit = (code) => finish(new Error(`The Actual Bench server stopped while starting (exit code ${code}).`));
    const onError = (error) => finish(new Error(`The Actual Bench server could not be started: ${error.message}`));
    child.once("exit", onExit);
    child.once("error", onError);
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
  readRememberedPort,
  rememberPort,
  openServerLog,
  serverEnv,
  startServer,
  stopServer,
  waitForHealth,
};
