/**
 * Per-server request serialization for actual-http-api.
 *
 * Every request Bench makes to an actual-http-api server goes through here:
 * /api/proxy (JSON), /api/proxy/download (binary), the unattended backup
 * export, and - through the gate in `serverRequestGate.ts` - the unattended
 * sync and bank-sync requests made by automations. actual-http-api wraps
 * @actual-app/api, which keeps a single budget open at a time per server
 * instance, and two concurrent requests against it do not merely fail: even two
 * wedge the budget until it recovers (agents/knowledge.md, "The proxy's
 * per-server serialization must stay"). The key is the base URL alone, because
 * the constraint is per server instance; different servers run in parallel.
 *
 * Two layers, because one is not enough:
 *
 *   * An in-memory FIFO, kept on `globalThis`. It keeps requests in arrival
 *     order and shares one queue between every module instance in the process.
 *     A module-level map did not: Next evaluates route modules separately from
 *     `instrumentation.ts`, so the backup export and the proxy each had a queue
 *     of their own (F-189).
 *   * A lease row in the app database, taken by whichever request reaches the
 *     head of the FIFO. Memory is not shared between worker threads, so this is
 *     what keeps a worker and the web server apart. Every lease expires on its
 *     own, so a holder that crashed frees the server by itself.
 *
 * If the app database cannot be opened (non-durable demo storage, an
 * unwritable path), the FIFO alone serializes requests - the same guarantee
 * Bench had before - and the problem is logged once. The proxy never fails
 * because the lease store is unavailable. A database that opened but is busy
 * is different: that is another realm at work, so the request waits for the
 * lease rather than running without it.
 */
import type { NextResponse } from "next/server";
import { threadId } from "node:worker_threads";
import { getAppDb } from "@/lib/app-db/connection";
import { releaseServerLease, tryAcquireServerLease } from "@/lib/app-db/serverLeaseRepository";
import { logger } from "@/lib/logger";
import type { HttpApiConnection } from "@/store/connection";
import { installServerRequestGate } from "./serverRequestGate";

/**
 * How long a lease lives when the caller does not say. Long enough for the
 * slowest ordinary request (30s unattended timeout) plus the 5s best-effort
 * budget close that runs before the lease is released.
 */
export const DEFAULT_LEASE_TTL_MS = 45_000;

/** How long a request waits for another thread's lease before giving up. */
const LEASE_WAIT_MS = 120_000;
const LEASE_POLL_START_MS = 25;
const LEASE_POLL_MAX_MS = 250;

/** Another realm has held the server for longer than a request may wait. */
export class ServerBusyError extends Error {
  constructor(readonly serverKey: string) {
    super("The API server is busy with another request. Try again shortly.");
    this.name = "ServerBusyError";
  }
}

type LeaseStore = {
  acquire(serverKey: string, holder: string, ttlMs: number, nowMs: number): boolean;
  release(serverKey: string, holder: string): void;
};

type QueueState = {
  // Each entry is the tail of a server's request chain - a void promise that
  // resolves when the previous request (and its cleanup) finishes. A new
  // request appends itself and becomes the tail. Errors are swallowed in the
  // tail so a failed request never blocks the ones behind it.
  tails: Map<string, Promise<void>>;
  leaseStoreWarned: boolean;
  leaseStoreFactory: () => LeaseStore;
  leaseWaitMs: number;
};

const QUEUE_KEY = Symbol.for("actual-bench.serverQueue");

function appDbLeaseStore(): LeaseStore {
  const db = getAppDb();
  return {
    acquire: (serverKey, holder, ttlMs, nowMs) => tryAcquireServerLease(db, { serverKey, holder, ttlMs, nowMs }),
    release: (serverKey, holder) => releaseServerLease(db, { serverKey, holder }),
  };
}

