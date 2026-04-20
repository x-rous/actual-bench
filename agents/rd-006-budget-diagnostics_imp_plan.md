# RD-006 — Budget Diagnostics — Implementation Plan

> Companion to `agents/rd-006-budget-diagnostics.md`.
> Read the spec first; this document only covers *how* we build it.

| | |
|---|---|
| **Branch** | `feat/002-budget-diaganostics-page` (off `main`) |
| **Target** | `main` via single PR, squash-merge |
| **Scope** | Client-side ZIP unpack + SQLite WASM read-only inspector, new nav page, proxy binary patch |
| **Out of scope** | Writing back to `actual-http-api`; persisting snapshots across sessions; arbitrary SQL console; import flow |

---

## Confirmed decisions

- **Export path**: `GET /v1/budgets/{budgetSyncId}/export`. Via the proxy's budget-scoped prefix, this is `path: "/export"`. Required headers are already attached by the proxy: `x-api-key`, `budget-encryption-password` (empty string when not set).
- **Binary transport**: new route `src/app/api/proxy/download/route.ts` — leaves the existing JSON proxy untouched.
- **SQLite WASM assets**: copied to `public/sqlite/` at install-time via a `postinstall` script; loaded same-origin; no CDN.
- **Sidebar placement**: under the existing `tools` group, next to ActualQL.
- **Expected-schema catalog**: sourced directly from `agents/rd-006-budget-diagnostics-ddl.md` (the canonical snapshot DDL); mirrored into `features/budget-diagnostics/lib/expectedSchema.ts` with the DDL's date (2026-04-20) documented in a header.

## Assumptions (still mine — flag if wrong)

- Worker RPC uses plain `postMessage` with a small typed request/response correlator (no `comlink`).
- Auto-fetch runs on page mount when an active connection exists; otherwise the page shows a "Connect a budget first" empty state with a link to `/connect`.
- `PRAGMA integrity_check` is opt-in via a "Run full integrity check" button; it is **not** auto-run.
- Drill-ins open stackable `RowDetailsSheet` panels (right-side sheet) with a back stack — not full-page navigation.

---

## Architecture

```
┌─────────────────────── Client (main thread) ───────────────────────┐
│                                                                    │
│  /budget-diagnostics page                                          │
│     └─ BudgetDiagnosticsView                                       │
│          ├─ OpenSnapshotPanel   (progress + errors + retry)        │
│          ├─ OverviewSection                                        │
│          ├─ DiagnosticsSection                                     │
│          └─ DataBrowserSection                                     │
│                                                                    │
│  lib/exportSnapshot.ts ──► apiDownload() ──► /api/proxy/download   │
│                                                  │                 │
│                                                  ▼                 │
│                               actual-http-api: GET .../export      │
│                                                                    │
│  ArrayBuffer (ZIP)                                                 │
│     └─ sqliteWorkerClient.ts ──► postMessage ──┐                   │
│                                                │                   │
└────────────────────────────────────────────────┼───────────────────┘
                                                 ▼
┌────────────────────────── Web Worker ──────────────────────────────┐
│  workers/sqliteDiagnostics.worker.ts                               │
│     ├─ fflate: unzip → db.sqlite bytes + metadata.json             │
│     ├─ sqlite-wasm: open in-memory DB                              │
│     ├─ schema introspection (sqlite_schema, PRAGMA table_info)     │
│     ├─ overview counts                                             │
│     ├─ diagnostic checks (quick_check, fk_check, pages, …)         │
│     └─ paginated row fetch (on demand)                             │
└────────────────────────────────────────────────────────────────────┘
```

### Why a single worker
All heavy work (unzip + SQLite queries) touches the same `sqlite-wasm` instance. Splitting would force transferring large byte buffers across workers. Keep one worker; multiplex requests with a correlation id.

### Bundle discipline
- The page must be a **dynamic import** (`next/dynamic`, `ssr: false`) so `sqlite-wasm` + `fflate` never enter the shared bundle for other pages.
- The worker module must be loaded via `new Worker(new URL("./workers/sqliteDiagnostics.worker.ts", import.meta.url), { type: "module" })` — Turbopack supports this natively.
- SQLite WASM is served from `public/sqlite/sqlite3.wasm` (copied by postinstall); pass the URL to the worker via init message.

---

## Milestones

Ordered so each merges in a working state. Each bullet = one commit.

