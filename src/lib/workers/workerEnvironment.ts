import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Give a worker thread the environment Next's own server sets up before
 * loading anything else. Imported **first** by `bench.worker.ts`.
 *
 * Next compiles the worker as server code, and some of what it includes -
 * Next's vendored server React, reached through modules that import React -
 * captures `globalThis.AsyncLocalStorage` *when it loads*. Next's server
 * process sets that global at startup (`next/dist/server/node-environment-
 * baseline.js`); a worker thread starts with a fresh global, so without this
 * those modules fall back to a stand-in that throws "AsyncLocalStorage
 * accessed in runtime where it is not available" the first time a job runs.
 * This does exactly what Next does, and nothing more.
 */
const holder = globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage };
if (typeof holder.AsyncLocalStorage !== "function") {
  holder.AsyncLocalStorage = AsyncLocalStorage;
}
