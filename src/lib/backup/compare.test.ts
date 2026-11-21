/**
 * @jest-environment node
 */
import Database from "better-sqlite3";
import { zipSync } from "fflate";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import {
  createBackupArtifact,
  createBackupDestination,
  createBackupPolicy,
  recordArtifactLocation,
} from "@/lib/app-db/backupRepository";
import { upsertSyncCredential } from "@/lib/credentials/unattendedCredentials";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { compareAccounts, compareArtifact, type AccountSnapshot } from "./compare";
import { sha256 } from "./manifest";

function snapshot(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return { name: "Current", offBudget: false, closed: false, transactions: 10, balanceMinor: 50_000, ...overrides };
}

describe("putting a backup beside the live budget", () => {
  it("names accounts added, removed and changed since the copy, changes first", () => {
    const rows = compareAccounts(
      new Map([
        ["a", snapshot({ name: "Current" })],
        ["b", snapshot({ name: "Savings", balanceMinor: 1_000 })],
        ["c", snapshot({ name: "Old card" })],
      ]),
      new Map([
        ["a", snapshot({ name: "Current", transactions: 12, balanceMinor: 42_500 })],
        ["b", snapshot({ name: "Savings", balanceMinor: 1_000 })],
        ["d", snapshot({ name: "New loan", transactions: 1, balanceMinor: -900_000 })],
      ])
    );

    expect(rows.map((row) => [row.name, row.change])).toEqual([
      ["Old card", "removed"],
      ["New loan", "added"],
      ["Current", "changed"],
      ["Savings", "same"],
    ]);
    expect(rows[2]).toMatchObject({ balanceDeltaMinor: -7_500, transactionDelta: 2 });
    expect(rows[0]).toMatchObject({ live: null, balanceDeltaMinor: null });
  });

  it("counts an account closed since the copy as changed", () => {
    const [row] = compareAccounts(new Map([["a", snapshot()]]), new Map([["a", snapshot({ closed: true })]]));
    expect(row.change).toBe("changed");
  });
});

describe("comparing a stored backup", () => {
  let root: string;
  let db: SqliteDatabase;
  const previousKey = process.env.ACTUAL_BENCH_VAULT_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.ACTUAL_BENCH_VAULT_KEY = "test-vault-key";
    root = mkdtempSync(join(tmpdir(), "actual-bench-compare-"));
    db = getAppDb(join(root, "metadata.sqlite"));
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.ACTUAL_BENCH_VAULT_KEY;
    else process.env.ACTUAL_BENCH_VAULT_KEY = previousKey;
  });

  function archive(): Uint8Array {
    const scratch = mkdtempSync(join(tmpdir(), "bench-compare-fixture-"));
    const path = join(scratch, "db.sqlite");
    const budget = new Database(path);
    budget.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, offbudget INTEGER, closed INTEGER, tombstone INTEGER);
      CREATE TABLE transactions (id TEXT PRIMARY KEY, isParent INTEGER, acct TEXT, amount INTEGER, date INTEGER, tombstone INTEGER);
      INSERT INTO accounts VALUES ('a', 'Current', 0, 0, 0), ('c', 'Old card', 0, 0, 0);
      INSERT INTO transactions VALUES ('t1', 0, 'a', 50000, 20260101, 0), ('t2', 0, 'a', -2500, 20260102, 0),
                                      ('t3', 0, 'a', -100, 20260103, 1), ('t4', 0, 'c', -700, 20260104, 0);
    `);
    budget.close();
    const bytes = readFileSync(path);
    rmSync(scratch, { recursive: true, force: true });
    return zipSync({ "db.sqlite": bytes });
  }

  function store(sourceBudgetId: string | null) {
    const bytes = archive();
    const volume = join(root, "volume");
    mkdirSync(volume, { recursive: true });
    const destination = createBackupDestination(db, { name: "Volume", kind: "local", config: { version: 1, data: { path: volume } } });
    const policy = createBackupPolicy(db, {
      name: "Nightly",
      destinationIds: [destination.id],
      sourceRef: { version: 1, data: { connectionFingerprint: "conn-1" } },
    });
    const artifact = createBackupArtifact(db, {
      policyId: policy.id,
      kind: "budget",
      sourceBudgetId,
      sourceBudgetName: "Household",
      sizeBytes: bytes.byteLength,
      checksumSha256: sha256(bytes),
    });
    const key = `budget/${artifact.id}.zip`;
    mkdirSync(dirname(join(volume, key)), { recursive: true });
    writeFileSync(join(volume, key), bytes);
    recordArtifactLocation(db, { artifactId: artifact.id, destinationId: destination.id, objectKey: key, status: "stored" });
    return artifact;
  }

  it("reads the live budget through its enrolment and compares account by account", async () => {
    upsertSyncCredential(db, {
      connectionFingerprint: "conn-1",
      mode: "http-api",
      baseUrl: "https://actual.example.com",
      budgetSyncId: "budget-1",
      label: "Household",
      secret: { apiKey: "key", encryptionPassword: "" },
    });
    const queried: string[] = [];
    global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { ActualQLquery: { table: string; filter?: unknown } };
      queried.push(body.ActualQLquery.filter ? "transactions of changed accounts" : body.ActualQLquery.table);
      const data = body.ActualQLquery.filter
        ? [
            { id: "t1", account: "a", date: "2026-01-01", amount: 50000, notes: null, "payee.name": "Employer", "category.name": null },
            { id: "t2", account: "a", date: "2026-01-02", amount: -12500, notes: null, "payee.name": "Grocer", "category.name": "Food" },
            { id: "t9", account: "a", date: "2026-01-05", amount: 2500, notes: "refund", "payee.name": "Grocer", "category.name": "Food" },
          ]
        : body.ActualQLquery.table === "accounts"
          ? [
              { id: "a", name: "Current", offbudget: false, closed: false },
              { id: "n", name: "New loan", offbudget: true, closed: false },
            ]
          : [
              { account: "a", balance: 40000, count: 3 },
              { account: "n", balance: -900000, count: 1 },
            ];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const artifact = store("budget-1");

    const result = await compareArtifact(db, artifact.id);

    if (!result.opened) throw new Error(result.message);
    expect(queried).toEqual(["accounts", "transactions", "transactions of changed accounts"]);
    expect(result.totals).toEqual({ backup: { accounts: 2, transactions: 3 }, live: { accounts: 2, transactions: 4 } });
    expect(result.accounts.map((row) => [row.name, row.change, row.balanceDeltaMinor])).toEqual([
      ["Old card", "removed", null],
      ["New loan", "added", null],
      ["Current", "changed", -7500],
    ]);
    expect(result.accounts[2].backup).toMatchObject({ transactions: 2, balanceMinor: 47500 });
    // The changed account says which rows changed it.
    expect(result.accounts[2].details).toMatchObject({
      counts: { onlyInCopy: 0, onlyNow: 1, edited: 1 },
      onlyNow: [{ id: "t9", amountMinor: 2500, payee: "Grocer" }],
      edited: [{ before: { id: "t2", amountMinor: -2500 }, after: { id: "t2", amountMinor: -12500 } }],
    });
    expect(result.accounts[0].details).toBeNull();
  });

  it("says so when Bench holds no credentials for the budget, without opening the copy", async () => {
    const artifact = store("budget-1");

    const result = await compareArtifact(db, artifact.id);

    expect(result).toMatchObject({ opened: false });
    if (result.opened) throw new Error("opened");
    expect(result.message).toMatch(/no stored credentials for this budget/);
  });
});
