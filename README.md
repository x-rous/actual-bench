<p align="center">
  <img src="public/logo.png" alt="Actual Bench" height="48" />
</p>

<p align="center">
  <a href="https://github.com/x-rous/actual-admin-panel/actions/workflows/ci.yml"><img src="https://github.com/x-rous/actual-admin-panel/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/x-rous/actual-admin-panel/releases"><img src="https://img.shields.io/github/v/tag/x-rous/actual-admin-panel?label=version" alt="Version" /></a>
  <a href="https://github.com/x-rous/actual-admin-panel/blob/main/LICENSE"><img src="https://img.shields.io/github/license/x-rous/actual-admin-panel" alt="License" /></a>
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

- **Multi-connection support** — save and switch between multiple Actual Budget servers; staged data and query cache are scoped per connection
- **Staged editing** — all changes are held locally until you click Save; nothing touches the server until you confirm
- **Undo / Redo** — step backwards and forwards through your edits before committing
- **Accounts** — view and rename accounts, toggle on/off budget status; CSV import/export
- **Payees** — view, rename, and delete payees; CSV import/export
- **Categories** — view, rename, show/hide, and reorder categories within groups; CSV import/export
- **Rules** — view, filter by stage, create and edit rules with a full condition/action builder; CSV import/export
  - Conditions: `contains`, `matches`, `oneOf`, `is`, `isNot`, `gt`, `lt`, `gte`, `lte`, `isapprox`, `isbetween`, `onBudget`, `offBudget`
  - Multi-value `oneOf` inputs: entity picker (accounts, payees, categories) and tag input (strings)
  - Actions: `set` (payee, category, notes, cleared)
  - Stage filter: `default`, `pre`, `post`

## Requirements

- A self-hosted [Actual Budget](https://actualbudget.org/) server
- A running [actual-http-api](https://github.com/jhonderson/actual-http-api) instance pointed at that server

## Quick Start

Pull the pre-built image from GHCR — no local build required:

```bash
docker run -p 3000:3000 ghcr.io/x-rous/actual-admin-panel:latest
```

Or with Docker Compose (a ready-to-use `docker-compose.yml` is included in the repo):

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) and enter your connection details on the Connect screen.

## Connecting to Actual Budget

On the Connect screen enter:

| Field | Description |
|---|---|
| **Server URL** | Base URL of your actual-http-api server (e.g. `https://actual-api.example.com`) |
| **API Key** | The `ACTUAL_API_KEY` you set on the server |
| **Budget Sync ID** | The sync ID of the budget file (visible in Actual Budget under Settings → Sync) |
| **Encryption Password** | Only required if the budget is end-to-end encrypted |

After connecting, the connection is saved in **session storage** — credentials are cleared automatically when the tab is closed. Use the connection menu in the top bar to add more connections or switch between them.

## Staged Editing Workflow

1. Click any cell to edit inline; press Enter or click away to confirm
2. New rows, updates, and deletions are colour-coded in the table
3. Click **Save** in the top bar to persist all changes to the server
4. Click **Discard** to revert all pending changes
5. Use **Undo / Redo** to step through your local edit history before saving

## CSV Import / Export

Every entity page has an **Export** button that downloads a UTF-8 CSV file and an **Import** button that accepts the same format. Imported rows are staged as new entities and are not saved until you click Save.

### Sample Import Files

Ready-to-use sample CSV files are included in [`public/samples/`](public/samples/) for testing with a fresh Actual Budget setup:

| File | Description |
|---|---|
| [`sample-accounts.csv`](public/samples/sample-accounts.csv) | 7 accounts — covers `offBudget` and `closed` flag combinations |
| [`sample-payees.csv`](public/samples/sample-payees.csv) | 15 common payees |
| [`sample-categories.csv`](public/samples/sample-categories.csv) | 8 groups and 25 categories spanning income, housing, food, transport, health, and more |
| [`sample-rules.csv`](public/samples/sample-rules.csv) | 10 rules demonstrating multi-condition, multi-action, `or` logic, stage filtering, and payee auto-creation |

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

- **Session storage is tab-local** — credentials clear when the tab is closed; reconnection is required in each new tab.
- **No pagination** — all entities are loaded at once. Performance may degrade on very large budgets.
- **Schedules** — not yet implemented.

## Development

### Prerequisites

- Node.js 20+
- A running [actual-http-api](https://github.com/jhonderson/actual-http-api) instance

### Setup

```bash
git clone https://github.com/x-rous/actual-admin-panel.git
cd actual-admin-panel
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

No `.env` file is required. The app version is injected automatically from `package.json` at build time.

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Turbopack dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm test` | Jest tests |
| `npm run clean` | Delete `.next-build/` and `tsconfig.tsbuildinfo` |
| `npm version patch\|minor\|major` | Bump version, commit, and tag |

See [CONTRIBUTING.md](CONTRIBUTING.md) for release and contribution guidelines.

## Docker

### Pre-built Image (Recommended)

The latest image is published to GHCR on every push to `main`:

```
ghcr.io/x-rous/actual-admin-panel:latest
```

Releases are also tagged by commit SHA, enabling pinned deployments and rollbacks:

```
ghcr.io/x-rous/actual-admin-panel:<git-sha>
```

### Dev Container

The dev compose file mounts your source directory and runs the Turbopack hot-reload server. A named Docker volume persists the build cache across restarts.

**First-time setup** — run once on the host from the project root:

```bash
npm install
```

**Start the container:**

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

Edit `docker/docker-compose.dev.yml` to set the correct source volume path before starting. The server is available on port `3001`. Changes on the host are reflected immediately via hot reload.

To clear the Turbopack cache:

```bash
docker volume rm next-build-cache
```

### Build from Source

To build your own image using the multi-stage Dockerfile:

```bash
docker build -f docker/Dockerfile.prod -t actual-bench .
docker run -p 3000:3000 actual-bench
```

The production server uses ~256 MB RAM and runs as a non-root user.