### M1 — Binary proxy & download helper (foundation) ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (26 suites, 344 tests, 12 new).

**Files delivered**
- `src/app/api/proxy/serverQueue.ts` (new) — queue + `queueServerRequest` helper.
- `src/app/api/proxy/download/route.ts` (new) — binary passthrough route.
- `src/app/api/proxy/route.ts` (refactored to call `queueServerRequest`).
- `src/app/api/proxy/serverQueue.test.ts` (new) — 6 tests.
- `src/lib/api/client.ts` (added `apiDownload` + `DownloadResult` + RFC 5987 filename parser).
- `src/lib/api/apiDownload.test.ts` (new) — 6 tests.

**Notes for future milestones**
- `apiDownload` returns `{ bytes: ArrayBuffer; filename: string | null; contentType: string }` — M3 will transfer `bytes` to the worker via `postMessage` with a transfer list.
- Download route has a 60s timeout (vs 15s on the JSON route) to tolerate larger exports.
- Both proxy routes share `serverQueueTails`; concurrent export + normal API calls against the same server are still serialized.
- Test files using the native `fetch`/`Response` globals must declare `@jest-environment node` — jsdom does not provide them.

**Scope**
1. Extract `serverQueueTails` + `tryCloseBudget` out of `route.ts` into `serverQueue.ts` so both routes share the serialization (per-server queue is a cross-cutting concern — must not be duplicated).
2. New POST route accepts the same body shape as `/api/proxy` plus `expect: "binary"`. It:
   - serializes via the shared queue.
   - forwards to upstream with `Accept: application/zip, */*`.
   - streams the upstream response body back through `NextResponse` with the upstream `Content-Type` and `Content-Disposition` preserved.
   - logs identically to the JSON proxy (`METHOD STATUS /path (Xms) [reqId]`).
   - on non-2xx: reads as JSON if content-type is JSON, otherwise returns `{ error: "HTTP <status>" }` with the upstream status.
3. `apiDownload(connection, path)` in `src/lib/api/client.ts`:
   - posts to `/api/proxy/download` with the normal `{connection, path, method}` body.
   - resolves `{ bytes: ArrayBuffer; filename?: string; contentType: string }`.
   - throws the same `ApiError` shape on failure.
4. Tests: a mocked upstream returning a small ZIP buffer verifies bytes arrive intact, `Content-Disposition` flows through, 4xx JSON error shape is preserved, queue is shared with the JSON route.

**Acceptance**
- A local curl through the proxy downloads a binary body unchanged.
- JSON proxy tests still pass (shared queue regression).
- Bundle size of non-diagnostics pages unchanged.

---

### M2 — Feature scaffold + nav item (shell) ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (26 suites, 344 tests). `next build` bundle inspection was intentionally not run in the Docker-hosted dev workspace.

**Files delivered**
- `src/app/(app)/budget-diagnostics/page.tsx` (new) — route metadata + page entry.
- `src/app/(app)/budget-diagnostics/BudgetDiagnosticsClient.tsx` (new) — client-only dynamic import wrapper with `ssr: false`.
- `src/features/budget-diagnostics/components/BudgetDiagnosticsView.tsx` (new) — shell composer, read-only notice, active-budget label, and no-connection empty state.
- `src/features/budget-diagnostics/components/OverviewSection.tsx` (new) — empty overview section stub with disabled future download action.
- `src/features/budget-diagnostics/components/DiagnosticsSection.tsx` (new) — empty diagnostics section stub.
- `src/features/budget-diagnostics/components/DataBrowserSection.tsx` (new) — empty data browser section stub.
- `src/features/budget-diagnostics/{hooks,csv,schemas,lib}/` (new) — feature folder baseline for later milestones.
- `src/components/layout/Sidebar.tsx` — added Budget Diagnostics to the `tools` group with `Stethoscope`.

**Notes for future milestones**
- No `sqlite-wasm` or `fflate` dependencies were added in M2.
- The route keeps `page.tsx` as a server component and isolates the `ssr: false` dynamic import in `BudgetDiagnosticsClient.tsx`.
- The no-connection state links to `/connect`; the connected shell renders the three planned workbench sections plus the read-only diagnostics notice.

**Files**
- `src/app/(app)/budget-diagnostics/page.tsx` (new, dynamic import of view)
- `src/features/budget-diagnostics/` skeleton per spec (empty stubs that render "Coming soon")
- `src/components/layout/Sidebar.tsx` (add entry to `tools` group)

