"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { findFreePort, openServerLog, serverEnv, waitForHealth } = require("./serverProcess.cjs");

test("findFreePort skips a busy port", async () => {
  const busy = net.createServer();
  await new Promise((resolve) => busy.listen(0, "127.0.0.1", resolve));
  const { port } = busy.address();
  try {
    const found = await findFreePort({ preferred: port, attempts: 5 });
    assert.ok(found > port && found < port + 5);
  } finally {
    busy.close();
  }
});

test("findFreePort gives up after its attempts", async () => {
  await assert.rejects(findFreePort({ preferred: 6000, attempts: 3, isFree: async () => false }), /No free port/);
});

test("serverEnv binds to loopback, sets the database path and drops Electron variables", () => {
  const env = serverEnv({
    baseEnv: { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1", HOSTNAME: "0.0.0.0" },
    port: 47806,
    dataDir: "/data-dir",
    extra: { ACTUAL_BENCH_DESKTOP: "1" },
  });
  assert.equal(env.HOSTNAME, "127.0.0.1");
  assert.equal(env.PORT, "47806");
  assert.equal(env.NODE_ENV, "production");
  assert.match(env.ACTUAL_BENCH_DB_PATH, /actual-bench\.sqlite$/);
  assert.equal(env.ACTUAL_BENCH_DESKTOP, "1");
  assert.equal(env.PATH, "/bin");
  assert.equal("ELECTRON_RUN_AS_NODE" in env, false);
});

test("waitForHealth resolves once the health check answers", async () => {
  let calls = 0;
  const fetchImpl = async () => ({ ok: ++calls >= 3 });
  await waitForHealth({ baseUrl: "http://x", child: new EventEmitter(), intervalMs: 1, fetchImpl });
  assert.equal(calls, 3);
});

test("waitForHealth fails when the server exits first", async () => {
  const child = new EventEmitter();
  const pending = waitForHealth({ baseUrl: "http://x", child, intervalMs: 5, fetchImpl: async () => ({ ok: false }) });
  child.emit("exit", 1);
  await assert.rejects(pending, /stopped while starting \(exit code 1\)/);
});

test("waitForHealth fails at once when the server can't be launched", async () => {
  const child = new EventEmitter();
  const pending = waitForHealth({ baseUrl: "http://x", child, intervalMs: 5, fetchImpl: async () => ({ ok: false }) });
  child.emit("error", new Error("spawn EACCES"));
  await assert.rejects(pending, /could not be started: spawn EACCES/);
});

test("openServerLog survives a log it can't write", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-log-"));
  const failing = new EventEmitter();
  failing.write = () => true;
  const { stream } = openServerLog(dir, { createWriteStream: () => failing });
  const originalError = console.error;
  console.error = () => {};
  try {
    failing.emit("error", new Error("EACCES"));
    assert.doesNotThrow(() => stream.write("after the error\n"));
  } finally {
    console.error = originalError;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
