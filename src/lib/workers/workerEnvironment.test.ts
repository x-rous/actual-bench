/**
 * @jest-environment node
 */
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A worker thread starts without the `globalThis.AsyncLocalStorage` Next's
 * server sets up, and Next's fetch tracing throws without it (the first real
 * worker run failed exactly so). The environment module must provide it, and
 * must not replace one that is already there.
 */
describe("worker environment", () => {
  const holder = globalThis as { AsyncLocalStorage?: unknown };
  const original = holder.AsyncLocalStorage;

  afterEach(() => {
    holder.AsyncLocalStorage = original;
    jest.resetModules();
  });

  it("provides AsyncLocalStorage when the thread has none", async () => {
    delete holder.AsyncLocalStorage;
    await jest.isolateModulesAsync(async () => {
      await import("./workerEnvironment");
    });
    expect(holder.AsyncLocalStorage).toBe(AsyncLocalStorage);
  });

  it("leaves an existing one alone", async () => {
    const existing = class {};
    holder.AsyncLocalStorage = existing;
    await jest.isolateModulesAsync(async () => {
      await import("./workerEnvironment");
    });
    expect(holder.AsyncLocalStorage).toBe(existing);
  });
});
