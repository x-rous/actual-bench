# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Refresh button** — no longer disabled when unsaved changes exist; clicking it now shows a sonner warning toast with a "Discard & Refresh" action so the user can proceed or cancel
- **Staged state colors** — extracted `--color-staged-new` (green), `--color-staged-updated` (amber), and `--color-staged-deleted` (muted) as semantic `@theme` tokens in `globals.css`; all five table/column files now reference the tokens instead of hardcoded Tailwind color names
- **Query client defaults** — `staleTime` and `gcTime` set to `Infinity`, `refetchOnWindowFocus`/`refetchOnReconnect` disabled globally in `queryClient.ts`; per-hook overrides removed from all four entity hooks (architecture comment moved to `queryClient.ts`)
- **CI pipeline** — unit tests now run before the build step so a test failure is caught earlier without paying the build cost
- **Start script** — blank-line suppression in `start.mjs` is now scoped to the startup phase only; post-banner blank lines are forwarded unchanged

### Fixed
- **RulesView redundant subscriptions** — removed duplicate `useAccounts`, `usePayees`, and `useCategoryGroups` calls; AppShell prefetches all entities via `usePreloadEntities`
- **CSV export URL leak** — `URL.revokeObjectURL` is now called in a `setTimeout` (100 ms) inside a `finally` block in all four view files, preventing the object URL from being revoked before the browser initiates the download

## [1.0.2] - 2026-04-01

### Added
- **Docker startup banner** — container logs now show a branded banner (`🚀 Actual Bench vX.Y.Z`, environment, port, ready time) instead of the raw Next.js output
- **Server version display** — connection dropdown shows `actual-http-api` and Actual Budget server versions; fetched once per session, silently omitted on older API versions that don't expose the endpoints
- **Help & feedback menu** — sidebar dropdown with links to GitHub repository, issue tracker, and changelog
- **Logo** — Actual Bench logo shown at the top of the connect form
- **FEATURES.md** — user-facing feature reference document at repo root
- **Sample CSV files** — `public/samples csv/` contains sample accounts, payees, categories, and rules for testing

### Changed
- **Connect form** — redesigned to a two-step flow: validate server credentials first, then select from the list of budgets returned by the server; Budget Sync ID field removed from manual input
- **README.md** — updated Quick Start section with inline `docker-compose.yml` content; updated connect flow documentation
- **Proxy request logging** — redesigned to emit one concise line per request (`METHOD STATUS /path (Xms) [reqId]`) matching Actual Budget's log style; removed redundant `app` and `version` fields from every line

### Fixed
- **Connection validation on older `actual-http-api` builds** — validation no longer fails with HTTP 404 when the server version endpoints (`/v1/actualhttpapiversion`, `/actualserverversion`) are not available; version display is silently skipped in that case (closes #28)
- **`crypto.randomUUID` on HTTP** — replaced all 16 call sites with `generateId()` from `src/lib/uuid.ts`, which falls back to a `Math.random`-based UUID v4 on non-HTTPS contexts (issue #13)

## [1.0.0] - 2026-03-25

### Added
- **Rules** — full condition/action builder with support for all actual-http-api operations (`contains`, `matches`, `oneOf`, `is`, `isNot`, `gt`, `lt`, `gte`, `lte`, `isapprox`, `isbetween`, `onBudget`, `offBudget`)
- **Accounts** — inline rename, toggle on/off budget status, CSV import/export
- **Payees** — inline rename, delete, CSV import/export
- **Categories** — inline rename, show/hide, reorder within groups, CSV import/export
- **Staged editing** — all changes held locally until Save; supports undo/redo
- **Multi-connection support** — save and switch between multiple Actual Budget servers; staged data and query cache are scoped per connection
- **Draft panel** — live summary of pending creates, updates, and deletions with per-entity error display
- **CSV import/export** — UTF-8 with BOM for Excel compatibility across all entity pages
- **Connection naming** — optional friendly name for each saved connection
- **Docker support** — dev compose (Turbopack, named volume cache) and production multi-stage Dockerfile