**Scope**
- Page is a client component wrapper that dynamically imports `BudgetDiagnosticsView` with `ssr: false`.
- Sidebar: add `{ id: "budget-diagnostics", label: "Budget Diagnostics", href: "/budget-diagnostics", icon: Stethoscope }` to the `tools` group.
- Skeleton view renders three empty sections + the read-only notice.
- Empty state when no active connection: link to `/connect`.

**Acceptance**
- Nav item navigates to `/budget-diagnostics`.
- Running the app with no active connection shows the "Connect a budget first" state.
- No `sqlite-wasm` or `fflate` in the bundle for any other page (`next build` + inspect).

---

### M3 — Worker skeleton + ZIP unpacking ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (27 suites, 348 tests, 4 new). `next build` bundle inspection was intentionally not run in the Docker-hosted dev workspace.

**Files delivered**
- `src/features/budget-diagnostics/workers/sqliteDiagnostics.worker.ts` (new) — worker init + ZIP load path; opens `db.sqlite` read-only in SQLite WASM.
- `src/features/budget-diagnostics/lib/sqliteWorkerClient.ts` (new) — typed request correlator, progress callbacks, transfer-list support, timeout, and cleanup.
- `src/features/budget-diagnostics/lib/zipReader.ts` (new) — `fflate` ZIP unpacker for `db.sqlite` and `metadata.json`.
- `src/features/budget-diagnostics/lib/zipReader.test.ts` (new) — ZIP reader coverage for valid snapshots, missing metadata, missing DB, and invalid metadata.
- `src/features/budget-diagnostics/lib/exportSnapshot.ts` (new) — main-thread export helper using `apiDownload("/export")`, SQLite worker init, and transferred worker bytes.
- `src/features/budget-diagnostics/types.ts` (new) — worker protocol, progress stages, and loaded snapshot summary types.
- `src/types/sqlite-wasm.d.ts` (new) — minimal local typings for the SQLite WASM package.
- `scripts/copy-sqlite-wasm.mjs` (new) — copies `sqlite3.wasm` into `public/sqlite/`.
- `package.json` / `package-lock.json` — added `fflate`, `@sqlite.org/sqlite-wasm`, and `postinstall` wiring.
- `.gitignore` — ignored generated `public/sqlite/sqlite3.wasm`.

**Notes for future milestones**
- `exportSnapshot` clones the downloaded ZIP bytes before transferring to the worker, preserving the original `DownloadResult.bytes` for the M4 Download ZIP action.
- Worker `loadSnapshot` returns a ready summary: DB size, metadata presence, parsed metadata, table count, and view count.
- Later worker messages (`overview`, diagnostics, schema, row fetching) intentionally return "not implemented until a later milestone" errors.
- `sqlite3.wasm` is generated by `postinstall`; it should not be committed.

**Files**
- `src/features/budget-diagnostics/workers/sqliteDiagnostics.worker.ts`
- `src/features/budget-diagnostics/lib/sqliteWorkerClient.ts`
- `src/features/budget-diagnostics/lib/zipReader.ts` (fflate wrapper)
- `src/features/budget-diagnostics/lib/exportSnapshot.ts`
- `src/features/budget-diagnostics/types.ts`
- `scripts/copy-sqlite-wasm.mjs` + `postinstall` wiring in `package.json`
- New deps: `fflate`, `@sqlite.org/sqlite-wasm`

**Scope**
1. `types.ts`: define the worker message protocol.
   ```ts
   type WorkerRequest =
     | { id: string; kind: "init"; wasmUrl: string }
     | { id: string; kind: "loadSnapshot"; zipBytes: ArrayBuffer }
     | { id: string; kind: "overview" }
     | { id: string; kind: "runDiagnostics" }
     | { id: string; kind: "runIntegrityCheck" }
     | { id: string; kind: "listSchemaObjects" }
     | { id: string; kind: "getSchemaObject"; name: string }
     | { id: string; kind: "tableCounts"; names: string[] }
     | { id: string; kind: "fetchRows"; object: string; offset: number; limit: number; orderBy?: string; direction?: "asc" | "desc" };

   type WorkerResponse =
     | { id: string; kind: "progress"; stage: ProgressStage }
     | { id: string; kind: "result"; payload: unknown }
     | { id: string; kind: "error"; message: string };
   ```
