# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Changed
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
