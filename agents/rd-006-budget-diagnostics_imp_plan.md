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

**Execution order (authoritative):**

| # | Milestone | State |
|---|---|---|
| 1  | M1 — Binary proxy & download helper | ✅ shipped (3fbd69e) |
| 2  | M2 — Feature scaffold + nav item | ✅ shipped (18f2378) |
| 3  | M3 — Worker skeleton + ZIP unpacking | ✅ shipped (a7b9cde) |
| 4  | M4 — Overview section | ✅ shipped (69bb4c6) |
| 5  | M5 — Diagnostics section | ✅ shipped (347c6e3) |
| 6  | M5.1 — Relationship map unification + M5 corrections | ✅ shipped |
| 7  | M6-pre — Workbench tab structure | ✅ shipped |
| 8  | M6a — Data Browser worker read API + schema catalog | ✅ shipped |
| 9  | M6b — Data Browser shell + object list | ✅ shipped |
| 10 | M6c — Paginated Table Browser | ✅ shipped |
| 11 | M6d — Schema Explorer tab | ✅ shipped |
| 12 | M6e — Relationship-aware drill-in + row details (depends on M5.1) | ✅ shipped |
| 13 | M6f — Full object CSV export | planned |
| 14 | M7 — Polish, banner, tests, docs, PR prep | planned |

The old standalone `M8-rev` milestone has been merged into M5.1 — do not resurrect it. M5.1 is the single corrective milestone that introduces `relationshipMap.ts`, fixes the raw/view confusion in shipped M5, and adds the missing `payees.category` and `transactions.description → payee_mapping` checks.

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

### M4 — Overview section ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (28 suites, 351 tests, 3 new). `next build` bundle inspection was intentionally not run in the Docker-hosted dev workspace. Manual real-budget verification is still pending until an active Actual server/budget is available.

**Files delivered**
- `src/features/budget-diagnostics/types.ts` — added `MetadataJson`, `OverviewPayload`, count keys, and typed `overview` worker result.
- `src/features/budget-diagnostics/workers/sqliteDiagnostics.worker.ts` — stores loaded snapshot file metadata and implements `overview` with schema counts plus fixed key table counts.
- `src/features/budget-diagnostics/lib/exportSnapshot.ts` — passes ZIP filename and byte size into the worker while preserving original ZIP bytes for download.
- `src/features/budget-diagnostics/lib/zipReader.ts` — returns parsed metadata as `MetadataJson`.
- `src/features/budget-diagnostics/lib/fileOverviewStats.ts` (new) — byte/count formatting and 12-card overview metric builder.
- `src/features/budget-diagnostics/lib/fileOverviewStats.test.ts` (new) — formatter and metric-list coverage.
- `src/features/budget-diagnostics/components/BudgetDiagnosticsView.tsx` — auto-opens the active budget snapshot, tracks progress/error/overview/download state, supports retry, and cleans up the worker on connection/page changes.
- `src/features/budget-diagnostics/components/OverviewSection.tsx` — renders loading/error states, snapshot count cards, metadata, file/source details, and the Download ZIP action.
- `src/features/budget-diagnostics/components/MetadataSummary.tsx` (new) — renders the 10 required metadata fields with `—` for missing values.

**Notes for future milestones**
- Missing key tables count as `0` in Overview so schema drift does not block snapshot rendering; M5 diagnostics will surface missing schema objects explicitly.
- Download ZIP uses the original `DownloadResult.bytes` from M3, not the worker-transferred copy.
- The fallback filename is `budget-{budgetSyncId}-{YYYY-MM-DD}.zip` when upstream `Content-Disposition` does not provide one.
- `OverviewSection` uses existing local bordered panel/card styling because the repo does not currently include `src/components/ui/card.tsx`.

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

### M5 — Diagnostics section ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (29 suites, 358 tests, 7 new). `npm run lint` reports the expected React Compiler `react-hooks/incompatible-library` warning for TanStack Table. `next build` bundle inspection was intentionally not run in the Docker-hosted dev workspace. Manual real-budget verification is still pending.

**Files delivered**
- `src/features/budget-diagnostics/types.ts` — added `BudgetDiagnostic`, severity, and diagnostics payload/result typing.
- `src/features/budget-diagnostics/lib/expectedSchema.ts` (new) — expected tables, views, featured views, and column catalog mirrored from `agents/rd-006-budget-diagnostics-ddl.md` snapshot date `2026-04-20`.
- `src/features/budget-diagnostics/lib/diagnosticChecks.ts` (new) — diagnostic engine with SQLite health/storage checks, schema checks, relationship checks, DDL quirk findings, snapshot metadata checks, and manual full integrity check.
- `src/features/budget-diagnostics/lib/diagnosticChecks.test.ts` (new) — fake-adapter tests for clean snapshots, orphan category groups, id-less relationship tables, malformed metadata, Actual vector-clock timestamps, and integrity check results.
- `src/features/budget-diagnostics/workers/sqliteDiagnostics.worker.ts` — added a SQLite adapter for diagnostics plus `runDiagnostics` and `runIntegrityCheck` worker handlers.
- `src/features/budget-diagnostics/components/BudgetDiagnosticsView.tsx` — runs diagnostics after the snapshot overview loads, tracks diagnostics/integrity states, appends integrity-check results, and surfaces structured worker errors.
- `src/features/budget-diagnostics/components/DiagnosticsSection.tsx` — diagnostics panel with loading/error states, manual full integrity-check action, and findings CSV export.
- `src/features/budget-diagnostics/components/DiagnosticsSummaryCards.tsx` (new) — total/error/warning/info summary cards.
- `src/features/budget-diagnostics/components/DiagnosticsTable.tsx` (new) — TanStack Table findings browser with severity filtering and sorting.

**Notes for future milestones**
- `RowDetailsSheet` remains in M6; M5 findings include `table`, `rowId`, `relatedTable`, and `relatedId` so drill-in can be wired later.
- Unit tests use a focused fake `DiagnosticDb` adapter instead of booting SQLite WASM in Jest; the worker uses the same adapter contract against the real opened SQLite DB.
- `schedules_json_paths` has no `id` column, so relationship diagnostics use the relationship column as row context when a source table lacks `id`.
- Actual sync timestamps with vector-clock suffixes, for example `2026-04-12T12:24:26.880Z-0011-...`, are accepted as valid metadata dates.

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

### M5.1 — Relationship map unification + M5 corrections ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (30 suites, 367 tests, 9 new). `npm run lint` reports the expected React Compiler `react-hooks/incompatible-library` warning for TanStack Table. `next build` bundle inspection was intentionally not run in the Docker-hosted dev workspace.

**Files delivered**
- `src/features/budget-diagnostics/lib/relationshipMap.ts` (new) — single relationship catalog shared by M5 diagnostics and later M6e drill-in.
- `src/features/budget-diagnostics/lib/relationshipMap.test.ts` (new) — contract tests for unique codes and schema-valid object/column references.
- `src/features/budget-diagnostics/lib/diagnosticChecks.ts` — refactored relationship diagnostics to consume `RELATIONSHIPS.filter(r => r.kind === "raw")`, honor `to.column`, apply catalog severities, and keep tombstone/row-context behavior.
- `src/features/budget-diagnostics/lib/diagnosticChecks.test.ts` — replaced the shallow clean fixture with a linked fixture and added regression coverage for corrected category/payee mapping checks.

