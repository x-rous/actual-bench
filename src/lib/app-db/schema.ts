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

// ── Remembered budgets (RD-063 / PR-028f) ────────────────────────────────────
// Non-secret record of which budgets you've opened on a remembered server, so
// the connect page can offer one-click reconnect straight into a budget (the
// server credential + any per-budget encryption password are revealed behind the
// scenes). Holds no secret material — only the budget's sync id and display name.
export const REMEMBERED_BUDGET_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS remembered_budgets (
  server_fingerprint text NOT NULL,
  budget_sync_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  created_at text NOT NULL,
  last_opened_at text NOT NULL,
  PRIMARY KEY (server_fingerprint, budget_sync_id)
);
`;

// ── Saved ActualQL queries (RD-064 / PR-029) ─────────────────────────────────
// Global to the Actual Bench instance — intentionally NOT budget-scoped, so a
// saved query written against one budget is available from every budget. Holds
// only user-authored ActualQL text (no secrets, no copied budget data).
export const SAVED_QUERY_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS saved_queries (
  id text PRIMARY KEY,
  name text NOT NULL,
  query text NOT NULL,
  is_favorite integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
`;

// ── Payee cleanup suppressions (RD-078 / PR-041d) ────────────────────────────
//
// A user's "these are not duplicates" decisions. Budget-scoped, because payee
// ids and names belong to one budget file.
//
// Both `payee_ids` and `normalized_names` are stored on purpose. Ids are the
// precise key but do not survive the merge or deletion of the payees involved;
// normalized names outlive them but can collide with a genuinely new payee. A
// suppression matches when *either* still identifies the same relationship, and
// the pair as a whole is what is suppressed — never an individual payee, which
// must stay eligible for other clusters.
export const PAYEE_CLEANUP_SUPPRESSION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS payee_cleanup_suppressions (
  id text PRIMARY KEY,
  budget_sync_id text NOT NULL,
  kind text NOT NULL,
  payee_ids text NOT NULL,
  normalized_names text NOT NULL,
  detector_ids text NOT NULL,
  note text,
  created_at text NOT NULL
);
`;

export const PAYEE_CLEANUP_SUPPRESSION_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_payee_cleanup_suppressions_budget
  ON payee_cleanup_suppressions (budget_sync_id);
`;

// ── Rule Diagnostics dismissals (F-103 / PR-049) ─────────────────────────────
// The user's "not a problem" decisions about their own rules. No credentials,
// no budget data — rule ids, content signatures, and the evidence the decision
// was made about.
//
// Two identity columns on purpose. `rule_ids` breaks the moment a rule is
// merged, because merging mints a new id and deletes the originals — which is
// this page's own primary fix. `signatures` survives that, and survives a save
// reassigning a staged rule's id. Matching on either keeps a decision alive
// without letting it silence something the user has never seen.
export const RULE_DIAGNOSTICS_DISMISSAL_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS rule_diagnostics_dismissals (
  id text PRIMARY KEY,
  budget_sync_id text NOT NULL,
  code text NOT NULL,
  rule_ids text NOT NULL,
  signatures text NOT NULL,
  discriminator text,
  note text,
  created_at text NOT NULL
);
`;

export const RULE_DIAGNOSTICS_DISMISSAL_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_rule_diagnostics_dismissals_budget
  ON rule_diagnostics_dismissals (budget_sync_id);
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

// ── Bank statement reconciliation (RD-071 / PR-034a) ─────────────────────────
// A reconciliation session survives navigation, browser restart, and a partial
// Apply. Unlike the sync tables, these rows hold *budget content* — the
// normalized statement the user imported — so the docs call that out and
// sessions are user-deletable.
//
// Nothing here is written to Actual: everything in these tables is a staged
// proposal until the user explicitly applies it.
export const RECONCILIATION_PROFILE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS reconciliation_profiles (
  id text PRIMARY KEY,
  budget_sync_id text NOT NULL,
  account_id text NOT NULL,
  name text NOT NULL,
  -- Column mapping + date/sign/decimal conventions (ColumnMapping).
  mapping_json text NOT NULL,
  -- Matching config incl. the user's text-target selection (MatchConfig).
  match_config_json text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
`;

