import { AppDbValidationError } from "./errors";
import type { JsonEnvelope, SqliteDatabase, SyncFlowRun } from "./types";

type SyncFlowRunRow = {
  id: string;
  flow_id: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary_json: string;
  error_json: string | null;
};

function parseEnvelope(raw: string, label: string): JsonEnvelope {
  try {
    const parsed = JSON.parse(raw) as Partial<JsonEnvelope>;
    if (typeof parsed.version !== "number" || !Number.isInteger(parsed.version) || parsed.version < 1 || typeof parsed.data !== "object" || parsed.data === null || Array.isArray(parsed.data)) {
      throw new Error("invalid envelope");
    }
    return parsed as JsonEnvelope;
  } catch {
    throw new AppDbValidationError(`${label} contains invalid JSON`);
  }
}

function rowToRun(row: SyncFlowRunRow): SyncFlowRun {
  return {
    id: row.id,
    flowId: row.flow_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    summary: parseEnvelope(row.summary_json, "summary"),
    error: row.error_json ? parseEnvelope(row.error_json, "error") : null,
  };
}

export function listSyncFlowRuns(db: SqliteDatabase, options: { flowId?: string; limit?: number } = {}): SyncFlowRun[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

  if (options.flowId) {
    return db
      .prepare("SELECT * FROM sync_flow_runs WHERE flow_id = ? ORDER BY started_at DESC LIMIT ?")
      .all<SyncFlowRunRow>(options.flowId, limit)
      .map(rowToRun);
  }

  return db
    .prepare("SELECT * FROM sync_flow_runs ORDER BY started_at DESC LIMIT ?")
    .all<SyncFlowRunRow>(limit)
    .map(rowToRun);
}
