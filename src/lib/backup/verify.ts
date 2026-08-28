import Database from "better-sqlite3";

type SqliteHandle = InstanceType<typeof Database>;
import { unzipSync, strFromU8 } from "fflate";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runDiagnosticChecks,
  runIntegrityCheck,
  type DiagnosticDb,
} from "@/features/budget-diagnostics/lib/diagnosticChecks";
import type { BudgetDiagnostic, MetadataJson } from "@/features/budget-diagnostics/types";
import { sha256, type BackupContentSummary, type BackupVerificationLevel } from "./manifest";

/**
 * Verification (RD-077 / PR-047c) — the reason this feature is called
 * *verified* backup.
 *
 * A backup nobody has opened is a hypothesis. Bench can do better than most
 * tools here for a specific reason: Budget Diagnostics already unzips an Actual
 * export, opens `db.sqlite` and reasons about its contents, so verification is
 * that machinery pointed at an artifact instead of at a live budget. The checks
 * below are literally the same functions — a backup is held to exactly the
 * standard Bench holds a working budget to.
 *
 * Three levels, because thoroughness has a cost and the right amount of it
 * depends on when you are asking:
 *
 *   * **archive** — it is a real ZIP, it contains what an Actual export
 *     contains, and its bytes match the checksum. Cheap; run on every artifact.
 *   * **data** — open the database, run `PRAGMA integrity_check`, and count
 *     what is inside. This is the level that catches truncated uploads and
 *     silently corrupted storage, and it is the default.
 *   * **deep** — the full diagnostic suite, including relationship checks. Slow
 *     enough to be worth reserving for the newest copy during a scrub.
 *
 * Verification always runs on the **plaintext** archive, before encryption:
 * verifying ciphertext proves only that bytes survived, which is the least
 * interesting thing that can go wrong.
 */

export type VerificationOutcome = {
  level: BackupVerificationLevel;
  status: "passed" | "failed";
  /** Human-readable, ordered worst first; safe to show verbatim. */
  findings: string[];
  content: BackupContentSummary;
  checksumSha256: string;
};

