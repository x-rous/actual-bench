# Actual Bench — Agent Rules

> Self-hosted admin UI for Actual Budget. Backend: `actual-http-api`.
> Architecture: **Client → Next.js Proxy → actual-http-api**
> Editing model: **Staged. Nothing writes to server until user clicks Save.**

---

## Stack (your training is outdated — follow these exactly)
- **Next.js 16** — Turbopack is the default dev server (`next dev`); do NOT add `--webpack`
- **React 19** — React Compiler enabled via `reactCompiler: true` in `next.config.ts` (Turbopack/SWC path). `babel-plugin-react-compiler` is in devDependencies for Jest only. `react-hooks/incompatible-library` warning is expected, do NOT fix
- **Tailwind 4** — no `tailwind.config.js`, config is in `globals.css` via `@theme`, no v3 patterns
- **Zustand 5** / **TanStack Query 5** / **TanStack Table 8** / **RHF 7 + Zod 4**
- **`distDir: ".next-build"`** — non-default output dir; affects CI artifact paths, Docker COPY, and build commands

---

## Non-Negotiable Rules

**UUIDs**
```ts
// ❌ crypto.randomUUID()
// ✅
import { generateId } from "@/lib/uuid";
```

**API calls**
```ts
// ❌ fetch() directly to actual-http-api
// ✅ apiRequest() → /api/proxy → actual-http-api
```

**Mutations**
```ts
// ❌ call API from component
// ✅ stageNew | stageUpdate | stageDelete → user clicks Save → API
```

**Version endpoints** (`/v1/actualhttpapiversion`, `/actualserverversion`) are optional — always `Promise.allSettled()`, never block on failure.


**Git** — never auto-commit or auto-push. Always: show diff → propose message → wait for approval. PRs target `main`. Never work directly on `main` — always use a short-lived branch with an approved prefix (`feat/*`, `fix/*`, `refactor/*`, or `docs/*`). Use `x-rous` as the GitHub username and `Manaf` as the author name for all commits and PRs.
```
feat/* | fix/* | refactor/* | docs/*  →  main  →  release (tag v1.x.x)
```

---

## State Ownership
| Store | Owns |
|---|---|
| TanStack Query | Server snapshots (read-only) |
| Zustand `staged.ts` | Pending mutations + undo/redo |
| Zustand `connection.ts` | Active connection (`sessionStorage` — do NOT change to `localStorage`) |
| Zustand `savedServers.ts` | Saved server presets (`sessionStorage`) |
| Local state | Ephemeral UI only |

---

## File Map
| Task | Path |
|---|---|
| API logic | `src/lib/api/<entity>.ts` |
| Proxy | `src/app/api/proxy/route.ts` |
| Staged store | `src/store/staged.ts` |
| Pages | `src/app/(app)/<page>/page.tsx` |
| Connection fields | `src/store/connection.ts` |
| CI/CD workflows | `.github/workflows/` |
| Docker changes | `docker/Dockerfile.prod` |
| Query client config | `src/lib/queryClient.ts` |

**Feature folder structure** (mandatory baseline):
```
src/features/<entity>/
  components/   hooks/   csv/   schemas/
  lib/          utils/   # optional, when the feature needs them
```

**Proxy responsibilities:**
- CORS handling
- Request serialization via `serverQueueTails` (prevents concurrent budget open/close races)
- Path construction: `/accounts` → `GET /v1/budgets/{budgetSyncId}/accounts`
- Server-level paths (no `budgetSyncId`) passed as-is: `/v1/budgets/`
- Logging format: `METHOD STATUS /path (Xms) [reqId]`

---

## Reference Documents

Read these **before** implementing anything in the relevant area.

| Document | When to Read |
|---|---|
| `agents/coding_standards.md` | Before any new component, hook, or utility |
| `agents/actual_api_docs/api_docs.md` | Before any API integration |
| `agents/future-roadmap.md` | Before starting any roadmap item |
| `agents/requirements/` | Before making architectural decisions |
| `CONTRIBUTING.md` | Before touching git, workflows, or the release process |
| `FEATURES.md` | Before and after shipping a feature — must be updated |
| `README.md` | When entry points, setup flow, or product positioning changes |

When shipping user-facing work:
- Update `FEATURES.md` for shipped behavior.
- Update `README.md` if the main app entry points or product positioning changed.
- Update `agents/future-roadmap.md` when a roadmap item's status changes.

---

## Before Every Commit
```bash
npm run lint       # 0 errors
npx tsc --noEmit   # 0 errors
npm test           # all suites pass
```