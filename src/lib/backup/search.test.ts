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
import { upsertBackupCredential } from "@/lib/credentials/backupSecrets";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { encryptArchive } from "./encryption";
import { sha256 } from "./manifest";
import { withBudgetDatabase } from "./openArtifact";
import { amountFromText, searchArtifact, searchBudgetDatabase, type BackupSearchInput } from "./search";

/**
 * A budget shaped like Actual's: mapping tables, a merged payee, a transfer,
 * a split, and rows Actual had already deleted.
 */
function budgetArchive(): Uint8Array {
  const root = mkdtempSync(join(tmpdir(), "bench-search-fixture-"));
  const path = join(root, "db.sqlite");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, offbudget INTEGER, closed INTEGER, tombstone INTEGER, sort_order REAL);
    CREATE TABLE payees (id TEXT PRIMARY KEY, name TEXT, transfer_acct TEXT, tombstone INTEGER);
    CREATE TABLE payee_mapping (id TEXT PRIMARY KEY, targetId TEXT);
    CREATE TABLE category_groups (id TEXT PRIMARY KEY, name TEXT, tombstone INTEGER);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, cat_group TEXT, hidden INTEGER, tombstone INTEGER);
    CREATE TABLE category_mapping (id TEXT PRIMARY KEY, transferId TEXT);
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY, isParent INTEGER, isChild INTEGER, acct TEXT, category TEXT, amount INTEGER,
      description TEXT, notes TEXT, date INTEGER, imported_description TEXT, tombstone INTEGER,
      cleared INTEGER, parent_id TEXT, sort_order REAL
    );

    INSERT INTO accounts VALUES ('acc-current', 'Current', 0, 0, 0, 1), ('acc-savings', 'Savings', 1, 0, 0, 2),
                                ('acc-gone', 'Old card', 0, 0, 1, 3);
    INSERT INTO payees VALUES ('p-grocer', 'Corner Grocer', NULL, 0), ('p-grocer-dup', 'Corner Grocer Ltd', NULL, 1),
                              ('p-landlord', 'Landlord', NULL, 0), ('p-deleted', 'Deleted Payee', NULL, 1),
                              ('p-to-savings', '', 'acc-savings', 0);
    INSERT INTO payee_mapping VALUES ('p-grocer', 'p-grocer'), ('p-grocer-dup', 'p-grocer'), ('p-landlord', 'p-landlord'),
                                     ('p-to-savings', 'p-to-savings');
    INSERT INTO category_groups VALUES ('g-living', 'Living', 0);
    INSERT INTO categories VALUES ('c-food', 'Food', 'g-living', 0, 0), ('c-rent', 'Rent', 'g-living', 0, 0),
                                  ('c-old', 'Old category', 'g-living', 0, 1);
    INSERT INTO category_mapping VALUES ('c-food', 'c-food'), ('c-rent', 'c-rent'), ('c-old', 'c-food');

    INSERT INTO transactions VALUES
      ('t1', 0, 0, 'acc-current', 'c-food', -1250, 'p-grocer', 'weekly shop', 20260105, NULL, 0, 1, NULL, 1),
      -- recorded against the payee that was merged into Corner Grocer
      ('t2', 0, 0, 'acc-current', 'c-old', -2000, 'p-grocer-dup', NULL, 20260110, 'CORNER GROCER LTD 123', 0, 0, NULL, 2),
      ('t3', 0, 0, 'acc-current', 'c-rent', -90000, 'p-landlord', 'January rent', 20260201, NULL, 0, 1, NULL, 3),
      -- deleted in Actual before the copy was taken
      ('t4', 0, 0, 'acc-current', 'c-food', -500, 'p-grocer', 'deleted one', 20260115, NULL, 1, 0, NULL, 4),
      -- a transfer
      ('t5', 0, 0, 'acc-current', NULL, -10000, 'p-to-savings', NULL, 20260120, NULL, 0, 1, NULL, 5),
      -- a split: the parent is not listed, its lines are
      ('t6', 1, 0, 'acc-current', NULL, -3000, 'p-grocer', 'split shop', 20260125, NULL, 0, 1, NULL, 6),
      ('t6a', 0, 1, 'acc-current', 'c-food', -2000, 'p-grocer', 'split shop', 20260125, NULL, 0, 1, 't6', 7),
      ('t6b', 0, 1, 'acc-current', 'c-rent', -1000, 'p-grocer', 'split shop', 20260125, NULL, 0, 1, 't6', 8),
      -- in an account that was deleted
      ('t7', 0, 0, 'acc-gone', 'c-food', -700, 'p-grocer', NULL, 20260101, NULL, 0, 0, NULL, 9),
      -- a split deleted in Actual whose lines were left alive: Actual no longer counts them
      ('t8', 1, 0, 'acc-current', NULL, -1361624, 'p-grocer', NULL, 20260111, NULL, 1, 0, NULL, 10),
      ('t8a', 0, 1, 'acc-current', 'c-food', -1361624, 'p-grocer', NULL, 20260111, NULL, 0, 0, 't8', 11),
      -- a line whose parent is gone altogether, and one with no date
      ('t9a', 0, 1, 'acc-current', 'c-food', -550000, 'p-grocer', NULL, 20260112, NULL, 0, 0, 'missing', 12),
      ('t10', 0, 0, 'acc-current', 'c-food', -100, 'p-grocer', NULL, NULL, NULL, 0, 0, NULL, 13);
  `);
  db.close();
  const bytes = readFileSync(path);
  rmSync(root, { recursive: true, force: true });
  return zipSync({ "db.sqlite": bytes, "metadata.json": Buffer.from(JSON.stringify({ budgetName: "Household" })) });
}

const ARCHIVE = budgetArchive();

function search(input: Partial<BackupSearchInput>) {
  return withBudgetDatabase(ARCHIVE, (database) =>
    searchBudgetDatabase(database, { kind: "transactions", text: "", ...input })
  );
}

function ids(result: ReturnType<typeof search>): string[] {
  if (!result.opened) throw new Error(result.message);
  return result.rows.map((row) => row.id);
}

describe("searching a budget backup", () => {
  it("lists every transaction the budget had, counting rows exactly as Actual does", () => {
    // Deleted rows, split parents, lines of a deleted or missing split, and
    // rows without a date are all left out by Actual's own view; counting
    // them made a fresh copy differ from the live budget it was taken from.
    const result = search({});
    expect(ids(result)).toEqual(["t3", "t6b", "t6a", "t5", "t2", "t1"]);
    expect(result).toMatchObject({ total: 6, page: 0 });
  });

  it("shows a transaction as Actual does: merged payee, mapped category, transfer account", () => {
    const result = search({});
    if (!result.opened || result.kind !== "transactions") throw new Error("not opened");
    const byId = new Map(result.rows.map((row) => [row.id, row]));

    expect(byId.get("t2")).toMatchObject({ payee: "Corner Grocer", category: "Food", account: "Current", amountMinor: -2000, cleared: false, date: "2026-01-10" });
    expect(byId.get("t5")).toMatchObject({ payee: "Transfer: Savings", category: null });
    expect(byId.get("t6a")).toMatchObject({ split: true, category: "Food" });
  });

  it("matches payee, notes, category, account and the imported description", () => {
    expect(ids(search({ text: "grocer" }))).toEqual(["t6b", "t6a", "t2", "t1"]);
    expect(ids(search({ text: "FOOD" }))).toEqual(["t6a", "t2", "t1"]);
    expect(ids(search({ text: "ltd 123" }))).toEqual(["t2"]);
    expect(ids(search({ text: "deleted one" }))).toEqual([]);
  });

  it("matches an amount typed as a number, whatever its sign", () => {
    expect(ids(search({ text: "12.50" }))).toEqual(["t1"]);
    expect(ids(search({ text: "-900" }))).toEqual(["t3"]);
    expect(amountFromText("1,234.5")).toBe(123450);
    expect(amountFromText("12.505")).toBeNull();
  });

  it("takes the search text literally", () => {
    expect(ids(search({ text: "%" }))).toEqual([]);
  });

  it("limits transactions to a date range", () => {
    expect(ids(search({ from: "2026-01-10", to: "2026-01-25" }))).toEqual(["t6b", "t6a", "t5", "t2"]);
  });

  it("lists payees with their transactions, leaving out deleted and transfer payees", () => {
    const result = search({ kind: "payees" });
    if (!result.opened || result.kind !== "payees") throw new Error("not opened");
    expect(result.rows).toEqual([
      { id: "p-grocer", name: "Corner Grocer", transactions: 4 },
      { id: "p-landlord", name: "Landlord", transactions: 1 },
    ]);
  });

  it("lists categories with their group", () => {
    const result = search({ kind: "categories", text: "fo" });
    if (!result.opened || result.kind !== "categories") throw new Error("not opened");
    expect(result.rows).toEqual([{ id: "c-food", name: "Food", group: "Living", hidden: false, transactions: 3 }]);
  });

  it("lists accounts with their balance in that copy", () => {
    const result = search({ kind: "accounts" });
    if (!result.opened || result.kind !== "accounts") throw new Error("not opened");
    expect(result.rows).toEqual([
      { id: "acc-current", name: "Current", offBudget: false, closed: false, transactions: 6, balanceMinor: -106250 },
      { id: "acc-savings", name: "Savings", offBudget: true, closed: false, transactions: 0, balanceMinor: 0 },
    ]);
  });

  it("pages through the results", () => {
    const result = search({ page: 1 });
    expect(result).toMatchObject({ opened: true, total: 6, page: 1, rows: [] });
  });
});

describe("searching a stored backup", () => {
  let root: string;
  let db: SqliteDatabase;
  const previousKey = process.env.ACTUAL_BENCH_VAULT_KEY;

  beforeEach(() => {
    process.env.ACTUAL_BENCH_VAULT_KEY = "test-vault-key";
    root = mkdtempSync(join(tmpdir(), "actual-bench-search-"));
    db = getAppDb(join(root, "metadata.sqlite"));
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.ACTUAL_BENCH_VAULT_KEY;
    else process.env.ACTUAL_BENCH_VAULT_KEY = previousKey;
  });

  function store(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
    const volume = join(root, "volume");
    mkdirSync(volume, { recursive: true });
    const destination = createBackupDestination(db, { name: "Volume", kind: "local", config: { version: 1, data: { path: volume } } });
    const policy = createBackupPolicy(db, { name: "Nightly", destinationIds: [destination.id] });
    const artifact = createBackupArtifact(db, {
      policyId: policy.id,
      kind: "budget",
      sizeBytes: bytes.byteLength,
      checksumSha256: sha256(bytes),
      ...overrides,
    });
    const key = `budget/${artifact.id}.zip`;
    mkdirSync(dirname(join(volume, key)), { recursive: true });
    writeFileSync(join(volume, key), bytes);
    recordArtifactLocation(db, { artifactId: artifact.id, destinationId: destination.id, objectKey: key, status: "stored" });
    return artifact;
  }

  it("opens an encrypted copy with its stored passphrase", async () => {
    upsertBackupCredential(db, { ref: "pol-secret", kind: "passphrase", secret: { passphrase: "correct horse" } });
    const { bytes } = encryptArchive(ARCHIVE, "correct horse");
    const artifact = store(bytes, { encrypted: true, encryptionCredentialRef: "pol-secret" });

    const result = await searchArtifact(db, artifact.id, { kind: "transactions", text: "landlord" });

    expect(result).toMatchObject({ opened: true, total: 1 });
  });

  it("asks for the passphrase of an encrypted copy Bench holds none for, and accepts a typed one", async () => {
    const { bytes } = encryptArchive(ARCHIVE, "correct horse");
    const artifact = store(bytes, { encrypted: true });

    const without = await searchArtifact(db, artifact.id, { kind: "payees", text: "" });
    expect(without).toMatchObject({ opened: false });
    if (without.opened) throw new Error("opened");
    expect(without.message).toMatch(/Enter the passphrase/);

    const typed = await searchArtifact(db, artifact.id, { kind: "payees", text: "" }, { passphrase: "correct horse" });
    expect(typed).toMatchObject({ opened: true, total: 2 });
  });

  it("searches only budget copies", async () => {
    const artifact = store(ARCHIVE, { kind: "app-db" });

    const result = await searchArtifact(db, artifact.id, { kind: "transactions", text: "" });

    expect(result).toMatchObject({ opened: false });
  });
});