function queueState(): QueueState {
  const holder = globalThis as { [QUEUE_KEY]?: QueueState };
  holder[QUEUE_KEY] ??= {
    tails: new Map(),
    leaseStoreWarned: false,
    leaseStoreFactory: appDbLeaseStore,
    leaseWaitMs: LEASE_WAIT_MS,
  };
  return holder[QUEUE_KEY];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function warnLeaseStoreOnce(error: unknown): void {
  const state = queueState();
  if (state.leaseStoreWarned) return;
  state.leaseStoreWarned = true;
  logger.warn(
    `[server-queue] request leases unavailable, serializing in this process only: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

function openLeaseStore(): LeaseStore | null {
  try {
    return queueState().leaseStoreFactory();
  } catch (error) {
    warnLeaseStoreOnce(error);
    return null;
  }
}

/**
 * A lock conflict in SQLite: another connection is writing. better-sqlite3
 * reports these by code, after its own busy timeout has already waited.
 */
function isContention(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"));
}

let holderSequence = 0;

function newHolderId(reqId: string): string {
  holderSequence += 1;
  return `${process.pid}:${threadId}:${reqId}:${holderSequence}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for the server's lease. Returns the function that gives it back, which
 * is a no-op when leases are unavailable and the FIFO is serializing alone.
 */
async function acquireLease(serverKey: string, holder: string, ttlMs: number): Promise<() => void> {
  const store = openLeaseStore();
  if (!store) return () => {};

  const deadline = Date.now() + queueState().leaseWaitMs;
  let delay = LEASE_POLL_START_MS;

  for (;;) {
    let acquired: boolean;
    try {
      acquired = store.acquire(serverKey, holder, ttlMs, Date.now());
    } catch (error) {
      if (isContention(error)) {
        // Another realm is writing to the app database - most likely taking
        // or releasing a lease of its own. Running now, without the lease,
        // is exactly the overlap this exists to prevent, so this counts as
        // "not yet": keep waiting, and give up as busy at the deadline.
        acquired = false;
      } else {
        // The store opened but cannot take a lease at all (a read-only or
        // full disk, say). Waiting would not fix that, and making every
        // request sit out the full wait would take the proxy down with it;
        // fall back to the in-process order, and say so every time rather
        // than once, because it is not the quiet startup case.
        logger.warn(
          `[server-queue] could not take the lease for ${serverKey}, serializing in this process only: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return () => {};
      }
    }

    if (acquired) {
      return () => {
        try {
          store.release(serverKey, holder);
        } catch (error) {
          // The lease expires by itself; failing to delete it early only
          // delays the next holder until then.
          logger.warn(
            `[server-queue] could not release lease for ${serverKey}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      };
    }

    if (Date.now() + delay > deadline) throw new ServerBusyError(serverKey);
    await sleep(delay);
    delay = Math.min(delay * 2, LEASE_POLL_MAX_MS);
  }
}

/**
 * When a request fails with a server error, actual-http-api may leave the
 * budget in a partially-open state (transaction still active). Before the
 * next queued request runs, attempt a DELETE to close/unload the budget so
 * the server's internal state is clean. Errors are swallowed — best-effort.
 */
async function tryCloseBudget(
  baseUrl: string,
  budgetSyncId: string,
  apiKey: string
): Promise<void> {
  try {
    const encodedBudgetSyncId = encodeURIComponent(budgetSyncId);
    await fetch(
      `${normalizeBaseUrl(baseUrl)}/v1/budgets/${encodedBudgetSyncId}`,
      {
        method: "DELETE",
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(5_000),
      }
    );
  } catch {
    // Ignore — best-effort only
  }
}

export type HttpProxyConnection = Pick<HttpApiConnection, "baseUrl" | "apiKey"> &
  Partial<Pick<HttpApiConnection, "budgetSyncId" | "encryptionPassword">>;

type QueueConnection = Pick<HttpProxyConnection, "baseUrl" | "budgetSyncId" | "apiKey">;

export type QueueOptions = {
  /**
   * Lifetime of this request's lease: its own timeout plus room for the
   * budget-close cleanup. A lease shorter than the request could expire while
   * the request is still running and let another realm in.
   */
  leaseTtlMs?: number;
};

/**
 * Enqueue a request operation against a server. Returns the operation's
 * response promise. On 5xx or rejection, attempts a best-effort budget close
 * before releasing the queue.
 *
 * Rejects with `ServerBusyError` when another realm holds the server for
 * longer than a request may wait; the operation has not run in that case, so
 * no budget close is attempted.
 */
export function queueServerRequest<T extends { status: number } = NextResponse>(
  connection: QueueConnection,
  reqId: string,
  operation: () => Promise<T>,
  options: QueueOptions = {}
): Promise<T> {
  const serverKey = normalizeBaseUrl(connection.baseUrl);
  const { tails } = queueState();
  const prev = tails.get(serverKey) ?? Promise.resolve();
  const lease = { release: () => {} };

  const thisRequest = prev.then(async () => {
    lease.release = await acquireLease(
      serverKey,
      newHolderId(reqId),
      options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS
    );
    return operation();
  });

  // The tail is awaited so the queue does not release until cleanup has had
  // a chance to run, and the lease is released only after that same cleanup.
  // Errors are handled in both branches so the chain never breaks.
  const voidTail = thisRequest
    .then(
      async (response) => {
        if (response.status >= 500 && connection.budgetSyncId) {
          await tryCloseBudget(connection.baseUrl, connection.budgetSyncId, connection.apiKey);
          logger.warn(`budget close attempted after ${response.status} [${reqId}]`);
        }
      },
      async (error: unknown) => {
        if (error instanceof ServerBusyError) return;
        if (connection.budgetSyncId) {
          await tryCloseBudget(connection.baseUrl, connection.budgetSyncId, connection.apiKey);
        }
      }
    )
    .finally(() => lease.release());
  tails.set(serverKey, voidTail);
  void voidTail.then(() => {
    if (tails.get(serverKey) === voidTail) {
      tails.delete(serverKey);
    }
  });

  return thisRequest;
}

// Loading this module is what makes the lock reachable from `client.ts`.
installServerRequestGate(queueServerRequest);

// Exported for tests only.
export const __internals = {
  get serverQueueTails() {
    return queueState().tails;
  },
  tryCloseBudget,
  setLeaseStoreFactory(factory: () => LeaseStore): void {
    queueState().leaseStoreFactory = factory;
    queueState().leaseStoreWarned = false;
  },
  resetLeaseStoreFactory(): void {
    queueState().leaseStoreFactory = appDbLeaseStore;
    queueState().leaseStoreWarned = false;
  },
  setLeaseWaitMs(ms: number): void {
    queueState().leaseWaitMs = ms;
  },
  /** Forget the process-wide queue, as a separate realm would see it. */
  resetQueueState(): void {
    delete (globalThis as { [QUEUE_KEY]?: QueueState })[QUEUE_KEY];
  },
};