export const RECONCILIATION_SESSION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS reconciliation_sessions (
  id text PRIMARY KEY,
  budget_sync_id text NOT NULL,
  account_id text NOT NULL,
  account_name text,
  profile_id text REFERENCES reconciliation_profiles(id) ON DELETE SET NULL,
  status text NOT NULL,
  statement_name text,
  statement_start text,
  statement_end text,
  candidate_start text,
  candidate_end text,
  -- Fingerprint of the imported source, for duplicate-statement detection.
  statement_fingerprint text,
  -- Which kind of file the statement came from: 'delimited' | 'ofx' | 'qif'.
  -- Nullable, because a session created before this column has no answer and
  -- guessing one from the filename would present an inference as a fact.
  statement_format text,
  -- Session-level overrides of the profile's match config, when set.
  match_config_json text,
  totals_json text,
  -- Outcome of each apply operation, keyed by operation id. Persisted as each
  -- write happens so an interrupted apply leaves a truthful record of what
  -- already ran, and a retry can skip it rather than repeat it.
  apply_results_json text,
  -- How staged changes are turned into writes: where the statement description
  -- goes on a created transaction, and anything else that shapes the write
  -- rather than the match.
  apply_config_json text,
  -- A short label the user gives a session ("July close", "Q3 audit"), so a
  -- list of reruns and corrections for one account can be told apart by what
  -- they were *for* rather than only by when they were made.
  tag text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  applied_at text
);
`;

export const RECONCILIATION_STATEMENT_ROW_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS reconciliation_statement_rows (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES reconciliation_sessions(id) ON DELETE CASCADE,
  source_row_number integer NOT NULL,
  posted_date text NOT NULL,
  -- Integer minor units, sign preserved exactly.
  amount integer NOT NULL,
  -- The bank's own merchant/payee text (RD-072): what Actual stores as
  -- imported_payee, and the candidate a payee is resolved from. Named for its
  -- destination rather than "description", because the statement's two text
  -- channels go to two different Actual fields.
  imported_payee text NOT NULL,
  -- The bank's separate memo/details field, when the statement supplied one.
  bank_notes text,
  bank_reference text,
  -- A stable bank transaction id (OFX FITID). Matching evidence only: it is
  -- never written as Actual's imported_id, which carries our own deterministic
  -- retry marker.
  external_id text,
  -- Some statements distinguish the transaction date from the posting date.
  transaction_date text,
  -- Foreign-currency transactions: the amount the bank printed in the original
  -- currency, in integer minor units. Persisted because matching uses it as a
  -- second exact key, so a resumed session that lost it would silently stop
  -- matching every foreign purchase.
  original_amount integer,
  original_currency text,
  -- Stable hash of the raw cells; backs the deterministic create marker.
  fingerprint text NOT NULL,
  -- The untouched source row, never overwritten.
  raw_json text NOT NULL
);
`;