**Notes for future milestones**
- `REL_TRANSACTION_ORPHAN_CATEGORY` is retired. Use `REL_TRANSACTION_ORPHAN_CATEGORY_MAPPING`.
- Raw `transactions.category` now validates against `category_mapping.id`; raw `transactions.description` now validates against `payee_mapping.id`.
- `payees.category -> categories.id` is now checked.
- `transactions.transferred_id` and `transactions.schedule` orphan findings are intentionally `info`, not `warning`.
- M6e must import `relationshipMap.ts`; it should not create a second relationship list.

**Why this exists**

Three gaps were found in the shipped M5 relationship checks:

1. Raw `transactions.category` is validated against `categories.id`, but Actual's storage model resolves raw category ids through the mapping layer: `transactions.category → category_mapping.id → category_mapping.transferId → categories.id`. The direct check produces false orphans on a healthy snapshot.
2. The raw payee mapping leg `transactions.description → payee_mapping.id` (and downstream `payee_mapping.targetId → payees.id`) is not validated at all.
3. `payees.category → categories.id` (a direct FK — payees can reference a default category) is missing from every map and every check.

M6e also needs a canonical relationship catalog for Data Browser drill-in. Creating that catalog once, now, and having M5 consume it removes the drift risk before Data Browser is built. This replaces the pre-existing "M8-rev" plan item.

**Confirmed answers (authoritative — from `agents/rd-006-budget-diagnostics_db_schema_and_business_logic.md` and `..._db_schema_technical_reference.md`)**

- `reflect_budgets.category` → `categories.id` — **direct**. Keep existing M5 check as-is.
- `zero_budgets.category`    → `categories.id` — **direct**. Keep existing M5 check as-is.
- `payees.category`          → `categories.id` — **direct**. **Add** a new M5 check.
- `transactions.category`    → `category_mapping.id` (raw), then `category_mapping.transferId → categories.id`. **Correct** the existing check.
- `transactions.description` → `payee_mapping.id`   (raw), then `payee_mapping.targetId → payees.id`. **Add** the missing check.

**Files**
- `src/features/budget-diagnostics/lib/relationshipMap.ts` (new — single source of truth for M5 and M6e)
- `src/features/budget-diagnostics/lib/relationshipMap.test.ts` (new — contract tests)
- `src/features/budget-diagnostics/lib/diagnosticChecks.ts` (refactor to consume the map)
- `src/features/budget-diagnostics/lib/diagnosticChecks.test.ts` (extend regression coverage)
- `src/features/budget-diagnostics/types.ts` (only if the new diagnostic codes below change the `BudgetDiagnostic` shape — they should not)

**Scope**

1. **Create `relationshipMap.ts`.** One typed array, read by both M5 diagnostics and M6e Data Browser drill-in. Do not fork the list anywhere else.
   ```ts
   export type RelationshipKind = "view" | "raw";
   export type RelationshipSeverity = "warning" | "info";

   export type Relationship = {
     code: string;                   // stable diagnostic code, also used by M6e drill-in
     kind: RelationshipKind;         // "raw" → orphan-checked by M5; "view" → drill-in target only
     from: { object: string; column: string };
     to:   { table: string;  column: string };
     title: string;                  // user-facing finding title (raw kind only)
     severity: RelationshipSeverity; // default severity for orphan findings (raw kind only)
     skipWhere?: string;             // optional SQL predicate applied to the left side before the orphan join
   };

   export const RELATIONSHIPS: readonly Relationship[] = [ /* see catalog below */ ];
   ```

2. **Authoritative relationship catalog.** This is the full list — do not add, remove, or retarget entries without updating this plan.

   **Raw-storage relationships** (M5 runs orphan checks on these):

   | code | from | to | severity | notes |
   |---|---|---|---|---|
   | `REL_CATEGORY_ORPHAN_GROUP` | `categories.cat_group` | `category_groups.id` | warning | |
   | `REL_SCHEDULE_ORPHAN_RULE` | `schedules.rule` | `rules.id` | warning | |
   | `REL_PAYEE_ORPHAN_TRANSFER_ACCOUNT` | `payees.transfer_acct` | `accounts.id` | warning | |
   | `REL_PAYEE_ORPHAN_CATEGORY` | `payees.category` | `categories.id` | warning | **new** |
   | `REL_PAYEE_MAPPING_ORPHAN_TARGET` | `payee_mapping.targetId` | `payees.id` | warning | |
   | `REL_CATEGORY_MAPPING_ORPHAN_TRANSFER` | `category_mapping.transferId` | `categories.id` | warning | |
   | `REL_TRANSACTION_ORPHAN_ACCOUNT` | `transactions.acct` | `accounts.id` | warning | |
   | `REL_TRANSACTION_ORPHAN_CATEGORY_MAPPING` | `transactions.category` | `category_mapping.id` | warning | **corrected** — retires `REL_TRANSACTION_ORPHAN_CATEGORY` |
   | `REL_TRANSACTION_ORPHAN_PAYEE_MAPPING` | `transactions.description` | `payee_mapping.id` | warning | **new** |
   | `REL_TRANSACTION_ORPHAN_PARENT` | `transactions.parent_id` | `transactions.id` | warning | `skipWhere: "isChild = 1"` inverted — apply only to rows where `isChild = 1` |
   | `REL_TRANSACTION_ORPHAN_TRANSFER` | `transactions.transferred_id` | `transactions.id` | info | stale-lifecycle softening |
   | `REL_TRANSACTION_ORPHAN_SCHEDULE` | `transactions.schedule` | `schedules.id` | info | stale-lifecycle softening |
   | `REL_SCHEDULE_NEXT_DATE_ORPHAN_SCHEDULE` | `schedules_next_date.schedule_id` | `schedules.id` | warning | |
   | `REL_SCHEDULE_JSON_PATHS_ORPHAN_SCHEDULE` | `schedules_json_paths.schedule_id` | `schedules.id` | warning | |
   | `REL_DASHBOARD_ORPHAN_PAGE` | `dashboard.dashboard_page_id` | `dashboard_pages.id` | warning | |
   | `REL_PAYEE_LOCATION_ORPHAN_PAYEE` | `payee_locations.payee_id` | `payees.id` | warning | |
   | `REL_REFLECT_BUDGET_ORPHAN_CATEGORY` | `reflect_budgets.category` | `categories.id` | warning | direct — confirmed |
   | `REL_ZERO_BUDGET_ORPHAN_CATEGORY` | `zero_budgets.category` | `categories.id` | warning | direct — confirmed |

   **View relationships** (M6e drill-in targets only — not orphan-checked):

   | from | to |
   |---|---|
   | `v_transactions.account` | `accounts.id` |
   | `v_transactions.category` | `categories.id` (the view already resolves the mapping) |
   | `v_transactions.payee` | `payees.id` |
   | `v_transactions.parent_id` | `transactions.id` |
   | `v_transactions.transfer_id` | `transactions.id` |
   | `v_transactions.schedule` | `schedules.id` |
   | `v_categories.group` | `category_groups.id` |
   | `v_payees.transfer_acct` | `accounts.id` |
   | `v_schedules.rule` | `rules.id` |
   | `v_schedules._payee` | `payees.id` |