2. `sqliteWorkerClient.ts`: singleton client using one `Worker` instance per page. Exposes typed `call<T>(req)` that returns a Promise and surfaces interim `progress` events via an optional callback. Transferable `ArrayBuffer` on `loadSnapshot`.
3. `zipReader.ts`: `unzipSnapshot(bytes): { dbBytes: Uint8Array; metadata: unknown; hadMetadata: boolean }` — runs in the worker, uses fflate's `unzipSync`.
4. `exportSnapshot.ts`: main-thread helper that calls `apiDownload`, transfers the `ArrayBuffer` to the worker via `loadSnapshot`, and streams progress.
5. `scripts/copy-sqlite-wasm.mjs`: copies `node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3.wasm` → `public/sqlite/sqlite3.wasm`. `.gitignore` the wasm file.
6. Worker `init` message loads sqlite-wasm from the passed `wasmUrl`.

**Acceptance**
- Calling `loadSnapshot` with a real export ZIP produces a ready DB handle in the worker.
- Progress messages fire in the right order: `exporting → unpacking → opening → ready`.
- Worker errors surface as typed `ApiError`-like rejections on the client.

---

### M4 — Overview section

**Files**
- `src/features/budget-diagnostics/lib/fileOverviewStats.ts`
- `src/features/budget-diagnostics/components/OverviewSection.tsx`
- `src/features/budget-diagnostics/components/MetadataSummary.tsx`

**Scope**
1. Worker handler `overview` returns:
   ```ts
   type OverviewPayload = {
     metadata: MetadataJson | null;
     file: { dbSizeBytes: number; zipFilename: string; zipSizeBytes: number; hadMetadata: boolean; opened: boolean; zipValid: boolean };
     counts: { tables: number; views: number } & Record<"transactions"|"accounts"|"payees"|"category_groups"|"categories"|"rules"|"schedules"|"tags"|"notes", number>;
   };
   ```
2. Counts come from `SELECT COUNT(*) FROM <t>` per table in a single `Promise.all` inside the worker. Schema-object counts from `sqlite_schema`.
3. `OverviewSection` renders grouped card blocks: **Snapshot counts**, **Metadata**, **File / source**. Use existing `components/ui/card`.
4. "Download ZIP" button lives here — saves the original `ArrayBuffer` via Blob, filename from `Content-Disposition` or `budget-{id}-{YYYY-MM-DD}.zip` fallback.
5. Metadata display handles `null` / missing fields with `—`.

**Acceptance**
- Opening a real snapshot shows all 12 count cards with accurate numbers.
- Metadata fields render exactly the 10 fields listed in the spec.
- Download ZIP saves the same bytes that were fetched (no re-packaging).

---

### M5 — Diagnostics section

**Files**
- `src/features/budget-diagnostics/lib/diagnosticChecks.ts`
- `src/features/budget-diagnostics/lib/expectedSchema.ts`
- `src/features/budget-diagnostics/components/DiagnosticsSection.tsx`
- `src/features/budget-diagnostics/components/DiagnosticsSummaryCards.tsx`
- `src/features/budget-diagnostics/components/DiagnosticsTable.tsx`
- `src/features/budget-diagnostics/lib/diagnosticChecks.test.ts`

**Scope**
1. `expectedSchema.ts` is sourced from `agents/rd-006-budget-diagnostics-ddl.md` (snapshot 2026-04-20). Header comment links back to that file.
   ```ts
   export const DDL_SOURCE_DATE = "2026-04-20";
   export const EXPECTED_TABLES = [
     "__meta__", "__migrations__",
     "accounts", "banks",
     "categories", "category_groups", "category_mapping",
     "created_budgets", "custom_reports",
     "dashboard", "dashboard_pages",
     "kvcache", "kvcache_key",
     "messages_clock", "messages_crdt",
     "notes",
     "payee_locations", "payee_mapping", "payees",
     "pending_transactions", "preferences",
     "reflect_budgets", "rules",
     "schedules", "schedules_json_paths", "schedules_next_date",
     "tags", "transaction_filters", "transactions",
     "zero_budget_months", "zero_budgets",
   ] as const;
   export const EXPECTED_VIEWS = [
     "v_categories", "v_payees", "v_schedules",
     "v_transactions", "v_transactions_internal", "v_transactions_internal_alive",
   ] as const;
   export const FEATURED_VIEWS = ["v_transactions","v_payees","v_categories","v_schedules"] as const;
   export const EXPECTED_COLUMNS: Record<string, readonly string[]> = { /* one entry per table/view */ };
   ```
   Note: `v_transactions_internal` and `v_transactions_internal_alive` are underlying building blocks — present in the expected set but **not** featured in the Data Browser.
