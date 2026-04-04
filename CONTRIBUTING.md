# Contributing

Contributions are welcome — bug reports, feature requests, and pull requests alike.

## Branch Model

```
feat/* or fix/*  ──PR──►  main  ──push──►  :edge Docker + deploy
                               ──tag v1.x.0──►  :latest + :<version> + GitHub Release
```

| Branch | Purpose | Docker tag |
|---|---|---|
| `main` | Single long-lived branch — all PRs merge here | `:edge` (on every push) + `:latest` / `:<version>` (on tag) |
| `feat/*`, `fix/*`, `refactor/*`, `docs/*` | Short-lived working branches — one per issue or feature | none |

Releases are cut whenever a meaningful set of changes has accumulated, or immediately for any security or critical bug fix.

**All pull requests must target `main`.** The PR template will remind you.

## Reporting bugs

Open an issue on [GitHub Issues](https://github.com/x-rous/actual-bench/issues) using the **Bug report** template. Include:

- Steps to reproduce
- Expected vs. actual behaviour
- Browser and OS
- Version (shown in the sidebar footer)

## Suggesting features

Open an issue using the **Feature request** template. Check open issues first to avoid duplicates.

## Pull requests

### Prerequisites

- Node.js 20+
- A running [actual-http-api](https://github.com/sakowicz/actual-http-api) server (or use a test budget)

### Setup

```bash
git clone https://github.com/x-rous/actual-bench.git
cd actual-bench
git checkout main
npm install
npm run dev
```

### Before submitting

```bash
npm run lint      # must pass with 0 errors
npx tsc --noEmit  # must pass with 0 errors
npm test          # must pass
```

### Branch naming

| Type | Pattern | Example |
|---|---|---|
| Bug fix | `fix/<short-description>` | `fix/rule-drawer-width` |
| New feature | `feat/<short-description>` | `feat/schedules-page` |
| Docs | `docs/<short-description>` | `docs/docker-setup` |
| Refactor | `refactor/<short-description>` | `refactor/api-client` |

### Commit style

Plain English, imperative mood, no trailing period:

```
fix: rule drawer width not increasing behind Traefik
feat: add schedules page with basic CRUD
docs: document sessionStorage behaviour
```

### PR title and description

The `feat/* → main` PR is the source of truth for the release draft. Two things matter:

- **Title** — must be user-facing and clear. This becomes the changelog line verbatim.
  - ❌ `wip stuff` / `fix bug` / `update things`
  - ✅ `Add schedules page with basic CRUD` / `Fix rule drawer width behind Traefik`
- **Label** — controls which changelog section the PR appears under. Labels are auto-applied from your branch name but verify before merging:

| Branch prefix | Label applied | Changelog section |
|---|---|---|
| `feat/*` | `feature` | 🚀 Features |
| `fix/*` | `fix` | 🐛 Bug Fixes |
| `refactor/*` | `maintenance` | 🔧 Maintenance |
| `docs/*` | `docs` | 🔧 Maintenance |

The PR description is for reviewers — explain what changed, why, and include screenshots where relevant. It does not appear in the changelog.

### What to work on

Check issues labelled [`good first issue`](https://github.com/x-rous/actual-bench/issues?q=is%3Aissue+label%3A%22good+first+issue%22) or [`help wanted`](https://github.com/x-rous/actual-bench/issues?q=is%3Aissue+label%3A%22help+wanted%22).

Planned roadmap items with effort estimates are tracked in [`agents/future-roadmap.md`](agents/future-roadmap.md). If you want to pick up a `pending` item, open an issue first to claim it and avoid duplicate work.

## Project structure

```
src/
  app/
    (app)/          # Protected routes (auth-guarded by AppShell)
    (connect)/      # Unauthenticated connect page
    api/proxy/      # Server-side proxy to actual-http-api (avoids CORS)
  components/
    layout/         # AppShell, TopBar, Sidebar, DraftPanel
    ui/             # shadcn/ui primitives
  features/
    accounts/       # Accounts page, hooks, components
    categories/     # Categories page, hooks, components
    payees/         # Payees page, hooks, components
    rules/          # Rules page, drawer, condition/action builder
  lib/api/          # Typed API functions per entity
  store/
    connection.ts   # Zustand store — saved connections (sessionStorage)
    staged.ts       # Zustand store — pending edits with undo/redo
  types/            # Shared TypeScript types
```

## Code conventions

- **TypeScript** — strict mode; no `any`
- **Styling** — Tailwind CSS v4; use `cn()` for conditional classes
- **State** — Zustand stores for global state; TanStack Query for server data
- **Components** — React Server Components where possible; `"use client"` only when needed
- **Commits** — one logical change per commit; keep PRs focused
- **IDs** — always use `generateId()` from `src/lib/uuid.ts`; never `crypto.randomUUID()` directly (fails on HTTP)

---

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| **CI** (`.github/workflows/ci.yml`) | All pushes + PRs | Lint, type-check, test, build — must pass before any merge |
| **Edge** (`.github/workflows/edge.yml`) | Push to `main` | Builds and pushes `:edge` + `:edge-{sha}` Docker tags, deploys to VPS |
| **Release Drafter** (`.github/workflows/release-drafter.yml`) | Push to `main` | Updates a draft GitHub Release with all merged PRs since the last tag |
| **Release** (`.github/workflows/release.yml`) | Push `v*` tag | Runs full CI, verifies version, builds and pushes `:latest` + `:<version>` Docker tags, deploys to VPS, publishes the draft GitHub Release |

## Docker Tags

| Tag | Stability | When to use |
|---|---|---|
| `:latest` | Stable | Production / stable self-hosting (default) |
| `:<version>` (e.g. `:1.1.0`) | Stable — pinned | When you need a specific version |
| `:edge` | Unstable — updated on every merge to `main` | Testing latest changes before release |
| `:edge-<sha>` | Unstable — specific commit | Debugging a specific change |

---

## Release Process (Maintainer)

### Reviewing the draft

Every time a PR merges to `main`, the Release Drafter workflow automatically updates a draft GitHub Release at **GitHub → Releases**. Check it at any point to see what's queued for the next release. You can edit the draft to add an intro summary paragraph before publishing — everything else is generated automatically.

### Cutting a release

```bash
# 1. Bump version on main
git checkout main && git pull origin main

# Edit package.json "version": "1.2.0"

git add package.json
git commit -m "chore: release v1.2.0"
git push origin main

# 2. Tag main
git tag v1.2.0
git push origin v1.2.0
```

Pushing the tag triggers `release.yml` automatically — Docker images are built and the GitHub Release is published. Note: VPS is already on the latest code from the `edge.yml` deploy that ran on the version-bump push to `main`.