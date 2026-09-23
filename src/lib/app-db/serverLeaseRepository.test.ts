/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import { releaseServerLease, tryAcquireServerLease } from "./serverLeaseRepository";
import type { SqliteDatabase } from "./types";

describe("serverLeaseRepository", () => {
  let root: string;
  let db: SqliteDatabase;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-lease-db-"));
    db = getAppDb(join(root, "metadata.sqlite"));
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  const lease = (holder: string, nowMs: number, ttlMs = 1_000) => ({
    serverKey: "http://api.test",
    holder,
    ttlMs,
    nowMs,
  });

  it("gives a free server to the first holder and refuses the next while it lasts", () => {
    expect(tryAcquireServerLease(db, lease("a", 1_000))).toBe(true);
    expect(tryAcquireServerLease(db, lease("b", 1_500))).toBe(false);
  });

  it("lets another holder take over a lease that has expired", () => {
    expect(tryAcquireServerLease(db, lease("a", 1_000, 1_000))).toBe(true);
    // Expires at 2_000: a crashed holder frees the server by itself.
    expect(tryAcquireServerLease(db, lease("b", 2_000))).toBe(true);
    // ...and the takeover is real: the original holder cannot release it.
    releaseServerLease(db, { serverKey: "http://api.test", holder: "a" });
    expect(tryAcquireServerLease(db, lease("c", 2_100))).toBe(false);
  });

  it("frees the server as soon as the holder releases it", () => {
    tryAcquireServerLease(db, lease("a", 1_000));
    releaseServerLease(db, { serverKey: "http://api.test", holder: "a" });
    expect(tryAcquireServerLease(db, lease("b", 1_001))).toBe(true);
  });

  it("keeps servers independent", () => {
    expect(tryAcquireServerLease(db, lease("a", 1_000))).toBe(true);
    expect(tryAcquireServerLease(db, { ...lease("b", 1_000), serverKey: "http://other.test" })).toBe(true);
  });
});
