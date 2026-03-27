# Actual Budget Admin Panel

![Version](https://img.shields.io/github/v/release/x-rous/actual-admin-panel?label=version)
![License](https://img.shields.io/github/license/x-rous/actual-admin-panel)

A web-based admin panel for [Actual Budget](https://actualbudget.org/) that connects to a self-hosted [actual-http-api](https://github.com/jhonderson/actual-http-api) server. Manage accounts, payees, categories, and rules through a clean UI with staged editing, undo/redo, and CSV import/export.

## Features

- **Multi-connection support** — save and switch between multiple Actual Budget servers; all staged data and query cache are scoped per connection
- **Staged editing** — all changes are held locally until you click Save; inline editing never touches the server immediately
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

## Quick Start (Docker)

Pull the pre-built image from GHCR — no local build required:

```bash
docker run -p 3000:3000 ghcr.io/x-rous/actual-admin-panel:latest
```

Or with Docker Compose:

```yaml
services:
  actual-admin-panel:
    image: ghcr.io/x-rous/actual-admin-panel:latest
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      NEXT_TELEMETRY_DISABLED: "1"
    restart: unless-stopped
```

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). See [Docker](#docker) for Traefik/HTTPS configuration.

## Connecting to Actual Budget

On the Connect screen enter:

| Field | Description |
|---|---|
| **Server URL** | Base URL of your actual-http-api server (e.g. `https://actual-api.example.com`) |
| **API Key** | The `ACTUAL_API_KEY` you set on the server |
| **Budget Sync ID** | The sync ID of the budget file (visible in Actual Budget under Settings → Sync) |
| **Encryption Password** | Only required if the budget is end-to-end encrypted |

After connecting, the connection is saved in your browser's **session storage** so credentials are automatically cleared when you close the tab. You will need to reconnect each time you open a new tab — this is intentional for security. Use the connection menu in the top bar to add more connections or switch between them.

## Staged Editing Workflow

1. Make changes inline (click any cell to edit, press Enter or click away to confirm)
2. New rows, updates, and deletions are highlighted in the table
3. Click **Save** in the top bar to persist all changes to the server
4. Click **Discard** to revert all pending changes
5. Use **Undo** / **Redo** to step through your local edit history before saving

## CSV Import / Export

Every entity page has an Export button that downloads a UTF-8 CSV file compatible with Excel. The Import button accepts the same format — rows are staged as new or updated entities and are not saved until you click Save.

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
| `npm run clean` | Delete build artifacts (`.next-build/`, `tsconfig.tsbuildinfo`) |
| `npm version patch\|minor\|major` | Bump version, commit, and tag |

See [CONTRIBUTING.md](CONTRIBUTING.md) for release and contribution guidelines.

## Docker

### Pre-built Image (Recommended)

The latest image is published to GHCR automatically on every push to `main`:

```
ghcr.io/x-rous/actual-admin-panel:latest
```

Pinned releases are also tagged by commit SHA for rollbacks:

```
ghcr.io/x-rous/actual-admin-panel:<git-sha>
```

### Dev Container (Portainer / Traefik)

The dev compose file mounts your source directory and starts the Turbopack hot-reload server. A named Docker volume persists the Turbopack build cache across restarts.

**First-time setup** (run once on the host, from the project root):

```bash
npm install
```

**Start the container:**

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

Edit `docker/docker-compose.dev.yml` to set the source volume path and your Traefik hostname before starting. The server is available on port `3001`. Edit files on the host and changes appear immediately via hot reload.

To clear the Turbopack cache:

```bash
docker volume rm next-build-cache
```

### Production Build (from source)

Multi-stage Dockerfile — builds a lean runtime image with production-only `node_modules` running as a non-root user.

```bash
# Build and run (docker-compose.yml is in the project root)
docker compose up --build

# Or build manually
docker build -f docker/Dockerfile.prod -t actual-admin-panel .
docker run -p 3000:3000 actual-admin-panel
```

The production server uses ~256 MB RAM. The compose file includes Traefik labels for HTTPS termination.