2. `diagnosticChecks.ts` runs inside the worker. Pure functions per check, each returning `BudgetDiagnostic[]`. Registry style so adding a check = one entry. Each check gets a stable `code` (e.g. `SQLITE_QUICK_CHECK`, `REL_CATEGORY_ORPHAN_GROUP`).
3. Check catalog:
   - **SQLite**: `quick_check`, `foreign_key_check`, `page_count`, `page_size`, `freelist_count` (always). Run with `PRAGMA foreign_keys = ON` first so `foreign_key_check` actually evaluates the one declared FK on `pending_transactions.acct → accounts.id`.
   - **Schema**: missing expected tables, missing expected views, missing expected columns (diff against `EXPECTED_COLUMNS`), empty tables/views surfaced as `info` (not warning — an empty `banks` table is normal).
   - **Relationships** (left-join `WHERE right.id IS NULL`, excluding `tombstone = 1`):
     - `categories.cat_group` → `category_groups.id` (skip where `cat_group IS NULL`).
     - `schedules.rule` → `rules.id` (skip where `rule IS NULL`).
     - `payees.transfer_acct` → `accounts.id` (skip where `transfer_acct IS NULL`).
     - `payee_mapping.targetId` → `payees.id` (skip where `targetId IS NULL`).
     - `category_mapping.transferId` → `categories.id` (skip where `transferId IS NULL`).
     - `transactions.acct` → `accounts.id` (skip where `acct IS NULL`).
     - `transactions.category` → `categories.id` (skip where `category IS NULL`).
     - `transactions.parent_id` → `transactions.id` where `isChild = 1`.
     - `transactions.transferred_id` → `transactions.id` (skip where NULL).
     - `schedules_next_date.schedule_id` → `schedules.id`.
     - `schedules_json_paths.schedule_id` → `schedules.id`.
     - `dashboard.dashboard_page_id` → `dashboard_pages.id`.
     - `payee_locations.payee_id` → `payees.id`.
     - `reflect_budgets.category` + `zero_budgets.category` → `categories.id` (skip where NULL).
     - Notes with `id` matching `^(account|category|payee|schedule)-[0-9a-f-]{36}$` → matching entity; unresolved → `warning`.
   - **DDL quirks (info)**:
     - `pending_transactions.acct` is declared `INTEGER` but references `accounts.id` which is `TEXT`. Emit one `info` finding explaining the mismatch, code `SCHEMA_PENDING_TXN_ACCT_TYPE`.
     - `transactions` uses camelCase (`isParent`, `isChild`) while `v_transactions_internal` exposes snake_case (`is_parent`, `is_child`). Purely informational; helps users who wonder why column names differ in the Data Browser.
   - **Snapshot**: metadata missing/malformed dates, missing identifiers, `lastScheduleRun < lastUploaded` (info).
4. `integrity_check` only runs on "Run full integrity check" button click.
5. `DiagnosticsSection` lays out summary cards + filtered, grouped-by-severity table using TanStack Table. Column `code` is clickable → opens row in `RowDetailsSheet` when `table` + `rowId` are set.
6. CSV export: "Export findings CSV" button writes `code,severity,title,message,table,rowId,relatedTable,relatedId`. Reuses `src/lib/csv.ts` `csvField`.
7. Unit tests for each check with small in-memory `sqlite-wasm` fixtures (same wasm path used in Jest via `jest.config.js` resolver).

**Acceptance**
- A clean budget produces zero errors.
- A synthetically corrupted DB (delete a `category_groups` row referenced by `categories`) produces the expected orphan warning with `table`, `rowId`, `relatedTable`, `relatedId` all populated.
- CSV export opens in Excel with UTF-8 and no field corruption.

---

### M6 — Data Browser section

