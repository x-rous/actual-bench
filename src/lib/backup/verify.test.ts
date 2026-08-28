/**
 * @jest-environment node
 */
import Database from "better-sqlite3";
import { zipSync } from "fflate";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptArchive, encryptArchive } from "./encryption";
import { verifyAppDbArchive, verifyBudgetArchive } from "./verify";

/** A miniature but real Actual-shaped budget database. */
function budgetDbBytes(options: { transactions?: number } = {}): Uint8Array {
  const root = mkdtempSync(join(tmpdir(), "bench-verify-fixture-"));
  const path = join(root, "db.sqlite");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, tombstone INTEGER DEFAULT 0);
    CREATE TABLE payees (id TEXT PRIMARY KEY, name TEXT, tombstone INTEGER DEFAULT 0);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, tombstone INTEGER DEFAULT 0);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, acct TEXT, date INTEGER, amount INTEGER);
    INSERT INTO accounts VALUES ('a1', 'Current', 0), ('a2', 'Savings', 0);
    INSERT INTO payees VALUES ('p1', 'Grocer', 0);
    INSERT INTO categories VALUES ('c1', 'Food', 0);
  `);
  const insert = db.prepare("INSERT INTO transactions VALUES (?, 'a1', ?, -1000)");
  const count = options.transactions ?? 3;
  for (let index = 0; index < count; index += 1) {
    insert.run(`t${index}`, 20260101 + index);
  }
  db.close();
  const bytes = readFileSync(path);
  rmSync(root, { recursive: true, force: true });
  return bytes;
}

function budgetZip(overrides: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    "db.sqlite": budgetDbBytes(),
    "metadata.json": Buffer.from(JSON.stringify({ budgetName: "Household", id: "budget-1" })),
    ...overrides,
  });
}

describe("verifying a budget archive", () => {
  it("passes a real export and reports what is inside it", () => {
    const result = verifyBudgetArchive(budgetZip(), "data");

    expect(result.status).toBe("passed");
    expect(result.findings).toEqual([]);
    expect(result.content).toMatchObject({
      accounts: 2,
      payees: 1,
      categories: 1,
      transactions: 3,
      integrityCheck: "ok",
      earliestTransaction: "2026-01-01",
      latestTransaction: "2026-01-03",
    });
  });

  it("fails a truncated upload, which is the failure this feature exists for", () => {
    // Half a ZIP is the classic silent backup failure: the file is there, it is
    // roughly the right size, and it is worthless.
    const full = budgetZip();
    const result = verifyBudgetArchive(full.subarray(0, Math.floor(full.length / 2)), "data");

    expect(result.status).toBe("failed");
    expect(result.findings.join(" ")).toMatch(/ZIP|db\.sqlite/);
  });

  it("fails an archive whose database is corrupt rather than merely unreadable", () => {
    const dbBytes = Buffer.from(budgetDbBytes({ transactions: 200 }));
    // Keep a valid SQLite header and scribble over a later page, so nothing
    // short of actually opening the database would notice.
    dbBytes.fill(0x7a, 4096, 8192);
    const result = verifyBudgetArchive(budgetZip({ "db.sqlite": dbBytes }), "data");

    expect(result.status).toBe("failed");
    expect(result.content.integrityCheck).not.toBe("ok");
  });

  it("fails an archive that is not an Actual export at all", () => {
    const result = verifyBudgetArchive(zipSync({ "notes.txt": Buffer.from("hello") }), "data");

    expect(result.status).toBe("failed");
    expect(result.findings[0]).toMatch(/db\.sqlite/);
  });

  it("notes a missing metadata.json without condemning the backup", () => {
    const result = verifyBudgetArchive(zipSync({ "db.sqlite": budgetDbBytes() }), "archive");

    // Still usable — Actual can import it — so this is a finding, not a failure.
    expect(result.status).toBe("passed");
    expect(result.findings[0]).toMatch(/metadata\.json/);
  });

  it("does the cheap check at archive level and the real one at data level", () => {
    const dbBytes = Buffer.from(budgetDbBytes({ transactions: 200 }));
    dbBytes.fill(0x7a, 4096, 8192);
    const archive = budgetZip({ "db.sqlite": dbBytes });

    // Structurally fine, contents rotten: exactly the difference between the levels.
    expect(verifyBudgetArchive(archive, "archive").status).toBe("passed");
    expect(verifyBudgetArchive(archive, "data").status).toBe("failed");
  });

  it("reports the checksum of the bytes it was given", () => {
    const archive = budgetZip();
    const first = verifyBudgetArchive(archive, "archive");
    const second = verifyBudgetArchive(archive, "data");

    expect(first.checksumSha256).toBe(second.checksumSha256);
    expect(first.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifying a copy of Bench's own database", () => {
  it("passes a healthy copy", () => {
    const result = verifyAppDbArchive(budgetDbBytes(), "data");
    expect(result.status).toBe("passed");
    expect(result.content.integrityCheck).toBe("ok");
  });

  it("fails something that is not a SQLite file", () => {
    const result = verifyAppDbArchive(Buffer.from("this is not a database"), "archive");
    expect(result.status).toBe("failed");
    expect(result.findings[0]).toMatch(/SQLite header/);
  });
});

describe("encryption", () => {
  it("round-trips an archive and verification still passes afterwards", () => {
    const archive = budgetZip();
    const { bytes } = encryptArchive(archive, "correct horse battery staple");

    expect(Buffer.from(bytes).includes(Buffer.from("db.sqlite"))).toBe(false);
    const decrypted = decryptArchive(bytes, "correct horse battery staple");
    expect(verifyBudgetArchive(decrypted, "data").status).toBe("passed");
  });

  it("tells a wrong passphrase apart from a file that is not ours", () => {
    const { bytes } = encryptArchive(budgetZip(), "right");

    expect(() => decryptArchive(bytes, "wrong")).toThrow(/passphrase is wrong or the file has been altered/);
    expect(() => decryptArchive(budgetZip(), "right")).toThrow(/not an encrypted Bench backup/);
  });

  it("detects tampering, because an auth tag is the point of GCM", () => {
    const { bytes } = encryptArchive(budgetZip(), "right");
    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => decryptArchive(tampered, "right")).toThrow(/altered/);
  });

  it("is self-describing, so an artifact can be decrypted without its manifest", () => {
    const { bytes, info } = encryptArchive(budgetZip(), "right");

    // The header carries the same parameters the manifest records.
    expect(Buffer.from(bytes.subarray(0, 8)).toString("ascii")).toBe("BENCHBK1");
    expect(info.salt).toBeTruthy();
    expect(decryptArchive(bytes, "right").length).toBeGreaterThan(0);
  });
});
