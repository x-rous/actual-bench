export const APP_META_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at text NOT NULL
);
`;

export const SYNC_FLOW_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS sync_flows (
  id text PRIMARY KEY,
  name text NOT NULL,
  enabled integer NOT NULL DEFAULT 1,
  description text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
`;

export const SYNC_FLOW_LEG_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS sync_flow_legs (
  id text PRIMARY KEY,
  flow_id text NOT NULL REFERENCES sync_flows(id) ON DELETE CASCADE,
  position integer NOT NULL,
  source_ref_json text NOT NULL,
  target_ref_json text NOT NULL,
  filter_json text NOT NULL,
  transform_json text NOT NULL,
  options_json text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
`;

export const SYNC_FLOW_RUN_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS sync_flow_runs (
  id text PRIMARY KEY,
  flow_id text REFERENCES sync_flows(id) ON DELETE SET NULL,
  status text NOT NULL,
  started_at text NOT NULL,
  finished_at text,
  summary_json text NOT NULL,
  error_json text
);
`;

export const SYNC_FLOW_RUN_ITEM_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS sync_flow_run_items (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES sync_flow_runs(id) ON DELETE CASCADE,
  leg_id text REFERENCES sync_flow_legs(id) ON DELETE SET NULL,
  source_item_ref_json text NOT NULL,
  target_item_ref_json text,
  status text NOT NULL,
  message text,
  created_at text NOT NULL
);
`;

export const SYNC_FLOW_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_sync_flow_legs_flow_position ON sync_flow_legs(flow_id, position)",
  "CREATE INDEX IF NOT EXISTS idx_sync_flow_runs_flow_started ON sync_flow_runs(flow_id, started_at)",
  "CREATE INDEX IF NOT EXISTS idx_sync_flow_run_items_run ON sync_flow_run_items(run_id)",
] as const;
