<p align="center">
  <img src="public/logo.png" alt="Actual Bench" height="48" />
</p>

<p align="center">
  <a href="https://github.com/x-rous/actual-bench/actions/workflows/ci.yml"><img src="https://github.com/x-rous/actual-bench/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/x-rous/actual-bench/releases"><img src="https://img.shields.io/github/v/tag/x-rous/actual-bench?label=version" alt="Version" /></a>
  <a href="https://github.com/x-rous/actual-bench/blob/main/LICENSE"><img src="https://img.shields.io/github/license/x-rous/actual-bench" alt="License" /></a>
</p>

A power-user workbench for [Actual Budget](https://github.com/actualbudget/actual). It connects to a self-hosted [actual-http-api](https://github.com/jhonderson/actual-http-api) server and gives you a dedicated UI for bulk operations, advanced rules management, budget overview, and diagnostics, things that are difficult to do from the native Actual Budget interface.

Useful for power users who want more control over their budget data, and for testers setting up or validating a fresh Actual Budget instance.

## Why actual-bench?

- **Bulk CSV import/export** for every entity - seed a fresh budget with hundreds of rules, payees, categories, or schedules in one go
- **Budget Overview homepage** - land on a compact overview with live budget metrics, budget mode, budgeting-since, and quick links into the main admin pages
- **Budget Management Workspace** — edit a 12-month budgeting window in a spreadsheet-like grid with staged changes, right-click bulk actions, a draft panel, and mode-aware envelope/tracking behavior
- **Advanced rules management** - visual condition/action builder, merge, duplicate, stage filtering, and template mode in one focused view
- **Staged editing with undo/redo** - review every change locally before anything touches the server
- **Multi-server, multi-budget** - save and switch between connections without leaking data between sessions
- **Schedules management** - create and edit one-time and recurring schedules with full recurrence controls, amount modes, and weekend adjustment
- **ActualQL query workspace** - run ad-hoc ActualQL queries against your budget, inspect results as table / raw JSON / scalar / collapsible tree, save and replay named query packs, and copy a cURL command for any executed query
- **Budget Diagnostics** - inspect exported budget snapshots in a read-only local workspace with overview metrics, diagnostics, paginated SQLite data browsing, and full table/view CSV export

## Architecture

```
Browser
  └─► actual-bench  (this app)
        └─► actual-http-api  (REST API server - jhonderson/actual-http-api)
              └─► Actual Budget  (SQLite budget file)
```

All browser requests route through an internal Next.js proxy - no direct browser-to-API calls to `actual-http-api`. Connection credentials are sent only to actual-bench and proxied server-side to the API; session storage is cleared when the tab is closed. For Docker deployments, `actual-bench` must be able to reach `actual-http-api` from inside the container. If you see `fetch failed` or `502 Bad Gateway` during connect, first verify that both containers are attached to the same Docker network.

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
- **Budget Overview** - connected budgets land on `/overview` with live snapshot metrics, budget mode, budgeting-since, refresh status, and direct links into core admin pages
- **Staged editing** - all changes are held locally until you click Save; nothing touches the server until you confirm
- **Undo / Redo** - step backwards and forwards through your edits before committing
- **Accounts** - create, edit, close, reopen, and delete accounts with live balance visibility; CSV import/export
- **Payees** - view, edit, bulk-manage, and merge multiple payees; CSV import/export
- **Categories** - manage groups and categories, visibility, and hierarchy; CSV import/export
- **Rules** - view, filter by stage, create, edit, and merge rules with a full condition/action builder; CSV import/export
- **Schedules** - create and manage one-time and recurring schedules with amount modes, weekend adjustment, and end conditions; overdue dates are highlighted; CSV import/
export
- **Tags** - create, rename, and color-code tags (requires Actual Budget v26.3.0+); CSV import/export
- **ActualQL Queries** - syntax-highlighted query editor with run / format / save / explain actions; four result views (table, raw JSON, scalar, collapsible tree); built-in example packs; saved queries with favorites; query history; cURL copy; lint warnings; and an inline quick reference dialog
- **Budget Management Workspace** - adds a multi-month budgeting workspace with a 12-month grid, staged cell editing, Budget / Actuals / Balance view toggle, year summary draft panel, keyboard navigation, clipboard paste, right-click bulk actions, supports both tracking and envelope-mode with support for next-month hold and category transfer

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

Click **Load Budgets** to fetch the list of budgets available on that server.

**Step 2 - Select a budget and connect**

| Field | Description |
|---|---|
| **Budget** | Pick from the list of budgets returned by the server |
| **Encryption Password** | Only required if the budget is end-to-end encrypted |

Click **Connect** to finish. Successful connect and reconnect flows land on **Overview**. The connection is saved in **session storage** - credentials are cleared automatically when the tab is closed. Multiple connections can be saved and switched between; previously saved connections appear at the top of the Connect screen for one-click reconnect.


### Docker networking troubleshooting

If **Load Budgets** fails with `fetch failed`, or you see a `502 Bad Gateway` error on `/api/proxy`, the most common cause is that `actual-bench` and `actual-http-api` are running on different Docker networks.

Even if the `actual-http-api` URL works in your browser, `actual-bench` still needs to be able to reach that server **from inside its own container**.

#### 1) Find the container names

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
```

Look for your `actual-bench` container and your `actual-http-api` container.

#### 2) Check which Docker networks each container is using

```bash
docker inspect -f '{{.Name}} -> {{range $k, $v := .NetworkSettings.Networks}}{{printf "%s " $k}}{{end}}' <actual-bench-container>
docker inspect -f '{{.Name}} -> {{range $k, $v := .NetworkSettings.Networks}}{{printf "%s " $k}}{{end}}' <actual-http-api-container>
```

If the network names do not overlap, the containers cannot talk to each other by Docker network routing.

#### 3) Temporarily connect `actual-bench` to the same network as `actual-http-api`

```bash
docker network connect <actual-http-api-network> <actual-bench-container>
```

After that, try connecting again from the Actual Bench UI.

#### 4) Make the fix permanent in Docker Compose

Update the `actual-bench` service so it joins the same network as `actual-http-api`.

Example:

```yaml
services:
  actual-bench:
    image: xrous/actual-bench:latest
    ports:
      - "3000:3000"
    networks:
      - actual-stack # replace with same network where actual http api runs
    restart: unless-stopped

networks:
  actual-stack: # replace with same network where actual-http-api runs
    external: true
```

Replace `actual-stack` with the real network name you found from `docker inspect`.


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
| [`sample-budget.csv`](public/samples%20csv/sample-budget.csv) | budget import template with groups, categories, and budgeted amounts per month |

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

- **Rule diagnostics** - detect conflicting, shadowed, or redundant rules across stages

## Known Limitations

- **No pagination on main entity admin pages** - Accounts, Payees, Categories, Rules, and related admin pages load their full entity sets. Paginated browsing is available in Budget Diagnostics / Data Browser.

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