function describe(finding: BudgetDiagnostic): string {
  return finding.details?.length
    ? `${finding.title}: ${finding.message} (${finding.details.slice(0, 3).join("; ")})`
    : `${finding.title}: ${finding.message}`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The Budget Diagnostics database interface, backed by better-sqlite3. */
function createDiagnosticDb(database: SqliteHandle): DiagnosticDb {
  return {
    exec: (sql) => {
      database.exec(sql);
    },
    selectValue: (sql) => {
      // The single-column shape every diagnostic query uses; taking the first
      // value keeps this working for `PRAGMA integrity_check` too, whose column
      // is named after the pragma rather than aliased.
      const row = database.prepare(sql).get<Record<string, unknown>>();
      return row ? Object.values(row)[0] : undefined;
    },
    selectRows: <T extends Record<string, unknown>>(sql: string) =>
      database.prepare(sql).all() as T[],
    objectExists: (name, type) => {
      const typeClause = type ? ` AND type = ${sqlLiteral(type)}` : "";
      const row = database
        .prepare(`SELECT COUNT(*) AS n FROM sqlite_schema WHERE name = ${sqlLiteral(name)}${typeClause}`)
        .get() as { n: number } | undefined;
      return Number(row?.n ?? 0) > 0;
    },
    getColumns: (name) =>
      (database.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as { name: string }[]).map(
        (row) => String(row.name)
      ),
  };
}

function count(database: SqliteHandle, table: string): number | undefined {
  try {
    const row = database.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(table)}`).get() as
      | { n: number }
      | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return undefined;
  }
}

function summarize(database: SqliteHandle): BackupContentSummary {
  const summary: BackupContentSummary = {
    accounts: count(database, "accounts"),
    transactions: count(database, "transactions"),
    payees: count(database, "payees"),
    categories: count(database, "categories"),
  };

  try {
    // Actual stores dates as YYYYMMDD integers.
    const row = database
      .prepare(
        "SELECT MIN(date) AS earliest, MAX(date) AS latest FROM transactions WHERE date IS NOT NULL"
      )
      .get() as { earliest: number | null; latest: number | null } | undefined;
    summary.earliestTransaction = formatActualDate(row?.earliest ?? null);
    summary.latestTransaction = formatActualDate(row?.latest ?? null);
  } catch {
    summary.earliestTransaction = null;
    summary.latestTransaction = null;
  }

  return summary;
}

function formatActualDate(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const text = String(value);
  if (text.length !== 8) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

/**
 * Verify a plaintext budget export.
 *
 * Never throws for a bad artifact: an unreadable backup is a *result*, not an
 * exception, and the whole point is to record it and tell someone.
 */
export function verifyBudgetArchive(
  bytes: Uint8Array,
  level: BackupVerificationLevel
): VerificationOutcome {
  const checksumSha256 = sha256(bytes);
  const findings: string[] = [];

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    return {
      level,
      status: "failed",
      findings: [`Not a readable ZIP archive: ${error instanceof Error ? error.message : String(error)}`],
      content: {},
      checksumSha256,
    };
  }

  const normalized = new Map(
    Object.entries(files).map(([path, content]) => [path.replace(/^\.?\//, ""), content])
  );
  const dbBytes = normalized.get("db.sqlite");
  if (!dbBytes) {
    return {
      level,
      status: "failed",
      findings: ["The archive does not contain db.sqlite, so it is not an Actual export."],
      content: {},
      checksumSha256,
    };
  }

  // Advisory findings are worth reporting and must not condemn the copy. A
  // missing metadata.json costs you the budget's name, not its data: the
  // archive still imports. Letting it fail verification would exclude a
  // perfectly restorable copy from being the newest verified one, which is the
  // copy retention refuses to delete.
  const advisories: string[] = [];
  let metadata: MetadataJson | null = null;
  const metadataBytes = normalized.get("metadata.json");
  if (!metadataBytes) {
    advisories.push("The archive has no metadata.json, so its budget name and id are unknown.");
  } else {
    try {
      metadata = JSON.parse(strFromU8(metadataBytes)) as MetadataJson;
    } catch {
      advisories.push("The archive's metadata.json is not valid JSON.");
    }
  }

  if (level === "archive") {
    return { level, status: "passed", findings: advisories, content: {}, checksumSha256 };
  }

  // better-sqlite3 needs a file. A temp copy is cheap next to the confidence of
  // actually opening the database rather than trusting its header.
  const scratch = mkdtempSync(join(tmpdir(), "bench-verify-"));
  const dbPath = join(scratch, "db.sqlite");
  let database: SqliteHandle | null = null;

  try {
    writeFileSync(dbPath, dbBytes);
    database = new Database(dbPath, { readonly: true, fileMustExist: true });
    const diagnosticDb = createDiagnosticDb(database);

    const integrity = runIntegrityCheck(diagnosticDb);
    const failedIntegrity = integrity.filter((finding) => finding.severity === "error");
    findings.push(...failedIntegrity.map(describe));

    const content = summarize(database);
    content.integrityCheck = failedIntegrity.length === 0 ? "ok" : "failed";

    if (level === "deep") {
      const diagnostics = runDiagnosticChecks(diagnosticDb, metadata);
      findings.push(
        ...diagnostics.filter((finding) => finding.severity === "error").map(describe)
      );
    }

    if (content.transactions === undefined || content.accounts === undefined) {
      findings.push("The database opened but does not have Actual's tables.");
    }

    return {
      level,
      // Only a fatal finding fails a copy; advisories travel with it.
      status: findings.length === 0 ? "passed" : "failed",
      findings: [...findings, ...advisories],
      content,
      checksumSha256,
    };
  } catch (error) {
    return {
      level,
      status: "failed",
      findings: [
        ...findings,
        `The archive's database could not be opened: ${
          error instanceof Error ? error.message : String(error)
        }`,
        ...advisories,
      ],
      content: {},
      checksumSha256,
    };
  } finally {
    database?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Verify a copy of Bench's own metadata database.
 *
 * Simpler than a budget: there is no archive around it and no Actual schema to
 * hold it to, so "does it open and does SQLite believe it" is the whole test.
 */
export function verifyAppDbArchive(
  bytes: Uint8Array,
  level: BackupVerificationLevel
): VerificationOutcome {
  const checksumSha256 = sha256(bytes);
  if (level === "archive") {
    const looksLikeSqlite = Buffer.from(bytes.subarray(0, 15)).toString("ascii") === "SQLite format 3";
    return {
      level,
      status: looksLikeSqlite ? "passed" : "failed",
      findings: looksLikeSqlite ? [] : ["This file does not have a SQLite header."],
      content: {},
      checksumSha256,
    };
  }

  const scratch = mkdtempSync(join(tmpdir(), "bench-verify-appdb-"));
  const dbPath = join(scratch, "app.sqlite");
  let database: SqliteHandle | null = null;

  try {
    writeFileSync(dbPath, bytes);
    database = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = database.prepare("PRAGMA integrity_check").get<Record<string, unknown>>();
    const result = String(row ? Object.values(row)[0] ?? "" : "");
    const ok = result.toLowerCase() === "ok";
    return {
      level,
      status: ok ? "passed" : "failed",
      findings: ok ? [] : [`PRAGMA integrity_check returned: ${result}`],
      content: { integrityCheck: ok ? "ok" : "failed" },
      checksumSha256,
    };
  } catch (error) {
    return {
      level,
      status: "failed",
      findings: [
        `The copy could not be opened: ${error instanceof Error ? error.message : String(error)}`,
      ],
      content: {},
      checksumSha256,
    };
  } finally {
    database?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