3. **Diagnostic code compatibility.**
   - `REL_TRANSACTION_ORPHAN_CATEGORY` is **retired**. Replace with `REL_TRANSACTION_ORPHAN_CATEGORY_MAPPING`. Document the rename in the commit message; diagnostics CSV is new-enough that no external consumer should depend on the old code.
   - All other existing codes from shipped M5 are preserved.
   - Every new code must have a stable title and message template.

4. **Refactor `diagnosticChecks.ts`.**
   - Replace the inline `RELATIONSHIP_CHECKS` array with `import { RELATIONSHIPS } from "./relationshipMap"` and iterate `RELATIONSHIPS.filter(r => r.kind === "raw")`.
   - Preserve existing behavior: tombstone filtering on both sides, `hasColumn` guards, `rowId` fallback for id-less tables (e.g. `schedules_json_paths`), per-check `LIMIT 100` cap.
   - Apply severity from `Relationship.severity`, not a hard-coded `warning`.
   - Apply `skipWhere` verbatim — the generic runner must not special-case columns.

5. **Message wording** must distinguish layers so a reader can tell where a finding comes from without looking up the code:
   - Raw-storage wording: `"{from.object}.{from.column} references a missing {to.table} row"` or `"... contains a stale raw reference to {to.table}"` for softened `info` severity.
   - View wording (M6e only, no orphan check): `"{from.object}.{from.column} resolves to a missing live {to.table} entity"` — only surfaced if Data Browser attempts a drill-in lookup that comes back empty.

6. **Severity policy.**
   - Structural orphans that break the normalized read model → `warning`.
   - Orphans that represent stale lifecycle artifacts the normalized views already filter (`transactions.transferred_id`, `transactions.schedule`) → `info`.
   - **Do not** downgrade findings that break the read model.
   - Do not change the severity of any shipped check except the two explicitly softened in the catalog above.

7. **Replace the test fixture.**
   - Current "clean snapshot" fixture used `{ id }`-only rows; it cannot validate the mapping chain.
   - New minimal linked fixture must exercise: `accounts`, `category_groups`, `categories`, `category_mapping`, `payees`, `payee_mapping`, `transactions`. Clean fixture must prove **zero** relationship errors under the corrected mapping.
   - Add regression tests for each of the following corrupted fixtures, asserting exactly one finding with populated `table`, `rowId`, `relatedTable`, `relatedId`:
     - missing `category_mapping.id` referenced by `transactions.category`
     - missing `payee_mapping.id` referenced by `transactions.description`
     - missing `categories.id` referenced by `category_mapping.transferId`
     - missing `payees.id` referenced by `payee_mapping.targetId`
     - missing `categories.id` referenced by `payees.category`
   - Keep existing coverage for category groups, schedules, dashboard pages, `payees.transfer_acct`, notes, `reflect_budgets.category`, `zero_budgets.category`, and the self-relations.

8. **Tighten the fake `DiagnosticDb` adapter.**
   - The adapter must match against any target column, not assume `right.id`. The generic runner already passes the target column through from the map; the adapter must honor it.
   - Keep the existing `rowId` fallback for source tables without an `id` column (e.g. `schedules_json_paths`).

9. **Add `relationshipMap.test.ts`** — contract tests that assert:
   - every `Relationship.code` is unique
   - every `from.object` is either in `EXPECTED_TABLES` or `EXPECTED_VIEWS`
   - every `to.table` is in `EXPECTED_TABLES`
   - every `from.column` exists in `EXPECTED_COLUMNS[from.object]`
   - every `to.column` exists in `EXPECTED_COLUMNS[to.table]`

**Acceptance**
- `relationshipMap.ts` is the only place relationships are declared; `diagnosticChecks.ts` and (later) M6e both import from it.
- Lint / `tsc --noEmit` / `npm test` — all green.
- Clean linked fixture produces zero relationship errors under the corrected mapping.
- Each corrupted fixture listed above produces one targeted finding with `table`, `rowId`, `relatedTable`, and `relatedId` populated and the expected severity.
- Shipped checks for category groups, schedules, dashboard pages, `payees.transfer_acct`, notes, `reflect_budgets.category`, and `zero_budgets.category` continue to pass unchanged.
- Diagnostics CSV export schema (`code,severity,title,message,table,rowId,relatedTable,relatedId`) is unchanged.
- `REL_TRANSACTION_ORPHAN_CATEGORY` is retired in favor of `REL_TRANSACTION_ORPHAN_CATEGORY_MAPPING`; retirement is documented in the commit message.

**Sequencing notes**
- Must land before M6-pre. M6e consumes `relationshipMap.ts` directly — it does not fork a parallel list.
- After this ships, M6e's scope changes from "build a relationship map" to "read `relationshipMap.ts` for drill-in targets."

---

### M6-pre — Workbench tab structure + section summaries ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (30 suites, 367 tests). `npm run lint` reports the expected React Compiler `react-hooks/incompatible-library` warning for TanStack Table. `next build` bundle inspection was intentionally not run in the Docker-hosted dev workspace.

**Files delivered**
- `src/features/budget-diagnostics/components/BudgetDiagnosticsView.tsx` — replaced the vertical Overview / Diagnostics / Data Browser stack with URL-backed top-level tabs using `?tab=overview|diagnostics|data`.
- `src/features/budget-diagnostics/components/OverviewSection.tsx` — removed the outer bordered/shadowed section shell so the Overview tab reads as page content rather than a card.
- `src/features/budget-diagnostics/components/DiagnosticsSection.tsx` — removed the outer bordered/shadowed section shell and passed run/integrity state into the diagnostics cards.
- `src/features/budget-diagnostics/components/DiagnosticsSummaryCards.tsx` — added `Run state` and `Integrity` cards alongside total/errors/warnings/info.
- `src/features/budget-diagnostics/components/DataBrowserSection.tsx` — removed the outer bordered/shadowed section shell.
- `src/features/budget-diagnostics/components/WorkbenchSummaryBar.tsx` (new) — retained only the shared `WorkbenchTab` type and a commented Data Browser summary placeholder for the future Data Browser phase.

**Notes for future milestones**
- The page no longer has the large top header (`Tools`, `Budget Diagnostics`, separate active-budget box). The tab row is the first page-level control.
- The read-only safety copy is now a compact inline status beside the tabs.
- The tab styling intentionally matches `src/features/query/components/QueryWorkspace.tsx`: bottom border, primary active underline, compact text, and count pill.
- Overview and Diagnostics summary bars were removed after review. Diagnostics run state and integrity state now live in `DiagnosticsSummaryCards`.
- Data Browser summary behavior is intentionally commented out until M6a/M6b introduce real schema object state.
- Tab changes update URL state only; they do not refetch or reopen the snapshot.

