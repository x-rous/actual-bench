/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextResponse } from "next/server";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { releaseServerLease, tryAcquireServerLease } from "@/lib/app-db/serverLeaseRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { getServerRequestGate } from "./serverRequestGate";
import { ServerBusyError, queueServerRequest, __internals } from "./serverQueue";

const connection = (budgetSyncId?: string) => ({
  baseUrl: "http://example.test",
  apiKey: "key",
  budgetSyncId,
});

type LeaseEvent = { kind: "acquire" | "release"; holder: string };

/** The real lease store on a temp database, recording what it was asked to do. */
function recordingStore(db: SqliteDatabase, events: LeaseEvent[] = []) {
  return () => ({
    acquire(serverKey: string, holder: string, ttlMs: number, nowMs: number) {
      const acquired = tryAcquireServerLease(db, { serverKey, holder, ttlMs, nowMs });
      if (acquired) events.push({ kind: "acquire", holder });
      return acquired;
    },
    release(serverKey: string, holder: string) {
      events.push({ kind: "release", holder });
      releaseServerLease(db, { serverKey, holder });
    },
  });
}

describe("queueServerRequest", () => {
  let root: string;
  let db: SqliteDatabase;

  beforeEach(() => {
    __internals.resetQueueState();
    root = mkdtempSync(join(tmpdir(), "actual-bench-queue-db-"));
    db = getAppDb(join(root, "metadata.sqlite"));
    __internals.setLeaseStoreFactory(recordingStore(db));
    jest.restoreAllMocks();
  });
  afterEach(() => {
    __internals.resetQueueState();
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("serializes requests against the same baseUrl", async () => {
    const order: string[] = [];
    const make = (id: string, delay: number) => () =>
      new Promise<NextResponse>((resolve) => {
        setTimeout(() => {
          order.push(id);
          resolve(NextResponse.json({ id }, { status: 200 }));
        }, delay);
      });

    // Kick off second request while first is still running. If the queue is
    // honored, "second" must land after "first" even though its own delay
    // is shorter.
    const first = queueServerRequest(connection(), "r1", make("first", 40));
    const second = queueServerRequest(connection(), "r2", make("second", 5));

    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("serializes requests when baseUrl only differs by a trailing slash", async () => {
    const order: string[] = [];
    const make = (id: string, delay: number) => () =>
      new Promise<NextResponse>((resolve) => {
        setTimeout(() => {
          order.push(id);
          resolve(NextResponse.json({ id }, { status: 200 }));
        }, delay);
      });

    const first = queueServerRequest(connection(), "r1", make("first", 40));
    const second = queueServerRequest(
      { ...connection(), baseUrl: "http://example.test/" },
      "r2",
      make("second", 5)
    );

    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("runs requests for different baseUrls in parallel", async () => {
    const order: string[] = [];
    const resolveA = (id: string, delay: number) => () =>
      new Promise<NextResponse>((resolve) => {
        setTimeout(() => {
          order.push(id);
          resolve(NextResponse.json({ id }, { status: 200 }));
        }, delay);
      });

    const a = queueServerRequest(
      { baseUrl: "http://a.test", apiKey: "k" },
      "r1",
      resolveA("a", 30)
    );
    const b = queueServerRequest(
      { baseUrl: "http://b.test", apiKey: "k" },
      "r2",
      resolveA("b", 5)
    );

    await Promise.all([a, b]);
    // b was on a different server and had a shorter delay — must finish first.
    expect(order).toEqual(["b", "a"]);
  });

  it("attempts a budget close after a 5xx response when budgetSyncId is set", async () => {
    const closeSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await queueServerRequest(connection("budget/1?x=#"), "r1", async () =>
      NextResponse.json({ error: "boom" }, { status: 500 })
    );
    // Wait a tick for the tail promise to run the side-effect.
    await new Promise((r) => setTimeout(r, 0));

    expect(closeSpy).toHaveBeenCalledWith(
      "http://example.test/v1/budgets/budget%2F1%3Fx%3D%23",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("does not attempt a budget close on 5xx when no budgetSyncId is set", async () => {
    const closeSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await queueServerRequest(connection(), "r1", async () =>
      NextResponse.json({ error: "boom" }, { status: 500 })
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("cleans its entry from the queue map once the tail settles", async () => {
    await queueServerRequest(connection(), "r1", async () =>
      NextResponse.json({ ok: true }, { status: 200 })
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(__internals.serverQueueTails.size).toBe(0);
  });

  it("keeps the chain alive even when an operation rejects", async () => {
    const order: string[] = [];
    const rejecting = queueServerRequest(connection(), "r1", async () => {
      order.push("reject");
      throw new Error("upstream failed");
    }).catch(() => {
      order.push("caught");
    });

    const following = queueServerRequest(connection(), "r2", async () => {
      order.push("next");
      return NextResponse.json({ ok: true }, { status: 200 });
    });

    await Promise.all([rejecting, following]);
    expect(order).toEqual(["reject", "caught", "next"]);
  });

  it("installs itself as the gate the browser-safe client reaches it through", () => {
    expect(getServerRequestGate()).toBe(queueServerRequest);
  });

  it("keeps two realms that do not share the queue apart through the lease row", async () => {
    // Realm A - the web server, say - starts a slow request.
    const spans: Record<string, { start: number; end: number }> = {};
    const timed = (id: string, delay: number) => async () => {
      spans[id] = { start: Date.now(), end: 0 };
      await new Promise((r) => setTimeout(r, delay));
      spans[id].end = Date.now();
      return NextResponse.json({ id }, { status: 200 });
    };
    const first = queueServerRequest(connection(), "a", timed("a", 80));

    // Realm B - a worker thread, say - has its own empty in-memory queue but
    // the same database. Without the lease it would start immediately.
    __internals.resetQueueState();
    __internals.setLeaseStoreFactory(recordingStore(db));
    const second = queueServerRequest(connection(), "b", timed("b", 5));

    await Promise.all([first, second]);
    expect(spans.b.start).toBeGreaterThanOrEqual(spans.a.end);
  });

  it("gives up with ServerBusyError, without touching the budget, when another realm holds on too long", async () => {
    const closeSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    // Another realm holds the server well beyond this request's wait.
    tryAcquireServerLease(db, { serverKey: "http://example.test", holder: "elsewhere", ttlMs: 60_000, nowMs: Date.now() });
    __internals.setLeaseWaitMs(60);
    const operation = jest.fn(async () => NextResponse.json({ ok: true }, { status: 200 }));

    await expect(queueServerRequest(connection("budget-1"), "r1", operation)).rejects.toBeInstanceOf(ServerBusyError);
    await new Promise((r) => setTimeout(r, 0));
    expect(operation).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("takes over a lease its crashed holder left behind once it expires", async () => {
    tryAcquireServerLease(db, { serverKey: "http://example.test", holder: "crashed", ttlMs: 30, nowMs: Date.now() });
    const response = await queueServerRequest(connection(), "r1", async () =>
      NextResponse.json({ ok: true }, { status: 200 })
    );
    expect(response.status).toBe(200);
  });

  it("releases the lease only after the budget-close cleanup has run", async () => {
    const order: string[] = [];
    const events: LeaseEvent[] = [];
    __internals.setLeaseStoreFactory(recordingStore(db, events));
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      order.push("close");
      return new Response(null, { status: 200 });
    });

    await queueServerRequest(connection("budget-1"), "r1", async () => {
      order.push("request");
      return NextResponse.json({ error: "boom" }, { status: 500 });
    });
    await new Promise((r) => setTimeout(r, 10));
    order.push(...events.filter((e) => e.kind === "release").map(() => "release"));

    expect(order).toEqual(["request", "close", "release"]);
  });

  it("falls back to the in-process queue, warning once, when the lease store cannot open", async () => {
    const { logger } = await import("@/lib/logger");
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    __internals.setLeaseStoreFactory(() => {
      throw new Error("App database path is not writable");
    });

    const order: string[] = [];
    const make = (id: string, delay: number) => async () => {
      await new Promise((r) => setTimeout(r, delay));
      order.push(id);
      return NextResponse.json({ id }, { status: 200 });
    };
    await Promise.all([
      queueServerRequest(connection(), "r1", make("first", 30)),
      queueServerRequest(connection(), "r2", make("second", 5)),
    ]);

    expect(order).toEqual(["first", "second"]);
    expect(warn.mock.calls.filter(([m]) => String(m).includes("request leases unavailable"))).toHaveLength(1);
  });

  it("waits out a busy app database instead of running without the lease", async () => {
    // SQLITE_BUSY means another realm is writing - maybe taking its own lease.
    // Going ahead unleased is exactly the overlap the lease prevents.
    let attempts = 0;
    const real = recordingStore(db)();
    __internals.setLeaseStoreFactory(() => ({
      acquire(serverKey, holder, ttlMs, nowMs) {
        attempts += 1;
        if (attempts <= 2) {
          throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
        }
        return real.acquire(serverKey, holder, ttlMs, nowMs);
      },
      release: real.release,
    }));
    // Another realm holds the lease meanwhile, so a request that skipped the
    // lease would be the only way this operation could start before it frees.
    tryAcquireServerLease(db, { serverKey: "http://example.test", holder: "other", ttlMs: 60_000, nowMs: Date.now() });
    setTimeout(() => releaseServerLease(db, { serverKey: "http://example.test", holder: "other" }), 80);

    const started: number[] = [];
    const t0 = Date.now();
    const response = await queueServerRequest(connection(), "r1", async () => {
      started.push(Date.now() - t0);
      return NextResponse.json({ ok: true }, { status: 200 });
    });

    expect(response.status).toBe(200);
    expect(attempts).toBeGreaterThan(2);
    expect(started[0]).toBeGreaterThanOrEqual(75);
  });

  it("gives up as busy when the database stays locked past the wait", async () => {
    __internals.setLeaseStoreFactory(() => ({
      acquire() {
        throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
      },
      release() {},
    }));
    __internals.setLeaseWaitMs(60);
    const operation = jest.fn(async () => NextResponse.json({ ok: true }, { status: 200 }));

    await expect(queueServerRequest(connection(), "r1", operation)).rejects.toBeInstanceOf(ServerBusyError);
    expect(operation).not.toHaveBeenCalled();
  });

  it("falls back to in-process order when a lease cannot be taken at all, and says so every time", async () => {
    const { logger } = await import("@/lib/logger");
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    __internals.setLeaseStoreFactory(() => ({
      acquire() {
        throw Object.assign(new Error("attempt to write a readonly database"), { code: "SQLITE_READONLY" });
      },
      release() {},
    }));

    for (const id of ["r1", "r2"]) {
      const response = await queueServerRequest(connection(), id, async () =>
        NextResponse.json({ ok: true }, { status: 200 })
      );
      expect(response.status).toBe(200);
    }
    expect(warn.mock.calls.filter(([m]) => String(m).includes("could not take the lease"))).toHaveLength(2);
  });

  it("adds little to an uncontended request", async () => {
    const runs = 200;
    const started = performance.now();
    for (let i = 0; i < runs; i += 1) {
      await queueServerRequest(connection(), `r${i}`, async () => NextResponse.json({ ok: true }, { status: 200 }));
    }
    const perRequestMs = (performance.now() - started) / runs;
    // Generous bound: this guards against a regression to something like a
    // file lock or a busy-wait, not a micro-benchmark.
    expect(perRequestMs).toBeLessThan(5);
  });
});

