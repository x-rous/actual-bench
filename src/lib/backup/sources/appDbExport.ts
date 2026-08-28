import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SqliteDatabase } from "@/lib/app-db/types";

/**
 * A consistent copy of Bench's own metadata database (RD-077 / PR-047c).
 *
 * Worth backing up separately from the budget, because it is the only place
 * some things live: sync flows and their mappings, reconciliation sessions,
 * automations and their history, saved queries, payee-cleanup decisions. Losing
 * it does not lose money, but it loses every rule the user has taught Bench.
 *
 * `VACUUM INTO` rather than copying the file: it takes SQLite's own read lock,
 * so the copy is transactionally consistent even if a sync is writing at the
 * time, and it produces a compact database with no WAL to reunite later.
 * Copying the file by hand while WAL is active is how people end up with
 * backups that open but are missing the last hour of work.
 */
export function exportAppDbSnapshot(db: SqliteDatabase): Buffer {
  const scratch = mkdtempSync(join(tmpdir(), "bench-appdb-backup-"));
  const target = join(scratch, "actual-bench.sqlite");
  try {
    db.prepare("VACUUM INTO ?").run(target);
    return readFileSync(target);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