**Why this exists**
The current page stacks Overview, Diagnostics, and Data Browser vertically. That makes the diagnostics workspace feel like one long report and forces users to scroll past sections they are not using. Before expanding Data Browser, restructure the page into a tabbed workbench so each major capability has a focused surface and a compact summary.

**Files**
- `src/features/budget-diagnostics/components/BudgetDiagnosticsView.tsx`
- `src/features/budget-diagnostics/components/OverviewSection.tsx`
- `src/features/budget-diagnostics/components/DiagnosticsSection.tsx`
- `src/features/budget-diagnostics/components/DataBrowserSection.tsx`
- `src/features/budget-diagnostics/components/WorkbenchSummaryBar.tsx` (new, optional shared summary shell)
- `src/features/budget-diagnostics/types.ts`

**Scope**
1. Replace the vertical section stack with three top-level tabs:
   - **Overview**
   - **Diagnostics**
   - **Data Browser**
2. Keep the persistent page-level read-only banner above the tabs.
3. Add a compact tab summary row above the tab content. Each tab should expose a section-specific summary:
   - Overview: budget name, tables, views, transaction count, DB size, export/open status.
   - Diagnostics: total findings, errors, warnings, infos, last integrity-check state.
   - Data Browser: schema object count, featured view availability, selected object, selected object row count.
4. Tab triggers should include concise counts where useful:
   - `Overview`
   - `Diagnostics` plus warning/error count when diagnostics have run.
   - `Data Browser` plus selected object name or object count when loaded.
5. Preserve current auto-load behavior:
   - User opens Budget Diagnostics.
   - Snapshot exports and opens automatically.
   - Overview and Diagnostics data are computed in the background.
   - User can switch tabs while loading states remain visible.
6. Use existing `components/ui/tabs.tsx`; do not add a new tab library.
7. Keep section components self-contained:
   - `OverviewSection` renders only Overview tab content.
   - `DiagnosticsSection` renders only Diagnostics tab content.
   - `DataBrowserSection` renders only Data Browser tab content.
8. Avoid hidden coupling between tabs. Shared state lives in `BudgetDiagnosticsView`; section-level UI state stays local to each section unless it needs URL persistence.
9. **URL state (whole feature, reserved here):** active tab persists as `?tab=overview|diagnostics|data`. M6c will add `obj`, `p`, `ps`, `sort`, `dir` in the same query string — pick these names now so they do not collide. Missing/invalid `tab` falls back to `overview`.
10. **Per-tab error isolation:** if one section reports a worker error (e.g. `runDiagnostics` throws), only that tab renders the error; the other two tabs stay usable. Do not introduce a page-level error state that blanks the whole workbench.

**UI / UX guidance**
- The first viewport should show the read-only banner, tab bar, summary row, and the active tab's first content without requiring long scrolling.
- The summary row should be dense and scannable, not a second dashboard.
- The active tab content should own the available vertical space. Data Browser in particular should use a fixed-height workbench layout with internal scroll regions.
- Avoid nested cards. Use page-level bands/panels and small metric tiles only where they clarify the active tab.
- Keep all user-facing language focused on the exported snapshot, not the live budget.

**Acceptance**
- Overview, Diagnostics, and Data Browser are reachable through top-level tabs.
- Each tab shows a useful summary at the top.
- Switching tabs does not refetch or reopen the snapshot.
- Existing Overview and Diagnostics functionality still works.
- No `sqlite-wasm` / `fflate` leakage into unrelated routes.

---

### M6a — Data Browser worker read API + schema catalog ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (31 suites, 374 tests, 7 new). `npm run lint` reports the expected React Compiler `react-hooks/incompatible-library` warning for TanStack Table. `next build` bundle inspection was intentionally not run in the Docker-hosted dev workspace.

**Files delivered**
- `src/features/budget-diagnostics/types.ts` — added schema object, column, index, row-key, table-count, and row-fetch payload types; worker result mapping now returns typed M6a payloads.
- `src/features/budget-diagnostics/lib/sqlIdentifier.ts` (new) — strict SQL identifier quoting, known-object/column assertions, and exact `asc` / `desc` direction validation.
- `src/features/budget-diagnostics/lib/schemaObjects.ts` (new) — pure schema catalog/read helpers for `listSchemaObjects`, `getSchemaObject`, `tableCounts`, `fetchRows`, row counts, indexes, raw SQL, primary-key inference, and fetch bounds.
- `src/features/budget-diagnostics/lib/schemaObjects.test.ts` (new) — fake-adapter coverage for schema listing, details, paginated sorted rows, invalid input rejection, table counts, row-key inference, and identifier helpers.
- `src/features/budget-diagnostics/workers/sqliteDiagnostics.worker.ts` — wired M6a worker handlers through a read-only schema adapter; added 5s progress heartbeat around `runIntegrityCheck`.
- `src/features/budget-diagnostics/lib/sqliteWorkerClient.ts` — added per-request timeout override while keeping the default 60s timeout.
- `src/features/budget-diagnostics/components/BudgetDiagnosticsView.tsx` — calls `runIntegrityCheck` with `timeoutMs: null`.

**Notes for future milestones**
- `fetchRows` only accepts schema objects from `sqlite_schema`, requires non-negative offsets, enforces `1 <= limit <= 1000`, and validates sort columns against `PRAGMA table_info`.
- Indexes and triggers are included in schema listings/details but are not row-browsable; their row counts are `null`.
- Row-key inference prefers declared primary keys, then known Actual keys (`schedule_id`, `month`, `key`), then table `rowid` when available.
- `runIntegrityCheck` no longer times out client-side; worker heartbeat progress keeps the UI from appearing frozen during long runs.

**Files**
- `src/features/budget-diagnostics/workers/sqliteDiagnostics.worker.ts`
- `src/features/budget-diagnostics/types.ts`
- `src/features/budget-diagnostics/lib/schemaObjects.ts` (new)
- `src/features/budget-diagnostics/lib/sqlIdentifier.ts` (new)
- `src/features/budget-diagnostics/lib/schemaObjects.test.ts` (new)

**Scope**
1. Implement worker messages:
   - `listSchemaObjects`
   - `getSchemaObject`
   - `tableCounts`
   - `fetchRows`
2. Add worker/data types:
   ```ts
   type SchemaObjectType = "table" | "view" | "index" | "trigger";
   type SchemaObjectSummary = { name: string; type: SchemaObjectType; rowCount: number | null; featured: boolean; group: SchemaObjectGroup };
   type SchemaObjectDetails = { name: string; type: SchemaObjectType; sql: string | null; columns: ColumnInfo[]; indexes: IndexInfo[]; rowCount: number | null };
   type FetchRowsPayload = { object: string; columns: string[]; rows: Record<string, unknown>[]; offset: number; limit: number; rowCount: number };
   ```
3. List schema objects from `sqlite_schema` for:
   - tables
   - views
   - indexes
   - triggers
