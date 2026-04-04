<p align="center">
  <img src="public/logo.png" alt="Actual Bench" height="48" />
</p>

<p align="center">
  <a href="https://github.com/x-rous/actual-bench/actions/workflows/ci.yml"><img src="https://github.com/x-rous/actual-bench/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/x-rous/actual-bench/releases"><img src="https://img.shields.io/github/v/tag/x-rous/actual-bench?label=version" alt="Version" /></a>
  <a href="https://github.com/x-rous/actual-bench/blob/main/LICENSE"><img src="https://img.shields.io/github/license/x-rous/actual-bench" alt="License" /></a>
</p>

A web-based admin tool for [Actual Budget](https://actualbudget.org/) that connects to a self-hosted [actual-http-api](https://github.com/jhonderson/actual-http-api) server. Manage accounts, payees, categories, and rules through a clean UI with staged editing, undo/redo, and CSV import/export.

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

- **Multi-connection support** — save and switch between multiple Actual Budget servers or budget files; staged data and query cache are scoped per connection
- **Staged editing** — all changes are held locally until you click Save; nothing touches the server until you confirm
- **Undo / Redo** — step backwards and forwards through your edits before committing
- **Accounts** — view and rename accounts, toggle on/off budget status; CSV import/export
- **Payees** — view, rename, and delete payees; CSV import/export
- **Categories** — view, rename, show/hide, and reorder categories within groups; CSV import/export
- **Rules** — view, filter by stage, create, edit, and merge rules with a full condition/action builder; CSV import/export

→ See [FEATURES.md](FEATURES.md) for the full feature reference.

## Requirements

- A self-hosted [Actual Budget](https://actualbudget.org/) server
- A running [actual-http-api](https://github.com/jhonderson/actual-http-api) instance pointed at that server

## Quick Start

Pull the pre-built image from Docker Hub — no local build required:

```bash
# Latest stable release
docker run -p 3000:3000 xrous/actual-bench:latest

# Latest unreleased changes (updated on every merge to main — may be unstable)
docker run -p 3000:3000 xrous/actual-bench:edge
```

Or with Docker Compose — save the following as `docker-compose.yml` and run `docker compose up -d`:

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

**Step 1 — Validate credentials**

| Field | Description |
|---|---|
| **Server URL** | Base URL of your actual-http-api server (e.g. `https://actual-api.example.com`) |
| **API Key** | The `ACTUAL_API_KEY` you set on the server |

Click **Validate** to fetch the list of budgets available on that server.

**Step 2 — Select a budget and connect**

| Field | Description |
|---|---|
| **Budget** | Pick from the list of budgets returned by the server |
| **Encryption Password** | Only required if the budget is end-to-end encrypted |

Click **Connect** to finish. The connection is saved in **session storage** — credentials are cleared automatically when the tab is closed. Multiple connections can be saved and switched between; previously saved connections appear at the top of the Connect screen for one-click reconnect.

## Staged Editing Workflow

1. Click any cell to edit inline; press Enter or click away to confirm
2. New rows, updates, and deletions are colour-coded in the table
3. Click **Save** in the top bar to persist all changes to the server
4. Click **Discard** to revert all pending changes
5. Use **Undo / Redo** to step through your local edit history before saving
6. Click **Refresh** to reload data from the server — if you have unsaved changes, a prompt lets you choose to discard them or cancel

## CSV Import / Export

Every entity page has an **Export** button that downloads a UTF-8 CSV file and an **Import** button that accepts the same format. Imported rows are staged as new entities and are not saved until you click Save.

### Sample Import Files

Ready-to-use sample CSV files are included in [`public/samples csv/`](public/samples%20csv/) for testing with a fresh Actual Budget setup:

| File | Description |
|---|---|
| [`sample-accounts.csv`](public/samples%20csv/sample-accounts.csv) | 7 accounts — covers `offBudget` and `closed` flag combinations |
| [`sample-payees.csv`](public/samples%20csv/sample-payees.csv) | 15 common payees |
| [`sample-categories.csv`](public/samples%20csv/sample-categories.csv) | 8 groups and 25 categories spanning income, housing, food, transport, health, and more |
| [`sample-rules.csv`](public/samples%20csv/sample-rules.csv) | 10 rules demonstrating multi-condition, multi-action, `or` logic, stage filtering, and payee auto-creation |

### CSV Formats

**Accounts** — columns: `name` (required), `offBudget`, `closed`

**Payees** — columns: `name` (required)

**Categories** — columns: `type` (required: `group` or `category`), `name` (required), `group`, `is_income`, `hidden`
> Group rows must appear before the category rows that reference them.

**Rules** — long format, one condition/action per row:

| Column | Description |
|---|---|
| `rule_id` | Grouping key — all rows sharing the same ID form one rule |
| `stage` | `pre`, `default`, or `post` |
| `conditions_op` | `and` or `or` |
| `row_type` | `condition` or `action` |
| `field` | Field name (e.g. `imported_payee`, `payee`, `category`, `amount`) |
| `op` | Operator (e.g. `is`, `contains`, `lt`, `oneOf`) |
| `value` | Value — use `\|` as separator for multi-value `oneOf` operators |

## Known Limitations

- **No pagination** — all entities are loaded at once. Performance may degrade on very large budgets.

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
