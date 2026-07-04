# Actual Bench — Agent Rules

> Self-hosted admin UI for Actual Budget. Target backend: **Direct Actual Server** via the browser API transport; compatibility backend: **HTTP API Server** via `actual-http-api`.
> Architecture: **Client → Direct transport → Actual Server** (target) and **Client → Next.js Proxy → actual-http-api** (maintained compatibility).
> Editing model: **Staged. Nothing writes to server until user clicks Save.**

---

## Stack (your training is outdated — follow these exactly)
- **Next.js 16** — Turbopack is the default dev server (`next dev`); do NOT add `--webpack`
- **React 19** — React Compiler enabled via `reactCompiler: true` in `next.config.ts` (Turbopack/SWC path). `babel-plugin-react-compiler` is in devDependencies for Jest only. `react-hooks/incompatible-library` warning is expected, do NOT fix
- **Tailwind 4** — no `tailwind.config.js`, config is in `globals.css` via `@theme`, no v3 patterns
- **Zustand 5** / **TanStack Query 5** / **TanStack Table 8** / **RHF 7 + Zod 4**
- **`distDir`** — `.next-build` everywhere (non-default; affects CI artifact paths, Docker COPY, build commands), **except on Vercel** (`process.env.VERCEL`) where it's the default `.next` because Vercel's builder expects that path

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
// ❌ fetch() directly to actual-http-api or Actual Server from feature code
// ✅ feature code uses transport/business helpers; HTTP API Server helpers use apiRequest() → /api/proxy → actual-http-api
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
| Transport logic | `src/lib/actual/*` |
| HTTP API Server helper logic | `src/lib/api/<entity>.ts` |
| Proxy (HTTP API Server mode) | `src/app/api/proxy/route.ts` |
| Staged store (entity pages) | `src/store/staged.ts` |
| Budget cell edits store | `src/store/budgetEdits.ts` |
| Budget mode shared utility | `src/lib/budget/deriveBudgetMode.ts` |
| Pages | `src/app/(app)/<page>/page.tsx` |
| Connection fields | `src/store/connection.ts` |
| CI/CD workflows | `.github/workflows/` |
| Docker changes | `docker/Dockerfile.prod` |
| Query client config | `src/lib/queryClient.ts` |
| Demo connection endpoint | `src/app/api/demo/route.ts` |
| Demo "Try it" button | `src/components/connect/DemoButton.tsx` |
| Demo backend (Hugging Face Space source) | `demo/` |

**Feature folder structure** (mandatory baseline):
```
src/features/<entity>/
  components/   hooks/   csv/   schemas/
  lib/          utils/   # optional, when the feature needs them
```

## Demo Deployment

The public demo (`actual-bench-demo.vercel.app`) is **separate from the self-hosted Docker product**: the Next.js UI runs on **Vercel**, talking to a **Hugging Face Space** backend.

- **`demo/`** is the Hugging Face Space source: `actual-server` (sync) + `actual-http-api` (REST) in one image, with a seed budget **baked in** (self-resets on restart). It deploys **manually/separately** — editing `demo/` does NOT auto-update the live backend. Regenerate the seed with `node demo/generate-seed.mjs`.
- `src/app/api/demo/route.ts` + `DemoButton` are gated on `DEMO_MODE=1` + the `DEMO_*` env vars → **inert/hidden for self-hosters**.
- Analytics (`src/components/demo-analytics.tsx`) is Vercel-only via `NEXT_PUBLIC_ANALYTICS=1` and is **tree-shaken out of self-hosted builds**.
- Vercel deploys a **preview per push/PR** (maintainer-only, auth-protected) and **production on every `main` merge**. Full guide: `docs/DEMO_DEPLOYMENT.md`.

## Proxy Notes

The proxy is the maintained HTTP API Server compatibility path. Direct mode should not duplicate proxy behavior; it should go through the transport abstraction. The proxy is responsible for:

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
| Roadmap work (master list of features - internal) | `agents/roadmap.md` |
| Reviewing existing features / improvements - internal| `agents/findings.md` |
| Context behind rejected/deferred items, constraints - internal | `agents/knowledge.md` |
| Git, workflow, or release change | `CONTRIBUTING.md` |
| Demo / Vercel / Hugging Face deployment | `docs/DEMO_DEPLOYMENT.md` |
| Overall agents/ folder framework -internal | `agents/FRAMEWORK.md` |

Update these only when the change requires it:

| Change | Update |
|---|---|
| User-facing feature added or changed | `FEATURES.md` |
| Setup, entry point, or positioning changed | `README.md` |
| RD-### item shipped or status changed - internal | `agents/roadmap.md` |
| F-### finding resolved - internal | `agents/findings.md` |

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