4. Compute row counts for tables/views only. Indexes/triggers return `rowCount: null`.
5. Read columns with `PRAGMA table_info`.
6. Read indexes with `PRAGMA index_list` for tables.
7. Return raw `CREATE ...` SQL from `sqlite_schema.sql`.
8. Implement safe SQL identifier handling:
   - Object names must come from `sqlite_schema`.
   - Sort columns must come from `PRAGMA table_info`.
   - Quote all identifiers.
   - Reject unknown object names, unknown columns, negative offsets, and invalid limits.
   - **Bounds:** `1 ≤ limit ≤ 1000` for `fetchRows`. Larger `limit` is allowed only via the M6f export cursor path.
   - **Direction whitelist:** `direction` must match exactly `"asc"` or `"desc"`. Reject any other value (including uppercase variants) with a typed worker error.
9. Add primary-key inference helper for row-details support:
   - Prefer `pk > 0` from `PRAGMA table_info`.
   - Common non-`id` keys: `schedule_id`, `month`, `key`.
   - Fall back to `rowid` only where SQLite supports it and the object is a table.
10. Keep worker APIs read-only. No arbitrary SQL console.
11. **Per-request timeout override in `sqliteWorkerClient.ts`:**
    - Default request timeout stays at 60s.
    - `runIntegrityCheck` runs with **no timeout** (`null`). On very large DBs this can take minutes and must not spuriously time out.
    - Worker emits a `progress` heartbeat every 5s while `integrity_check` is running, so the UI can render "running, please wait" instead of appearing frozen.
    - Add this to the worker protocol now (used by M5 integrity button and future long-running calls), even though M5 already shipped.

**Acceptance**
- `listSchemaObjects` returns tables, views, indexes, and triggers with stable grouping metadata.
- `getSchemaObject("v_transactions")` returns `CREATE VIEW ...` verbatim and its columns.
- `fetchRows` returns paginated rows for `v_transactions`.
- Invalid object/column names are rejected with typed worker errors.

---

### M6b — Data Browser shell + object list ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (31 suites, 374 tests). `npm run lint` reports the expected React Compiler `react-hooks/incompatible-library` warning for TanStack Table. `next build` bundle inspection was intentionally not run in the Docker-hosted dev workspace.

**Files delivered**
- `src/features/budget-diagnostics/components/DataBrowserSection.tsx` — replaced the placeholder with a three-pane Data Browser shell that loads schema objects after the snapshot opens.
- `src/features/budget-diagnostics/components/TableList.tsx` (new) — searchable, sortable, grouped schema object list with row counts and schema-only labels for indexes/triggers.
- `src/features/budget-diagnostics/lib/schemaObjectGroups.ts` (new) — group ordering/labels and default selection helper.
- `src/features/budget-diagnostics/components/BudgetDiagnosticsView.tsx` — passes snapshot open status into Data Browser so schema loading waits for a ready snapshot; also moved the workbench to a full-width/full-height tab shell matching the Query workspace pattern.

**Notes for future milestones**
- Default selection now prefers `v_transactions`, then the first featured view, then the first table/view with rows.
- Center panel intentionally shows selected object metadata and a placeholder for M6c/M6d rather than fetching rows.
- Right panel is reserved for M6e row drill-in and remains non-interactive.
- Data Browser handles snapshot-not-ready, loading, schema-load error, no-schema-objects, and no-search-results states.
- The page is ready for M6c: the top-level tabs are no longer centered in a `max-w-*` container, the active tab owns the available vertical space, and the Data Browser center pane has a `min-h-0 overflow-auto` region where `TableBrowser` can mount without changing the surrounding workbench.
- Use the existing Query results table visual language for M6c (`src/features/query/components/QueryResults.tsx`): dense `text-xs` table, sticky header, `bg-muted` header row, border-light hover rows, monospace truncated cells, and horizontal scrolling inside the center pane.

**Files**
- `src/features/budget-diagnostics/components/DataBrowserSection.tsx`
- `src/features/budget-diagnostics/components/TableList.tsx`
- `src/features/budget-diagnostics/lib/schemaObjectGroups.ts` (new)

**Scope**
1. Replace the Data Browser placeholder with a workbench shell.
2. Three-pane layout inside the Data Browser tab:
   - Left: object list.
   - Center: table/schema browser.
   - Right: optional row details sheet/panel, initially closed.
3. `TableList` capabilities:
   - Search by object name.
   - Sort by name or row count.
   - Group objects into:
     - **Featured views**: `v_transactions`, `v_payees`, `v_categories`, `v_schedules`.
     - **Core tables**: `accounts`, `category_groups`, `categories`, `payees`, `transactions`, `schedules`, `rules`, `tags`, `notes`.
     - **Mapping tables**: `category_mapping`, `payee_mapping`.
     - **Budget tables**: `reflect_budgets`, `zero_budgets`, `zero_budget_months`, `created_budgets`.
     - **System / metadata**: `__meta__`, `__migrations__`, `preferences`, `messages_clock`, `messages_crdt`, `kvcache`, `kvcache_key`.
     - **Reporting / dashboard**: `custom_reports`, `dashboard`, `dashboard_pages`, `transaction_filters`.
     - **Other**.
4. Default selection:
   - `v_transactions` when present.
   - Else first available featured view.
   - Else first table/view with a row count.
5. Keep Data Browser summary in sync with object list state.
6. Empty states:
   - No snapshot loaded.
   - No schema objects.
   - No objects match search.

**Acceptance**
- Data Browser tab loads a searchable grouped object list.
- `v_transactions` is selected by default when available.
- Row counts are visible for tables/views.
- Indexes/triggers are listed but clearly marked as schema objects, not browsable data tables.

---

### M6c — Paginated Table Browser ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (32 suites, 380 tests, 6 new). `npm run lint` reports the expected React Compiler `react-hooks/incompatible-library` warning for TanStack Table. `next build` bundle inspection was intentionally not run in the Docker-hosted dev workspace.

**Files delivered**
- `src/features/budget-diagnostics/components/TableBrowser.tsx` (new) — dense read-only table/view browser with worker-backed pagination, bounded page sizes, sticky headers, horizontal scroll, worker-side sorting, slow sorted-fetch hint, row JSON copy, and row details action.
- `src/features/budget-diagnostics/components/DataBrowserSection.tsx` — wires `TableBrowser` into the center pane, persists selected object in `obj`, resets paging/sorting on object switch, and uses the right pane for a lightweight raw row details preview while relationship drill-in remains reserved for M6e.
- `src/features/budget-diagnostics/lib/cellFormatters.ts` (new) — column-aware cell rendering for dates, obvious budget months, boolean-ish integers, nulls, JSON-ish values, raw money-like integers, and BLOB values with hex preview; row JSON copy serializes BLOBs as `{ "$base64": "..." }`.
- `src/features/budget-diagnostics/lib/cellFormatters.test.ts` (new) — covers date/month/boolean/raw amount/BLOB formatting and base64-safe row serialization.
- `FEATURES.md` — documents shipped Budget Diagnostics behavior, including the paginated Data Browser.
- `README.md` — updates Budget Diagnostics from planned to shipped read-only diagnostics/data browsing.

**Notes for future milestones**
- M6c intentionally implements a raw row details preview only. Relationship-aware stack navigation, linked cells, unresolved relationship states, and source-layer labeling remain in M6e.
- M6c measures elapsed time around the browser-side `fetchRows` worker request and surfaces the slow sorted-query hint when a sorted fetch exceeds 2s; the worker payload contract was not changed.
- Page size URL state uses the pinned `ps` parameter from M6-pre/M6c URL contract, not the earlier prose mention of `pageSize`.
- Indexes/triggers remain selectable in the object list but render a schema-only empty state instead of issuing `fetchRows`.

