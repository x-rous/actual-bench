import type { SqliteDatabase } from "./types";

/**
 * Move everything that names one connection to another (PR-071c): used when a
 * budget's single enrolment switches between HTTP API and Direct, so the
 * automations, flows and backup rules that used it keep working without being
 * edited one by one.
 *
 * References are the `connectionFingerprint` inside JSON envelopes
 * (`{ version, data: { connectionFingerprint } }`) plus an automation's
 * `credential_ref`. Sync mappings also record a fingerprint, but only as a
 * stamp of where a row came from - nothing looks them up by it - so they are
 * left as history.
 */

const PATH = "$.data.connectionFingerprint";

export type RepointSummary = { automations: number; flows: number; backupRules: number };

export function repointConnectionReferences(db: SqliteDatabase, from: string, to: string): RepointSummary {
  if (!from || !to || from === to) return { automations: 0, flows: 0, backupRules: 0 };

  const envelope = (table: string, column: string): number =>
    db
      .prepare(`UPDATE ${table} SET ${column} = json_set(${column}, '${PATH}', ?) WHERE json_extract(${column}, '${PATH}') = ?`)
      .run(to, from).changes;

  const move = db.transaction((): RepointSummary => {
    const automations =
      db.prepare("UPDATE automation_definitions SET credential_ref = ? WHERE credential_ref = ?").run(to, from).changes +
      envelope("automation_definitions", "config_json") +
      envelope("automation_definitions", "target_ref_json");
    const flows = envelope("sync_flows", "source_ref_json") + envelope("sync_flows", "target_ref_json");
    const backupRules = envelope("backup_policies", "source_ref_json");
    return { automations, flows, backupRules };
  });
  return move() as RepointSummary;
}
