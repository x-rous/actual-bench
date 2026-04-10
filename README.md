<p align="center">
  <img src="public/logo.png" alt="Actual Bench" height="48" />
</p>

<p align="center">
  <a href="https://github.com/x-rous/actual-bench/actions/workflows/ci.yml"><img src="https://github.com/x-rous/actual-bench/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/x-rous/actual-bench/releases"><img src="https://img.shields.io/github/v/tag/x-rous/actual-bench?label=version" alt="Version" /></a>
  <a href="https://github.com/x-rous/actual-bench/blob/main/LICENSE"><img src="https://img.shields.io/github/license/x-rous/actual-bench" alt="License" /></a>
</p>

A power-user workbench for [Actual Budget](https://github.com/actualbudget/actual). It connects to a self-hosted [actual-http-api](https://github.com/jhonderson/actual-http-api) server and gives you a dedicated UI for bulk operations, advanced rules management, and diagnostics, things that are difficult or impossible to do from the native Actual Budget interface.

Useful for power users who want more control over their budget data, and for testers setting up or validating a fresh Actual Budget instance.

## Why actual-bench?

- **Bulk CSV import/export** for every entity - seed a fresh budget with hundreds of rules, payees, categories, or schedules in one go
- **Advanced rules management** - visual condition/action builder, merge, duplicate, stage filtering, and template mode in one focused view
- **Staged editing with undo/redo** - review every change locally before anything touches the server
- **Multi-server, multi-budget** - save and switch between connections without leaking data between sessions
- **Schedules management** - create and edit one-time and recurring schedules with full recurrence controls, amount modes, and weekend adjustment
- **ActualQL console** *(coming soon)* - run ad-hoc queries against your budget directly from the browser
- **SQLite budget diagnostic** *(coming soon)* - inspect a `.sqlite` budget file client-side: table overview, row counts, and a read-only table browser

## Architecture

```
Browser
  └─► actual-bench  (this app)
        └─► actual-http-api  (REST API server - jhonderson/actual-http-api)
              └─► Actual Budget  (SQLite budget file)
```

All browser requests route through an internal Next.js proxy - no direct browser-to-API calls. Credentials never leave the server proxy; session storage is cleared when the tab is closed. For Docker deployments, ensure actual-bench and http-api reside on the same Docker network to allow internal network connectivity.

## Screenshots

| Connection  |
|:---:
| ![Connection Form](public/screenshots/Connection%20Form.png) |

| Payees | Categories |
|:---:|:---:|
| ![Payees](public/screenshots/Payees%20Page.png) | ![Categories](public/screenshots/Categories%20Page.png) |

| Accounts Detail | Rules |
|:---:|:---:|
| ![Accounts Detail](public/screenshots/Accounts%20Detailed.png) | ![Rules](public/screenshots/Rules%20Page.png)  |

## Features

- **Multi-connection support** - save and switch between multiple Actual Budget servers or budget files; staged data and query cache are scoped per connection
- **Staged editing** - all changes are held locally until you click Save; nothing touches the server until you confirm
- **Undo / Redo** - step backwards and forwards through your edits before committing
- **Accounts** - view and rename accounts, toggle on/off budget status; CSV import/export
- **Payees** - view, rename, and delete payees; CSV import/export
- **Categories** - view, rename, show/hide, and reorder categories within groups; CSV import/export
- **Rules** - view, filter by stage, create, edit, and merge rules with a full condition/action builder; CSV import/export
- **Schedules** - create and manage one-time and recurring schedules with amount modes, weekend adjustment, and end conditions; overdue dates are highlighted; CSV import/export
- **Tags** - create, rename, and color-code tags (requires Actual Budget v26.3.0+); CSV import/export

→ See [FEATURES.md](FEATURES.md) for the full feature reference.

## Requirements

- A self-hosted [Actual Budget](https://github.com/actualbudget/actual) server
- A running [actual-http-api](https://github.com/jhonderson/actual-http-api) instance pointed at that server

## Quick Start

Pull the pre-built image from Docker Hub - no local build required:

```bash
# Latest stable release
docker run -p 3000:3000 xrous/actual-bench:latest

# Latest unreleased changes (updated on every merge to main - may be unstable)
docker run -p 3000:3000 xrous/actual-bench:edge
```

Or with Docker Compose - save the following as `docker-compose.yml` and run `docker compose up -d`:

```yaml
services:
  actual-bench:
    image: xrous/actual-bench:latest
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      NEXT_TELEMETRY_DISABLED: "1"
    restart: unless-stopped
```

Open [http://localhost:3000](http://localhost:3000) and enter your connection details on the Connect screen.

## Connecting to Actual Budget

The Connect screen uses a two-step flow:

**Step 1 - Validate credentials**

| Field | Description |
|---|---|
| **Server URL** | Base URL of your actual-http-api server (e.g. `https://actual-api.example.com`) |
| **API Key** | The `ACTUAL_API_KEY` you set on the server |

Click **Validate** to fetch the list of budgets available on that server.

**Step 2 - Select a budget and connect**

| Field | Description |
|---|---|
| **Budget** | Pick from the list of budgets returned by the server |
| **Encryption Password** | Only required if the budget is end-to-end encrypted |

Click **Connect** to finish. The connection is saved in **session storage** - credentials are cleared automatically when the tab is closed. Multiple connections can be saved and switched between; previously saved connections appear at the top of the Connect screen for one-click reconnect.

## Staged Editing Workflow

1. Click any cell to edit inline; press Enter or click away to confirm
2. New rows, updates, and deletions are colour-coded in the table
3. Click **Save** in the top bar to persist all changes to the server
4. Click **Discard** to revert all pending changes
5. Use **Undo / Redo** to step through your local edit history before saving
6. Click **Refresh** to reload data from the server - if you have unsaved changes, a prompt lets you choose to discard them or cancel

## CSV Import / Export

Every entity page has an **Export** button that downloads a UTF-8 CSV file and an **Import** button that accepts the same format. Imported rows are staged as new entities and are not saved until you click Save.

### Sample Import Files

Ready-to-use sample CSV files are included in [`public/samples csv/`](public/samples%20csv/) for testing with a fresh Actual Budget setup:

| File | Description |
|---|---|
| [`sample-accounts.csv`](public/samples%20csv/sample-accounts.csv) | 7 accounts - covers `offBudget` and `closed` flag combinations |
| [`sample-payees.csv`](public/samples%20csv/sample-payees.csv) | 15 common payees |
| [`sample-categories.csv`](public/samples%20csv/sample-categories.csv) | 8 groups and 25 categories spanning income, housing, food, transport, health, and more |
| [`sample-rules.csv`](public/samples%20csv/sample-rules.csv) | 10 rules demonstrating multi-condition, multi-action, `or` logic, stage filtering, and payee auto-creation |
| [`sample-schedules.csv`](public/samples%20csv/sample-schedules.csv) | 6 schedules - one-time, monthly, weekly, yearly, and range-amount examples |
| [`sample-tags.csv`](public/samples%20csv/sample-tags.csv) | 8 tags with varied colors and descriptions |

### CSV Formats

**Accounts** - columns: `name` (required), `offBudget`, `closed`

**Payees** - columns: `name` (required)

**Categories** - columns: `type` (required: `group` or `category`), `name` (required), `group`, `is_income`, `hidden`
> Group rows must appear before the category rows that reference them.

**Schedules** - columns: `name` (optional), `date` (required - ISO date `YYYY-MM-DD` for one-time, or JSON-encoded RecurConfig for recurring), `amount` (optional, in cents - use `num1|num2` for `isbetween`), `amountOp` (optional: `is`, `isapprox`, `isbetween`), `payee` (optional name), `account` (optional name), `posts_transaction` (optional bool)
> The `completed` column is ignored on import - all imported schedules start as active.

**Rules** - long format, one condition/action per row:

| Column | Description |
|---|---|
| `rule_id` | Grouping key - all rows sharing the same ID form one rule |
| `stage` | `pre`, `default`, or `post` |
| `conditions_op` | `and` or `or` |
| `row_type` | `condition` or `action` |
| `field` | Field name (e.g. `imported_payee`, `payee`, `category`, `amount`) |
| `op` | Operator (e.g. `is`, `contains`, `lt`, `oneOf`) |
| `value` | Value - use `\|` as separator for multi-value `oneOf` operators |

## Coming Soon

- **ActualQL console** - run ad-hoc queries against your budget from the browser; save and replay query packs
- **Rule diagnostics** - detect conflicting, shadowed, or redundant rules across stages
- **SQLite budget diagnostic** - drop a `.sqlite` file to inspect tables, row counts, and schema version without uploading anything to a server
- **Entity usage & delete safety** - see which rules reference a payee or category before deleting it

## Known Limitations

- **No pagination** - all entities are loaded at once. Performance may degrade on very large budgets.

## Development

### Prerequisites

- Node.js 20+
- A running [actual-http-api](https://github.com/jhonderson/actual-http-api) instance

### Setup

```bash
git clone https://github.com/x-rous/actual-bench.git
cd actual-bench
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Turbopack dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm test` | Jest tests |
| `npm run clean` | Delete `.next/`, `.next-build/`, and `tsconfig.tsbuildinfo` |

See [CONTRIBUTING.md](CONTRIBUTING.md) for release and contribution guidelines.
