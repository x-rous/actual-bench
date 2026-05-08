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
CI (`ci.yml`) runs lint, type-check, tests, and build on every push — no need to run these manually before committing.

---

## State Ownership
| Store | Owns |
|---|---|
| TanStack Query | Server snapshots (read-only) |
| Zustand `staged.ts` | Pending mutations + undo/redo (entity pages) |
| Zustand `budgetEdits.ts` | Budget cell edits + undo/redo (budget-management only — `BudgetCellKey` composite keys are incompatible with `staged.ts`) |
| Zustand `connection.ts` | Active connection (`sessionStorage` — do NOT change to `localStorage`) |
| Zustand `savedServers.ts` | Saved server presets (`sessionStorage`) |
| Local state | Ephemeral UI only |


---

## File Map
| Task | Path |
|---|---|
| API logic | `src/lib/api/<entity>.ts` |
| Proxy | `src/app/api/proxy/route.ts` |
| Staged store (entity pages) | `src/store/staged.ts` |
| Budget cell edits store | `src/store/budgetEdits.ts` |
| Budget mode shared utility | `src/lib/budget/deriveBudgetMode.ts` |
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

## Proxy Notes

The proxy is responsible for:

- CORS handling.
- Request serialization using `serverQueueTails`.
- Adding `/v1/budgets/{budgetSyncId}` for budget-scoped paths.
- Passing server-level paths as-is.

Do not bypass or duplicate proxy behavior in feature code.

---

## Reference Docs

Read these only when relevant to the task:

| Task | Read |
|---|---|
| New component, hook, or utility | `agents/coding_standards.md` |
| API integration | `agents/actual_api_docs/api_docs.md` |
| Roadmap work | `agents/future-roadmap.md` |
| Architecture decision | `agents/requirements/` |
| Git, workflow, or release change | `CONTRIBUTING.md` |

Update these only when the change requires it:

| Change | Update |
|---|---|
| User-facing feature added or changed | `FEATURES.md` |
| Setup, entry point, or positioning changed | `README.md` |

---

## Validation

GitHub Actions runs lint, typecheck, and tests on push/PR.

Before proposing completion, run only the checks that match the files changed when practical:

```bash
npm run lint
npx tsc --noEmit
npm test
```

Do not spend time running the full suite for documentation-only changes unless requested.