export const RECONCILIATION_ITEM_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS reconciliation_items (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES reconciliation_sessions(id) ON DELETE CASCADE,
  -- Arrays, so a later grouped N:M relationship needs no migration. V1 writes
  -- at most one id in each.
  statement_row_ids_json text NOT NULL DEFAULT '[]',
  actual_transaction_ids_json text NOT NULL DEFAULT '[]',
  disposition text NOT NULL,
  reason_code text,
  -- Match evidence: type, confidence, label, tier, structured reasons, and the
  -- evidence source (bench/manual, with native reserved).
  match_json text,
  -- Guardrail classification derived from the Actual snapshot.
  guards_json text,
  -- The snapshot the session matched against, for drift detection before Apply.
  actual_snapshot_json text,
  -- Per-field { original, staged, source } provenance.
  staged_changes_json text,
  updated_at text NOT NULL
);
`;

export const RECONCILIATION_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_reconciliation_sessions_account ON reconciliation_sessions(budget_sync_id, account_id, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_reconciliation_sessions_status ON reconciliation_sessions(status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_reconciliation_statement_rows_session ON reconciliation_statement_rows(session_id, source_row_number)",
  "CREATE INDEX IF NOT EXISTS idx_reconciliation_items_session ON reconciliation_items(session_id)",
  "CREATE INDEX IF NOT EXISTS idx_reconciliation_items_disposition ON reconciliation_items(session_id, disposition)",
  // One profile name per account keeps the "previous profile found" lookup unambiguous.
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_profiles_account_name ON reconciliation_profiles(budget_sync_id, account_id, name)",
] as const;

// ── Automation engine (RD-079 / PR-043a) ─────────────────────────────────────
//
// Job-type-agnostic scheduling. One definition per automation, one row per run.
// Budget File Sync becomes the first registered job type in PR-043c; nothing
// reads these tables until then.
//
// Two shape decisions are deliberate:
//
//   * `consecutive_failures` / `auto_paused_at` live on the definition row.
//     RD-058's scheduler kept them in module-scope Maps that were lost on every
//     restart, so a persistently broken flow re-armed itself after a deploy.
//     Persisting them is what makes auto-pause mean something.
//
//   * `result_json` is a **type-owned** payload, with only a small engine-owned
//     roll-up beside it. The engine must never require a job type to describe
//     itself in another type's vocabulary (a bank sync reports per-account rows;
//     a sync flow reports applied/review/blocked counts).
//
// `credential_ref` is a *reference* — the RD-063 server fingerprint — never a
// secret. Config envelopes are additionally rejected if they carry
// credential-looking fields (see jsonEnvelope's rejectSecrets).
export const AUTOMATION_DEFINITION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS automation_definitions (
  id text PRIMARY KEY,
  type text NOT NULL,
  name text NOT NULL,
  enabled integer NOT NULL DEFAULT 1,
  -- 'browser' (runs only while Bench is open) | 'server' (unattended).
  execution_mode text NOT NULL DEFAULT 'server',
  -- 'interval' | 'cron'. Exactly one of the two fields below is meaningful.
  schedule_kind text NOT NULL DEFAULT 'interval',
  interval_minutes integer,
  cron_expression text,
  -- IANA zone; cron schedules are meaningless without one, and an interval
  -- schedule still needs it to render "next run" honestly.
  timezone text NOT NULL DEFAULT 'UTC',
  -- What this automation acts on (connection/budget/account refs): JSON envelope.
  target_ref_json text NOT NULL,
  -- Vault key (RD-063 server fingerprint). Never a secret.
  credential_ref text,
  -- Type-owned configuration, validated by the job type's validateConfig.
  config_json text NOT NULL,
  -- Retry limit / backoff / pause threshold overrides.
  failure_policy_json text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  auto_paused_at text,
  auto_pause_reason text,
  last_run_at text,
  last_success_at text,
  next_run_at text,
  -- Claimed-for-execution marker. The in-memory lock cannot be trusted alone:
  -- Next evaluates route modules separately from the server boot context, so an
  -- external cron POSTing the trigger endpoint runs against a *different* module
  -- instance from the interval loop and would not see its in-flight set. The
  -- claim is taken in the database, where both instances can see it.
  running_since text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
`;

export const AUTOMATION_RUN_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS automation_runs (
  id text PRIMARY KEY,
  automation_id text REFERENCES automation_definitions(id) ON DELETE CASCADE,
  -- Denormalized so a run stays readable (and renderable by its type) after its
  -- definition is deleted.
  type text NOT NULL,
  status text NOT NULL,
  started_at text NOT NULL,
  finished_at text,
  -- 'schedule' | 'manual' | 'retry'.
  trigger text NOT NULL DEFAULT 'schedule',
  attempt integer NOT NULL DEFAULT 1,
  execution_mode text NOT NULL DEFAULT 'server',
  -- Type-owned result payload, rendered by the job type.
  result_json text,
  -- Engine-derived cross-type roll-up: outcome + item count.
  rollup_json text,
  error_json text
);
`;

export const AUTOMATION_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_started ON automation_runs(automation_id, started_at)",
  "CREATE INDEX IF NOT EXISTS idx_automation_definitions_type_updated ON automation_definitions(type, updated_at)",
  // The scheduler's selection query: enabled automations ordered by when they are due.
  "CREATE INDEX IF NOT EXISTS idx_automation_definitions_due ON automation_definitions(enabled, next_run_at)",
] as const;

// ── Verified backup & recovery (RD-077 / PR-047a) ────────────────────────────
//
// Four tables, because the relationships are genuinely not one-to-one and
// flattening them would lose the distinction the feature exists to make:
//
//   * a *destination* fails independently of any run that used it, so its
//     health lives with it;
//   * an *artifact* is one thing that was backed up — its identity, contents
//     and verification belong to it, not to the place it landed;
//   * a *location* is one copy of that artifact in one destination. An artifact
//     in two destinations is one artifact in two places, and a failure in one
//     of them must never read as a failure of both.
//
// No table holds a secret. S3 credentials and any backup passphrase are vault
// references; the envelope guard rejects credential-shaped fields in config.
export const BACKUP_DESTINATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS backup_destinations (
  id text PRIMARY KEY,
  name text NOT NULL,
  -- 'local' | 's3'
  kind text NOT NULL,
  enabled integer NOT NULL DEFAULT 1,
  -- Non-secret settings: an absolute path, or bucket/region/endpoint/prefix.
  config_json text NOT NULL,
  -- Vault fingerprint for the destination's credentials. Never a secret.
  credential_ref text,
  last_success_at text,
  last_failure_at text,
  last_failure_reason text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
`;