**Files**
- `src/features/budget-diagnostics/components/DataBrowserSection.tsx`
- `src/features/budget-diagnostics/components/TableList.tsx`
- `src/features/budget-diagnostics/components/TableBrowser.tsx`
- `src/features/budget-diagnostics/components/SchemaObjectDetails.tsx`
- `src/features/budget-diagnostics/components/RowDetailsSheet.tsx`
- `src/features/budget-diagnostics/lib/relationshipMap.ts`
- `src/features/budget-diagnostics/lib/csvExport.ts`

**Scope**
1. Three-pane layout: left = TableList (search + sort by name / row count); center = TableBrowser; right = optional RowDetailsSheet.
2. `TableList` groups entries into: **Featured views**, **Featured tables**, **System / meta tables**, **Other**. "Featured" lists are those enumerated in the spec.
3. Default selection: `v_transactions` if present, else the first featured view.
4. `TableBrowser`:
   - loads columns via `PRAGMA table_info`.
   - paginated via worker `fetchRows` (page size 100, configurable via URL param `pageSize`).
   - sort by any column (delegated to worker `ORDER BY`).
   - each cell: if column maps to a known foreign relation per `relationshipMap.ts`, render a link that opens `RowDetailsSheet` with the target row.
   - "Copy row JSON" action per row.
   - "Export CSV" downloads **the full table/view** as CSV via a worker streaming cursor — not just the current page. Warn at >100k rows.
5. `relationshipMap.ts` hard-codes the linked columns from the spec.
6. `SchemaObjectDetails`: toggle between "Data" and "Schema" tabs in `TableBrowser`. Schema tab shows object type, row count, `CREATE ...` SQL, columns from `PRAGMA table_info`, indexes from `PRAGMA index_list`.
7. `RowDetailsSheet` is a stackable right-side sheet using `@base-ui/react` (already a dep). Back button pops the stack; close dismisses all.

**Acceptance**
- User can browse `v_transactions`, click a `payee` cell → sheet opens with the payee row.
- CSV export of a 50k row table completes without freezing the UI.
- Schema tab renders `CREATE VIEW v_transactions AS ...` verbatim.

---

### M7 — Polish, safety banner, tests, docs

**Files**
- `src/features/budget-diagnostics/components/BudgetDiagnosticsView.tsx` (top-level composer)
- `src/features/budget-diagnostics/components/OpenSnapshotPanel.tsx`
- `FEATURES.md` (update)
- `README.md` (update if entry points changed)
- `agents/future-roadmap.md` (mark RD-006 status → shipped)

**Scope**
1. `OpenSnapshotPanel`: progress rail using the 6 stages from the spec (Exporting ZIP → Unpacking → Opening SQLite → Reading schema → Computing overview → Running diagnostics). Shows error + "Retry" when export fails.
2. Persistent read-only banner above the three sections: "Read-only diagnostics — no changes are written back to the budget. Export contents are processed locally in the browser."
3. Budget-switch side-effect: on `useConnectionStore` change, clear worker DB and re-run auto-fetch.
4. Integration test (Jest + RTL): render `BudgetDiagnosticsView` with a mocked `apiDownload` returning a fixture ZIP; assert that the three sections render with expected counts. Worker is mocked via a thin fake that exposes the same interface.
5. Lint + typecheck + full test run.

**Acceptance**
- `npm run lint` — 0 errors.
- `npx tsc --noEmit` — 0 errors.
- `npm test` — all suites pass.
- Manual run against a real `actual-http-api` — full flow works end-to-end for at least two budgets with different data shapes.

---

## Data contracts

### Proxy download response
```
POST /api/proxy/download
Body: { connection, path: "/export", method: "GET" }
Response: 200
  Content-Type: application/zip            (from upstream)
  Content-Disposition: attachment; ...     (from upstream, if present)
  <raw bytes>
Error: 4xx/5xx JSON  { error: string }
```

### Worker `BudgetDiagnostic`
As defined in the spec — stored in `types.ts`, never diverge.

