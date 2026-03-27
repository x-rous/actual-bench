# Contributing

Contributions are welcome — bug reports, feature requests, and pull requests alike.

## Reporting bugs

Open an issue on [GitHub Issues](https://github.com/x-rous/actual-admin-panel/issues) using the **Bug report** template. Include:

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
git clone https://github.com/x-rous/actual-admin-panel.git
cd actual-admin-panel
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

Check issues labelled [`good first issue`](https://github.com/x-rous/actual-admin-panel/issues?q=is%3Aissue+label%3A%22good+first+issue%22) or [`help wanted`](https://github.com/x-rous/actual-admin-panel/issues?q=is%3Aissue+label%3A%22help+wanted%22).

The highest-impact open areas are:

- **Schedules page** — list and edit scheduled transactions via the API
- **Pagination** — the app currently loads all entities at once; large budgets need virtual scrolling or server-side pagination
- **Accessibility** — ARIA live regions for async save operations, keyboard navigation improvements

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
