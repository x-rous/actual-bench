# Contributing

Contributions are welcome — bug reports, feature requests, and pull requests alike.

## Branch Model

```
feature/*  ──PR──►  edge  ──PR──►  main  ──tag v1.x.0──►  release
```

| Branch | Purpose | Docker tag |
|---|---|---|
| `main` | Stable releases only | `:latest` + `:<version>` |
| `edge` | Integration branch — all merged PRs land here first | `:edge` |
| `feature/*`, `fix/*` | Short-lived working branches — one per issue or feature | none |

Releases are cut as needed — minor/major versions roughly monthly, patch versions whenever a significant bug fix warrants it.

**All pull requests must target `edge`, not `main`.** The PR template will remind you.

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
git checkout edge       # start from edge, not main
npm install
npm run dev
```

### Before submitting

```bash
npm run lint    # must pass with 0 errors
npx tsc --noEmit  # must pass with 0 errors
npm test        # must pass
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
| **CI** (`.github/workflows/ci.yml`) | All pushes + PRs | Lint, type-check, build, test — must pass before any merge |
| **Edge** (`.github/workflows/edge.yml`) | Push to `edge` | Builds and pushes `:edge` + `:edge-{sha}` Docker tags, deploys to VPS |
| **Release** (`.github/workflows/release.yml`) | Push `v*` tag | Runs full CI + verifies `package.json` version matches tag, then builds and pushes `:latest` + `:<version>` Docker tags, deploys to VPS, creates GitHub Release with changelog notes |

## Docker Tags

| Tag | Stability | When to use |
|---|---|---|
| `:latest` | Stable — monthly release | Production / stable self-hosting (default) |
| `:<version>` (e.g. `:1.1.0`) | Stable — pinned | When you need a specific version |
| `:edge` | Unstable — updated on every merge to `edge` | Testing latest changes before release |
| `:edge-<sha>` | Unstable — specific commit | Debugging a specific change |

---

## Release Process (Maintainer)

When completing a roadmap item or shipping a fix, always:
1. Mark it `status: complete` in `agents/future-roadmap.md`
2. Add the feature to the relevant section of `FEATURES.md`
3. Add an entry under `## [Unreleased]` in `CHANGELOG.md`

### Cutting a release

```bash
# 1. On the edge branch — bump version and update changelog
git checkout edge && git pull origin edge

# Edit package.json "version": "1.1.0"
# Edit CHANGELOG.md: rename [Unreleased] → [1.1.0] - YYYY-MM-DD, add new [Unreleased] above

git add package.json CHANGELOG.md
git commit -m "chore: release v1.1.0"
git push origin edge
```

Open a PR from `edge` → `main`. After CI passes, approve and merge.

```bash
# 2. On main — tag the release
git checkout main && git pull origin main
git tag v1.1.0
git push origin v1.1.0
```

Pushing the tag triggers `release.yml` automatically — Docker images are built, VPS is updated, and the GitHub Release is created with the changelog notes.