### `relationshipMap`
```ts
type Relation = { from: { object: string; column: string }; to: { table: string; column: string } };
export const RELATIONSHIPS: readonly Relation[] = [
  // Featured view → source table
  { from: { object: "v_transactions", column: "account" },        to: { table: "accounts",        column: "id" } },
  { from: { object: "v_transactions", column: "category" },       to: { table: "categories",      column: "id" } },
  { from: { object: "v_transactions", column: "payee" },          to: { table: "payees",          column: "id" } },
  { from: { object: "v_transactions", column: "parent_id" },      to: { table: "transactions",    column: "id" } },
  { from: { object: "v_transactions", column: "transfer_id" },    to: { table: "transactions",    column: "id" } },
  { from: { object: "v_transactions", column: "schedule" },       to: { table: "schedules",       column: "id" } },
  { from: { object: "v_categories",   column: "group" },          to: { table: "category_groups", column: "id" } },
  { from: { object: "v_payees",       column: "transfer_acct" },  to: { table: "accounts",        column: "id" } },
  { from: { object: "v_schedules",    column: "rule" },           to: { table: "rules",           column: "id" } },
  { from: { object: "v_schedules",    column: "_payee" },         to: { table: "payees",          column: "id" } },
  // Raw tables
  { from: { object: "categories",             column: "cat_group" },    to: { table: "category_groups", column: "id" } },
  { from: { object: "schedules",              column: "rule" },         to: { table: "rules",           column: "id" } },
  { from: { object: "payees",                 column: "transfer_acct" },to: { table: "accounts",        column: "id" } },
  { from: { object: "transactions",           column: "acct" },         to: { table: "accounts",        column: "id" } },
  { from: { object: "transactions",           column: "category" },     to: { table: "categories",      column: "id" } },
  { from: { object: "transactions",           column: "parent_id" },    to: { table: "transactions",    column: "id" } },
  { from: { object: "transactions",           column: "transferred_id" },to:{ table: "transactions",    column: "id" } },
  { from: { object: "transactions",           column: "schedule" },     to: { table: "schedules",       column: "id" } },
  { from: { object: "pending_transactions",   column: "acct" },         to: { table: "accounts",        column: "id" } },
  { from: { object: "payee_mapping",          column: "targetId" },     to: { table: "payees",          column: "id" } },
  { from: { object: "category_mapping",       column: "transferId" },   to: { table: "categories",      column: "id" } },
  { from: { object: "payee_locations",        column: "payee_id" },     to: { table: "payees",          column: "id" } },
  { from: { object: "schedules_next_date",    column: "schedule_id" },  to: { table: "schedules",       column: "id" } },
  { from: { object: "schedules_json_paths",   column: "schedule_id" },  to: { table: "schedules",       column: "id" } },
  { from: { object: "dashboard",              column: "dashboard_page_id" }, to: { table: "dashboard_pages", column: "id" } },
  { from: { object: "reflect_budgets",        column: "category" },     to: { table: "categories",      column: "id" } },
  { from: { object: "zero_budgets",           column: "category" },     to: { table: "categories",      column: "id" } },
];
```

---

## Risks and guardrails

| Risk | Mitigation |
|---|---|
| `sqlite-wasm` bundle pollutes other pages | Dynamic import of the view + verify bundle size after `next build` |
| Worker crash silently hangs the UI | Request correlator has a 60s timeout; surface as error + offer Retry |
| Large CSV export freezes the UI | Stream from the worker in 10k-row chunks; write into a `ReadableStream` backing a `Blob`; show progress |
| Binary proxy breaks the JSON queue | Extract `serverQueueTails` into a shared module so both routes share it (tested) |
| Users click "Run full integrity check" on a huge DB | Button shows estimated cost ("may take minutes on large budgets"); always runnable, never blocking other queries |
| Schema drift vs upstream Actual | `expectedSchema.ts` header documents snapshot date + version; missing-column warnings are *warnings* not errors |
| `babel-plugin-react-compiler` + worker | Worker file is outside the compiler's scope; no expected issue, but add an `eslint-disable` comment only if the compiler complains |

---

## Out of scope (explicitly)

- Persisting the snapshot across page reloads / sessions.
- Diffing two snapshots.
- Any write operation (`UPDATE`, `INSERT`, `DELETE`, `VACUUM`, `REINDEX`).
- Arbitrary SQL console (that's RD-007X).
- Import / restore flow.

---

## Before opening the PR

- `npm run lint` / `npx tsc --noEmit` / `npm test` — all green.
- Manual verification on two real budgets of different sizes.
- `FEATURES.md`, `README.md` (if entry points changed), `agents/future-roadmap.md` updated.
- Screenshot of the three sections attached to the PR description.
- Commit style matches `AGENTS.md`: `feat:`, `fix:`, etc. Branch `feat/rd-006-budget-diagnostics`. Author `Manaf`, GitHub user `x-rous`. No auto-commit / auto-push.
