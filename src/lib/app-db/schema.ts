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

export const SYNC_MAPPING_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS sync_mappings (
  id text PRIMARY KEY,
  flow_id text NOT NULL REFERENCES sync_flows(id) ON DELETE CASCADE,
  source_connection_fingerprint text NOT NULL,
  source_budget_id text NOT NULL,
  source_account_id text,
  source_entity_type text NOT NULL,
  source_transaction_id text,
  source_split_id text,
  source_item_key text NOT NULL,
  source_fingerprint text NOT NULL,
  target_connection_fingerprint text NOT NULL,
  target_budget_id text NOT NULL,
  target_account_id text,
  target_entity_type text NOT NULL,
  target_transaction_id text,
  target_item_key text,
  target_fingerprint text,
  target_marker text,
  created_run_id text REFERENCES sync_flow_runs(id) ON DELETE SET NULL,
  status text NOT NULL,
  last_seen_at text,
  last_applied_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  UNIQUE(flow_id, source_item_key)
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

export const SYNC_PLATFORM_V2_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_sync_flows_type_updated ON sync_flows(flow_type, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_sync_flow_run_items_flow ON sync_flow_run_items(flow_id)",
  "CREATE INDEX IF NOT EXISTS idx_sync_flow_run_items_source ON sync_flow_run_items(flow_id, source_item_key)",
  "CREATE INDEX IF NOT EXISTS idx_sync_mappings_flow_source ON sync_mappings(flow_id, source_item_key)",
  "CREATE INDEX IF NOT EXISTS idx_sync_mappings_target_marker ON sync_mappings(target_marker)",
  "CREATE INDEX IF NOT EXISTS idx_sync_mappings_source_entity ON sync_mappings(source_entity_type, source_transaction_id)",
] as const;

// v3: stable run-item ordering for preview rendering.
export const SYNC_PLATFORM_V3_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_sync_flow_run_items_run_sequence ON sync_flow_run_items(run_id, sequence)",
] as const;

// v4 (RD-058): encrypted credential vault for unattended server-side sync.
// One row per enrolled connection→budget (keyed by connection fingerprint).
// The secret blob (API key [+ encryption password]) is AES-256-GCM sealed; the
// key comes from the SYNC_VAULT_KEY env var and is never stored here.
export const SYNC_CREDENTIAL_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS sync_credentials (
  connection_fingerprint text PRIMARY KEY,
  mode text NOT NULL,
  base_url text NOT NULL,
  budget_sync_id text NOT NULL,
  label text NOT NULL DEFAULT '',
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
`;

// ── Remembered connection credentials (RD-061 / PR-026a) ─────────────────────
// Opt-in, passphrase-sealed reconnect credentials. Kept separate from
// `sync_credentials` (unattended vault) so the two concerns never share
// ciphertext or a key. The secret blob is sealed with a key derived from the
// user's unlock passphrase; only the salt + AES-256-GCM blob are stored.
export const CONNECTION_CREDENTIAL_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS connection_credentials (
  connection_fingerprint text PRIMARY KEY,
  mode text NOT NULL,
  base_url text NOT NULL,
  budget_sync_id text NOT NULL,
  label text NOT NULL DEFAULT '',
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
`;

// ── Server-scoped remembered credentials (RD-063 / PR-028a) ──────────────────
// Credentials are server-scoped (mode + URL), so one saved server opens any of
// its budgets. Budget encryption passwords stay per-budget. Both are sealed with
// the same passphrase-derived vault key as the (per-budget) table above.
export const SERVER_CREDENTIAL_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS server_credentials (
  server_fingerprint text PRIMARY KEY,
  mode text NOT NULL,
  base_url text NOT NULL,
  label text NOT NULL DEFAULT '',
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
`;

export const BUDGET_ENCRYPTION_CREDENTIAL_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS budget_encryption_credentials (
  server_fingerprint text NOT NULL,
  budget_sync_id text NOT NULL,
  label text NOT NULL DEFAULT '',
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  PRIMARY KEY (server_fingerprint, budget_sync_id)
);
`;

// ── FX / multi-currency consolidation (RD-056 / PR-025a) ─────────────────────
// The database is the authoritative FX registry; Frankfurter only populates it.
export const FX_RATE_IMPORT_BATCH_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS fx_rate_import_batches (
  id text PRIMARY KEY,
  filename text NOT NULL,
  imported_at text NOT NULL,
  inserted_count integer NOT NULL DEFAULT 0,
  replaced_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  created_by text,
  notes text
);
`;

// Rate stored as a decimal string (high precision); amounts never floated.
export const FX_RATES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS fx_rates (
  id text PRIMARY KEY,
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  requested_date text NOT NULL,
  effective_date text NOT NULL,
  rate text NOT NULL,
  source text NOT NULL,
  provider text,
  status text NOT NULL DEFAULT 'active',
  is_user_override integer NOT NULL DEFAULT 0,
  import_batch_id text REFERENCES fx_rate_import_batches(id) ON DELETE SET NULL,
  derived_from_fx_rate_id text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  created_by text,
  notes text
);
`;

// Immutable per-transaction snapshot: the rate actually applied. source_amount /
// converted_amount are integer minor units (Actual-compatible).
export const TRANSACTION_FX_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS transaction_fx (
  id text PRIMARY KEY,
  transaction_id text NOT NULL,
  fx_rate_id text REFERENCES fx_rates(id) ON DELETE SET NULL,
  source_currency text NOT NULL,
  target_currency text NOT NULL,
  source_amount integer NOT NULL,
  converted_amount integer NOT NULL,
  applied_rate text NOT NULL,
  requested_date text NOT NULL,
  effective_date text NOT NULL,
  source text NOT NULL,
  provider text,
  is_manual integer NOT NULL DEFAULT 0,
  applied_at text NOT NULL,
  updated_at text NOT NULL
);
`;

export const FX_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_fx_rates_pair_requested ON fx_rates(base_currency, quote_currency, requested_date)",
  "CREATE INDEX IF NOT EXISTS idx_fx_rates_pair_effective ON fx_rates(base_currency, quote_currency, effective_date)",
  // At most one active rate per pair + requested date (app also guards in a txn).
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_fx_rates_active_pair_date ON fx_rates(base_currency, quote_currency, requested_date) WHERE status = 'active'",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_fx_transaction ON transaction_fx(transaction_id)",
];