**Files**
- `src/features/budget-diagnostics/components/TableBrowser.tsx`
- `src/features/budget-diagnostics/lib/cellFormatters.ts` (new)
- `src/features/budget-diagnostics/lib/cellFormatters.test.ts` (new)

**Scope**
1. Render selected table/view rows in a dense read-only grid.
2. Use worker `fetchRows` for pagination:
   - Default page size: 100.
   - Allow page size through URL param `pageSize` with a bounded whitelist, for example `50 | 100 | 250 | 500`.
3. Sorting:
   - Click a column header to sort ascending/descending.
   - Delegate sorting to worker `ORDER BY`. Sort column whitelist is enforced **in the worker** against `PRAGMA table_info(object)`; client-side validation is advisory only.
   - Only allow sort columns from the selected object's column list.
   - **View-sort perf:** featured views (`v_transactions`, `v_schedules`, etc.) wrap multi-join queries. Arbitrary `ORDER BY` on large results can be slow. Log elapsed time on each `fetchRows` response; if > 2s, surface a small "slow query" hint next to the sorted column. Do not block sorting.
4. Column-aware rendering:
   - Money-like integer fields remain raw by default but use tabular alignment.
   - Transaction date integers (`YYYYMMDD`) display in readable form with raw value available in title. Zero/invalid dates (e.g. starting-balance rows) display as `—` with the raw integer in the title.
   - Budget months (`YYYYMM`) display as month labels where obvious.
   - Boolean-ish integer fields display compactly.
   - JSON/serialized text is truncated with full value available in row details.
   - **BLOB columns** (e.g. `messages_crdt.value` returned as `Uint8Array`) render as `<binary, N bytes>` with a tooltip showing hex of the first 16 bytes. Do not attempt to interpret as UTF-8.
5. Row actions:
   - Copy row JSON. (BLOBs serialize as `{ "$base64": "…" }` so JSON round-trips.)
   - Open row details.
6. URL state:
   - Persist selected object, page, page size, sort column, and sort direction. Use the query-param names reserved in M6-pre: `obj`, `p`, `ps`, `sort`, `dir`. Active tab (`tab`) is owned by M6-pre.
   - Invalid values (e.g. unknown object, `ps` outside `{50,100,250,500}`, `dir` ≠ `asc|desc`) fall back to defaults silently; do not render an error.
7. Performance:
   - Stable table dimensions.
   - Sticky header.
   - Horizontal scroll for wide objects.
   - No full-table fetch for ordinary browsing.

**Acceptance**
- User can browse `v_transactions` and move through pages without UI freezes.
- User can sort by a valid column.
- User can copy a row as JSON.
- Wide tables remain usable on desktop and do not break mobile layout.

---

### M6d — Schema Explorer tab inside Table Browser ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (32 suites, 381 tests, 1 new). `npm run lint` reports the expected React Compiler `react-hooks/incompatible-library` warning for TanStack Table. `next build` bundle inspection was intentionally not run in the Docker-hosted dev workspace.

**Files delivered**
- `src/features/budget-diagnostics/components/SchemaObjectDetails.tsx` (new) — renders object type, parent table, row count, inferred row key, columns from `PRAGMA table_info`, table indexes from `PRAGMA index_list`, and raw `CREATE ...` SQL.
- `src/features/budget-diagnostics/components/TableBrowser.tsx` — adds inner `Data` / `Schema` tabs; loads schema details for every selected schema object; fetches rows only for tables/views; keeps indexes/triggers on the Schema tab with a schema-only Data empty state.
- `src/features/budget-diagnostics/types.ts` — adds `tableName` to `SchemaObjectDetails`.
- `src/features/budget-diagnostics/lib/schemaObjects.ts` — returns `sqlite_schema.tbl_name` as `tableName` from `getSchemaObject`.
- `src/features/budget-diagnostics/lib/schemaObjects.test.ts` — covers parent table names for schema-only objects.
- `FEATURES.md` — documents the Schema tab behavior.

**Notes for future milestones**
- Relationship-aware row drill-in remains out of scope and belongs to M6e. M6d only displays schema metadata and keeps the M6c raw row details preview unchanged.
- `getSchemaObject` now returns `tableName` for all object types. M6e can use this for index/trigger context if needed, but relationship lookup should still rely on `relationshipMap.ts`.
- Indexes/triggers are selectable and useful in Schema, but the Data tab remains disabled/empty because they are not row-browsable.

**Files**
- `src/features/budget-diagnostics/components/SchemaObjectDetails.tsx`
- `src/features/budget-diagnostics/components/TableBrowser.tsx`

**Scope**
1. Add `Data` / `Schema` tabs inside the center browser panel.
2. Schema tab displays:
   - Object name.
   - Object type.
   - Row count where relevant.
   - Primary key / inferred row key.
   - Columns from `PRAGMA table_info`.
   - Indexes from `PRAGMA index_list`.
   - Raw `CREATE ...` SQL from `sqlite_schema.sql`.
3. For views:
   - Show `CREATE VIEW ...` SQL verbatim.
   - Show columns from `PRAGMA table_info`.
   - Indexes section should be absent or explicitly not applicable.
4. For indexes/triggers:
   - Show SQL and parent table when available.
   - Data tab should be disabled or replaced with an explanatory empty state.

**Acceptance**
- Schema tab renders `CREATE VIEW v_transactions AS ...` verbatim.
- Table columns and indexes are visible for raw tables.
- Index and trigger objects do not attempt row browsing.

---

### M6e — Relationship-aware drill-in + row details ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (32 suites, 384 tests, 3 new). `npm run lint` reports the expected React Compiler `react-hooks/incompatible-library` warning for TanStack Table. `next build` bundle inspection was intentionally not run in the Docker-hosted dev workspace.

**Files delivered**
- `src/features/budget-diagnostics/components/RowDetailsSheet.tsx` (new) — stackable right-side row details panel with back/close controls, stack cap of 10, source-layer labels (`source: raw storage` / `source: featured view`), unresolved target state, and outbound relationship links.
- `src/features/budget-diagnostics/components/DataBrowserSection.tsx` — replaces the M6c raw preview with `RowDetailsSheet`, clears the stack on object switch, enforces stack cap behavior, and resolves relationship links through the worker.
- `src/features/budget-diagnostics/components/TableBrowser.tsx` — turns mapped table cells into drill-in links and opens row actions into the stackable details panel.
- `src/features/budget-diagnostics/lib/relationshipMap.ts` — keeps `RELATIONSHIPS` as the single source of truth and adds lookup helpers for source object/column resolution.
- `src/features/budget-diagnostics/lib/relationshipMap.test.ts` — covers source relationship lookup and object relationship listing.
- `src/features/budget-diagnostics/lib/schemaObjects.ts` — adds read-only `lookupRow` by object + explicit key column, using M6a schema validation and row-key inference.
- `src/features/budget-diagnostics/lib/schemaObjects.test.ts` — covers row lookup by inferred and explicit keys, including missing target rows.
- `src/features/budget-diagnostics/workers/sqliteDiagnostics.worker.ts` — exposes the new `lookupRow` worker message.
- `src/features/budget-diagnostics/types.ts` — adds `LookupRowPayload` and worker protocol types.
- `FEATURES.md` — documents relationship-aware drill-in.