export const BACKUP_POLICY_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS backup_policies (
  id text PRIMARY KEY,
  name text NOT NULL,
  enabled integer NOT NULL DEFAULT 1,
  -- 'budget' | 'app-db' | 'both'
  contents text NOT NULL DEFAULT 'both',
  -- Which connection/budget this policy backs up: JSON envelope.
  source_ref_json text NOT NULL,
  -- Ordered destination ids; a policy fans out to all of them.
  destination_ids_json text NOT NULL DEFAULT '[]',
  -- 'archive' | 'data' | 'deep'
  verification_level text NOT NULL DEFAULT 'data',
  -- 'none' | 'passphrase'
  encryption text NOT NULL DEFAULT 'none',
  -- Vault fingerprint for a remembered backup passphrase, so unattended scrub
  -- can re-verify encrypted artifacts. Absent means scrub reports that it
  -- cannot read them rather than pretending it did.
  encryption_credential_ref text,
  -- Tiers, minimum age, and the automatic-safety-point protection window.
  retention_json text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
`;

export const BACKUP_ARTIFACT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS backup_artifacts (
  id text PRIMARY KEY,
  -- Null for an artifact discovered from a manifest whose policy is gone: the
  -- file is still real and still restorable, which is the whole point.
  policy_id text REFERENCES backup_policies(id) ON DELETE SET NULL,
  -- 'budget' | 'app-db'
  kind text NOT NULL,
  created_at text NOT NULL,
  source_budget_id text,
  source_budget_name text,
  size_bytes integer NOT NULL DEFAULT 0,
  -- Of the bytes as stored. When encrypted, plaintext_checksum_sha256 is of
  -- the archive before encryption, so a restore can be checked end to end.
  checksum_sha256 text NOT NULL,
  plaintext_checksum_sha256 text,
  encrypted integer NOT NULL DEFAULT 0,
  -- KDF, salt and IV. Never the key.
  encryption_json text,
  -- 'manual' | 'auto' | 'daily' | 'weekly' | 'monthly' | 'yearly'
  tier text NOT NULL DEFAULT 'manual',
  -- A user pin is permanent; protected_until is the automatic safety point's
  -- window, after which it prunes like anything else.
  pinned integer NOT NULL DEFAULT 0,
  protected_until text,
  -- "before payee cleanup apply" — what makes the inventory read as history.
  taken_before text,
  verification_level text,
  -- 'unverified' | 'passed' | 'failed'
  verification_status text NOT NULL DEFAULT 'unverified',
  verified_at text,
  -- Counts, date range, integrity result, anomaly findings.
  verification_json text,
  manifest_version integer NOT NULL DEFAULT 1,
  bench_version text,
  notes text
);
`;

export const BACKUP_ARTIFACT_LOCATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS backup_artifact_locations (
  id text PRIMARY KEY,
  artifact_id text NOT NULL REFERENCES backup_artifacts(id) ON DELETE CASCADE,
  destination_id text REFERENCES backup_destinations(id) ON DELETE SET NULL,
  -- Absolute path, or object key within the destination's prefix.
  object_key text NOT NULL,
  -- 'stored' | 'failed' | 'missing' | 'deleted'
  status text NOT NULL DEFAULT 'stored',
  uploaded_at text,
  last_verified_at text,
  last_error text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
`;

export const BACKUP_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_backup_artifacts_policy_created ON backup_artifacts(policy_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_backup_artifacts_kind_created ON backup_artifacts(kind, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_backup_locations_artifact ON backup_artifact_locations(artifact_id)",
  "CREATE INDEX IF NOT EXISTS idx_backup_locations_destination ON backup_artifact_locations(destination_id, status)",
  // One row per copy: the same artifact cannot be recorded twice in one place.
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_locations_unique ON backup_artifact_locations(artifact_id, destination_id, object_key)",
] as const;

// ── Backup credentials (RD-077 / PR-047b) ────────────────────────────────────
//
// Sealed secrets for backup destinations and backup encryption, kept apart from
// the sync vault because they answer to a different question: "what does Bench
// need to write this copy", not "what does Bench need to reach your budget".
// Same sealing (AES-256-GCM under SYNC_VAULT_KEY); the key is never stored.
export const BACKUP_CREDENTIAL_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS backup_credentials (
  ref text PRIMARY KEY,
  -- 's3' | 'passphrase'
  kind text NOT NULL,
  label text NOT NULL DEFAULT '',
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
`;