**Notes for future milestones**
- M6e still uses the M6c/M6d table browser as the entry point; M6f should not bypass this stack when adding export actions.
- Missing target rows are represented as unresolved row detail entries instead of thrown UI errors. This keeps drill-in behavior aligned with M5 relationship diagnostics.
- Relationship links are resolved exclusively through `relationshipMap.ts`. If M6f or M7 needs additional link behavior, update the shared map instead of adding another relationship catalog.

**Files**
- `src/features/budget-diagnostics/components/RowDetailsSheet.tsx`
- `src/features/budget-diagnostics/lib/relationshipMap.ts`
- `src/features/budget-diagnostics/lib/relationshipMap.test.ts`
- `src/features/budget-diagnostics/workers/sqliteDiagnostics.worker.ts`
- `src/features/budget-diagnostics/types.ts`

**Scope**
1. **Consume `relationshipMap.ts` (built in M5.1).** Do not fork the list. Data Browser drill-in and M5 diagnostics share the same `RELATIONSHIPS` export. If a relationship needs to change, update `relationshipMap.ts` and update this plan — do not introduce a parallel catalog.
2. The map already separates `kind: "view"` (drill-in targets only) from `kind: "raw"` (both orphan-checked and drill-in linkable). Data Browser drill-in resolves both kinds.
3. **Full relationship set for drill-in is defined in M5.1** (§ "Authoritative relationship catalog"). Do not repeat it here — re-read M5.1 before starting M6e. Notable entries for drill-in behavior:
   - View → entity (`v_transactions.category → categories.id`, `v_transactions.payee → payees.id`, etc.) — views already resolve the mapping layer.
   - Raw → mapping (`transactions.category → category_mapping.id`, `transactions.description → payee_mapping.id`) — drills open the mapping row first; user can chain to `categories` / `payees` from there.
   - Raw → entity (`categories.cat_group → category_groups.id`, `payees.transfer_acct → accounts.id`, `payees.category → categories.id`, etc.).
4. Add worker row lookup by object + key:
   - Key column comes from primary-key inference (M6a).
   - Relationship links use the explicit `to.column` from the map, not a hard-coded `id`.
5. `RowDetailsSheet`:
   - Right-side stackable panel.
   - Opens from linked cells and row actions.
   - **Stack cap: 10.** Pushing an eleventh entry discards the oldest and shows a transient toast ("older drill-in entries collapsed").
   - **Reset on object switch:** selecting a different object in the left-pane `TableList` closes the sheet entirely.
   - Back button pops one entry; close clears the entire stack.
   - Header displays **source layer** for the current entry: `"source: raw storage"` or `"source: featured view"`. This is why raw `transactions.category` and view `v_transactions.category` land on different targets — the header makes that explicit.
   - Body shows object name, key, all columns, and outbound relationship links.
6. Linked cells:
   - Render as links only when value is non-null and the relationship is present in `RELATIONSHIPS`.
   - If the target row is missing (tombstoned or deleted), render a muted "unresolved" state with the missing id still visible; do not throw. Missing-target for `kind: "raw"` relationships also surfaces in M5 diagnostics — the two views must agree.

**Acceptance**
- `v_transactions.payee` opens the referenced payee row directly.
- Raw `transactions.category` opens the `category_mapping` row; from there the user can drill into `categories`.
- Raw `transactions.description` opens the `payee_mapping` row; from there the user can drill into `payees`.
- `payees.category` opens the referenced category row.
- Tables without `id` still open row details using inferred keys where possible.
- Drilling past 10 entries collapses the oldest and toasts; switching objects closes the sheet.
- The sheet header clearly marks whether the current entry is from raw storage or a featured view.

---

### M6f — Full object CSV export ✅ shipped

**Status:** complete. Lint / `tsc --noEmit` / `npm test` all green (33 suites, 390 tests, 6 new). `npm run lint` reports the expected React Compiler `react-hooks/incompatible-library` warning for TanStack Table. `next build` bundle inspection was intentionally not run in the Docker-hosted dev workspace.

**Files delivered**
- `src/features/budget-diagnostics/lib/csvExport.ts` (new) — CSV encoding helpers with UTF-8 BOM support, TEXT-only formula neutralization, numeric negatives preserved, NULL-as-empty handling, capped base64 BLOB export, large-export size estimation, and safe dated filenames.
- `src/features/budget-diagnostics/lib/csvExport.test.ts` (new) — covers formula neutralization, negative numeric exports, NULL output, BLOB base64/truncation, size estimation, and filename generation.
- `src/features/budget-diagnostics/lib/schemaObjects.ts` — adds export cursor creation and 10k-row chunk reads using the same object/sort validation rules as paginated browsing.
- `src/features/budget-diagnostics/lib/schemaObjects.test.ts` — covers export cursor begin payloads and chunk reads.
- `src/features/budget-diagnostics/workers/sqliteDiagnostics.worker.ts` — exposes worker-owned `exportRowsBegin` / `exportRowsNext` / `exportRowsEnd`, keeps cursors in the worker, clears cursors on snapshot reload, and auto-expires idle cursors after 2 minutes.
- `src/features/budget-diagnostics/types.ts` — adds export worker request and response contracts.
- `src/features/budget-diagnostics/components/TableBrowser.tsx` — adds `Export CSV` for browsable tables/views, streams all rows through the worker cursor protocol, shows row progress, warns before estimated exports over 200 MB, preserves current sort order, and downloads `budget-diagnostics-{object}-{YYYY-MM-DD}.csv`.
- `FEATURES.md` / `README.md` — documents full table/view CSV export.

**Notes for future milestones**
- Export currently assembles CSV text chunks on the main thread after receiving 10k-row worker chunks. If real-world exports exceed the 200 MB warning path often, consider moving to a browser stream-backed download to reduce peak memory.
- Formula neutralization intentionally applies only to declared TEXT-like columns. INTEGER/REAL values remain raw so negative budget amounts export as numeric values.
- The export button is available only when the selected schema object is a row-browsable table/view; indexes and triggers remain schema-only.
- The visual tab fix requested before M6f is included in the same working set: top-level and Data Browser tabs now use flat bottom-border active styling without rounded active-tab corners.

**Files**
- `src/features/budget-diagnostics/lib/csvExport.ts`
- `src/features/budget-diagnostics/components/TableBrowser.tsx`
- `src/features/budget-diagnostics/workers/sqliteDiagnostics.worker.ts`
- `src/features/budget-diagnostics/types.ts`

**Scope**
1. Export the selected table/view as CSV.
2. Export the full object, not just the current page.
3. **Worker-owned cursor protocol** (pick this, not client-side paging through `fetchRows`):
   ```ts
   // new worker messages added to the protocol
   | { id: string; kind: "exportRowsBegin"; object: string; orderBy?: string; direction?: "asc" | "desc" }
   | { id: string; kind: "exportRowsNext";  cursorId: string }
   | { id: string; kind: "exportRowsEnd";   cursorId: string }
   ```
   - `exportRowsBegin` validates the object + sort column (same whitelist rules as `fetchRows`), returns `{ cursorId, rowCount, columns }`.
   - `exportRowsNext` returns the next 10 000 rows (last chunk may be smaller). Rows stream back via `progress` messages for UI updates and the final chunk via `result`.
   - `exportRowsEnd` releases the cursor; worker auto-releases after 2 minutes idle or on snapshot reload.
   - Main thread concatenates encoded CSV text as it arrives and assembles a final `Blob` on `exportRowsEnd`.
4. **CSV encoding rules** (use `src/lib/csv.ts` `csvField`, extended here):
   - **Formula-injection neutralization applies to TEXT columns only.** If the SQLite declared type (`PRAGMA table_info.type`) is INTEGER or REAL, the value passes through as-is — never prefix a `'` onto a negative number. For TEXT columns, prefix `'` when the stringified value begins with any of `=`, `+`, `-`, `@`, `\t`, or `\r`.
   - **BLOB columns** encode as `base64:<payload>`. Cap the encoded payload at 4 KB per cell; larger blobs export as `base64:<head>;truncated=true`. Full bytes remain available in `RowDetailsSheet` only.
   - `NULL` exports as an empty field (not the string `"null"`).
5. Add UTF-8 BOM (`\uFEFF`) so Excel opens UTF-8 cleanly.
6. **Memory budget:** estimate final CSV size as `rowCount × avgColumnTextLength × columnCount` (sampled from the first chunk). Warn before export when the estimate exceeds **200 MB** (roughly 1M typical transaction rows). User must confirm to proceed.
7. Show export progress (`rows exported / total`, chunk-by-chunk).
8. Keep UI responsive during export: all SQLite work stays in the worker; main thread only concatenates strings.
9. Filename format: `budget-diagnostics-{object}-{YYYY-MM-DD}.csv`.

**Acceptance**
- CSV export of a 50k-row table/view completes without freezing the UI (progress advances smoothly).
- CSV opens in Excel with UTF-8 text intact.
- Negative `amount` values export as `-12345`, **not** `'-12345` (numeric columns are not neutralized).
- A TEXT column value starting with `=cmd|'...'` exports neutralized so Excel treats it as text.
- BLOB columns export as `base64:…` with a `truncated=true` marker when they exceed 4 KB.
- Exporting an object larger than the warning threshold shows a confirm step before streaming starts.
- Exported CSV includes all rows for the selected object.

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
2. Persistent read-only banner above the tabs, two lines:
   - Line 1: "Read-only diagnostics — no changes are written back to the budget. Export contents are processed locally in the browser."
   - Line 2: "This tool may display personal data stored in your budget (payees, notes, imported descriptions). Close the tab when finished."
3. Budget-switch side-effect: on `useConnectionStore` change, clear worker DB and re-run auto-fetch.
4. Integration test (Jest + RTL): render `BudgetDiagnosticsView` with a mocked `apiDownload` returning a fixture ZIP; assert that the three tabs render with expected counts. Worker is mocked via a thin fake that exposes the same request/response interface — **do not** boot real sqlite-wasm in Jest suites.
5. Single node-env end-to-end suite that boots the real worker against a small fixture ZIP from `agents/fixtures/` (or a programmatically built one). Keep it small and separate from the jsdom suites.
6. Lint + typecheck + full test run.
7. **Bundle-isolation verification.** Run `next build` + bundle analysis. Confirm no non-diagnostics route imports `@sqlite.org/sqlite-wasm` or `fflate`. Record the diagnostics-route bundle size in the PR description so regressions are visible.

**Acceptance**
- `npm run lint` — 0 errors.
- `npx tsc --noEmit` — 0 errors.
- `npm test` — all suites pass.
- `next build` — succeeds; bundle analysis shows `@sqlite.org/sqlite-wasm` and `fflate` only in the diagnostics chunk.
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

> **Canonical source:** `src/features/budget-diagnostics/lib/relationshipMap.ts`, created in **M5.1**.
> The full catalog (codes, titles, severities, `skipWhere`) lives in the M5.1 milestone section above — do not duplicate it here.
> The sketch below is the module's public shape only; the actual `RELATIONSHIPS` array is defined by M5.1 and must match the M5.1 catalog entry-for-entry.

```ts
export type RelationshipKind = "view" | "raw";
export type RelationshipSeverity = "warning" | "info";

export type Relationship = {
  code: string;                   // stable diagnostic code, also used by M6e drill-in
  kind: RelationshipKind;         // "raw" → orphan-checked by M5; "view" → drill-in target only
  from: { object: string; column: string };
  to:   { table: string;  column: string };
  title: string;                  // finding title (raw kind only)
  severity: RelationshipSeverity; // default severity (raw kind only)
  skipWhere?: string;             // optional SQL predicate on the left side
};

export const RELATIONSHIPS: readonly Relationship[] = [ /* see M5.1 catalog */ ];
```

Consumers:
- `diagnosticChecks.ts` reads `RELATIONSHIPS.filter(r => r.kind === "raw")` for orphan checks.
- `RowDetailsSheet` (M6e) reads the whole array for drill-in link targets, keyed by `from.object` + `from.column`.
- `relationshipMap.test.ts` (M5.1) enforces that every `from`/`to` pair resolves against `EXPECTED_TABLES` / `EXPECTED_VIEWS` / `EXPECTED_COLUMNS`.

---

## Risks and guardrails

| Risk | Mitigation |
|---|---|
| `sqlite-wasm` bundle pollutes other pages | Dynamic import of the view + verify bundle size after `next build` |
| Worker crash silently hangs the UI | Request correlator has a 60s timeout; surface as error + offer Retry |
| Large CSV export freezes the UI | Stream from the worker in 10k-row chunks; write into a `ReadableStream` backing a `Blob`; show progress |
| Binary proxy breaks the JSON queue | Extract `serverQueueTails` into a shared module so both routes share it (tested) |
| Users click "Run full integrity check" on a huge DB | Button shows estimated cost ("may take minutes on large budgets"); always runnable, never blocking other queries |
| `PRAGMA integrity_check` hits the default worker timeout | Per-request timeout override in `sqliteWorkerClient.ts` (M6a scope item 11). `runIntegrityCheck` runs with no timeout; heartbeat `progress` messages every 5s surface "still running" to the UI |
| CSV export of a large object freezes the UI or blows up memory | Worker-owned cursor protocol, 10k-row chunks, main-thread string concat; warn + confirm when estimated output exceeds 200 MB (M6f scope items 3 + 6) |
| Relationship logic drifts between M5 and M6e | `relationshipMap.ts` introduced in M5.1 is the only source; both consumers import from it; `relationshipMap.test.ts` pins object/column names against the expected schema |
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
- Commit style matches `AGENTS.md`: `feat:`, `fix:`, etc. Branch `feat/002-budget-diaganostics-page`. Author `Manaf`, GitHub user `x-rous`. No auto-commit / auto-push.
