# Actual Bench — Agent Instructions

Advanced administration, budgeting, diagnostics, ActualQL and budget-file-sync workbench for Actual Budget. It complements Actual; it is not for day-to-day transaction entry. Desktop/laptop only; mobile is out of scope.

## 1. Sources of Truth

| Question | Source |
|---|---|
| What to do | The user request |
| PR scope | Active `agents/pr-specs/PR-*.md` |
| Current behavior | Live code, types, migrations, tests |
| Planned / approved work | `agents/roadmap.md` (RD-###), `agents/findings.md` (F-###), `agents/knowledge.md` |
| What's next | `agents/pr-specs/INDEX.md` (the only dispatch table) |
| Process | `agents/FRAMEWORK.md` |
| Manual testing target | `agents/live-test-server.md` |
| User-facing behavior | `README.md`, `FEATURES.md`, `docs-site/` |
| Versions, commands | `package.json`, `package-lock.json`, `.github/workflows/`, `next.config.ts` |

Other planning and historical docs are context only; their status text is never authoritative. If sources conflict, say so; don't silently pick one.

## 2. Transport

- Two transports: **Direct** (browser runtime, `@actual-app/api`) and **HTTP API** (browser → Next.js proxy → `actual-http-api`).
- All Actual reads/writes go through `getTransport()` in `src/lib/actual/`. Never call Actual Server or `actual-http-api` from components or hooks.
- New operations: add to `src/lib/actual/transport.ts`, implement in both transports where supported, keep capability checks.
- HTTP helpers: `src/lib/api/` via `apiRequest()`. Browser runtime: `src/lib/actual/browser/`.
- Every server-side `actual-http-api` request goes through `src/lib/http/serverQueue.ts` (FIFO + per-server lease); browser requests reach it via the proxy. `src/lib/http/serverRequestGate.ts` is only the browser-safe interface to it, not a serializer. Concurrent requests wedge budgets; never bypass the queue.
- External providers (e.g. FX) live in provider/service modules and server routes.

## 3. Write Model

| Area | Behavior |
|---|---|
| Accounts, payees, categories, rules, schedules, tags | Staged in `src/store/staged.ts`; written on **Save** |
| Budget amounts, transfers, holds | Staged in `src/store/budgetEdits.ts`; written on **Save** |
| Carryover toggle | Immediate write (`useCarryoverToggle`), per-item results |
| Notes | Immediate save via transport note methods |
| Cross Budget Sync | Preview first; written on **Apply** or opted-in safe-only automation |
| Bank Reconciliation | Staged in session; written on **Apply** after a pre-flight re-read confirms rows are unchanged; never writes a category |
| Sync flows, run history, FX registry, health metadata | App DB |
| Credit cards | App DB; each explicit **Save** writes immediately as one guarded change set; never writes Actual |
| Diagnostics, ActualQL | Read-only unless a named workflow applies changes |

Never claim "nothing writes until Save" in code comments or docs; the exceptions above are intentional.

## 4. Code Rules

- IDs: `generateId()` from `@/lib/uuid`. Never `crypto.randomUUID()` (fails on plain-HTTP self-hosting).
- Version endpoints are optional: use `Promise.allSettled()`; never fail a connection over them.
- Domain types are camelCase. Convert snake_case only at the API/transport boundary. `Api*` types stay inside `src/lib/api/` and transport internals.
- Money units. Never infer them from names:

| Context | Unit |
|---|---|
| Budget, category, transaction amounts | Integer minor units |
| Account balances on entity pages; `initialBalance` in the UI model | Decimal whole units (converted at the boundary) |
| FX rates | Positive decimal strings |
| FX conversion | Integer minor units, exact integer math, round only the final amount |

- Comment the unit on new public types and non-obvious variables. Never mix units, never use binary floats for persisted FX math, preserve signs.

## 5. State and Data Flow

| Owner | Owns |
|---|---|
| TanStack Query | Fetching, loading/error state, server snapshots |
| `src/store/staged.ts` | Entity working set, pending changes, save errors, merge metadata, undo/redo |
| `src/store/budgetEdits.ts` | Budget-cell/hold edits, selection, inverse-patch undo/redo |
| `src/store/connection.ts` | Active connection (memory-only) |
| `src/store/savedServers.ts` | Non-secret server presets (`sessionStorage`) |
| App DB | Sync flows/runs/mappings, vault records, FX registry/snapshots, reconciliation data, credit-card metadata |
| `creditCardStore` | Credit-card cache per budget (loaded from the app DB), command-scoped undo |
| Local React state | Ephemeral UI only |

- **Queries** use infinite stale/cache time and no focus/reconnect refetch, because refetches clobber unsaved edits. New queries: key by connection, invalidate explicit keys after writes, preserve staged rows on refetch, no broad auto-refetch.
- **Save pipeline:** staged state → create/update/delete → active transport → keep per-item failures retryable → clear only successes → sync the Direct runtime → invalidate the smallest query keys. Keep Direct writes serialized; no blanket `Promise.all()`.

## 6. Persistence and Secrets

**Browser**
- Connections and credentials are memory-only. Query caches are session-only.
- Never put API keys, passwords, encryption passwords, the vault key or decrypted credentials in browser storage, URLs, logs, analytics or error messages.

**App DB** (`src/lib/app-db/`, server-only, `better-sqlite3`)
- Never import it into client code; no SQL in components.
- Migrations are additive, ordered, transactional and backward compatible. Never edit a shipped migration; add a new one.
- A new persisted enum value (schedule kind, run status, trigger) needs a schema-version bump, because `runMigrations` refuses a newer DB. Readers handle unknown values.
- Path: `/data/actual-bench.sqlite`; on Vercel, a non-durable temp directory unless configured (`src/lib/app-db/connection.ts`). It stores workflow metadata, never a budget copy.

**Credentials** (`src/lib/credentials/`)
- Every secret is a row in the `credentials` table, accessed only through `src/lib/credentials/store.ts` and its `rememberedCredentials`, `unattendedCredentials` and `backupSecrets` modules. Never add another sealing table or module.
- Each secret has one fixed key domain: `passphrase` (remembered, user unlock) or `operator` (unattended/backup, vault key). Never move a secret between domains; unattended enrolment makes the user re-enter it. Resetting one domain never touches the other. Migrations copy ciphertext and never decrypt.

**Unattended-sync vault**
- HTTP API enrols its API key. Direct enrols the server **password**, never a session token. One secret per server; encryption passwords per budget.
- Verify every enrolment against the Actual server, in a worker, before storing (`src/lib/credentials/enrolments.ts`).
- The key resolves only in `src/lib/credentials/vaultKey.ts`: `ACTUAL_BENCH_VAULT_KEY` → `SYNC_VAULT_KEY` (deprecated) → `secrets/vault.key`. A key is generated only when no operator secret exists (`src/lib/credentials/vaultState.ts`). Never regenerate or overwrite a key file.
- Missing or wrong key = **locked**: fail closed, show it in App Health, seal nothing new.
- Decrypted values never reach the browser. Unattended Direct budgets run in a worker via `src/lib/actual/runtime/nodeHost.ts`, never on the web server thread.

**Automation workers** (`src/lib/workers/`, `src/lib/automation/executor.ts`)
- Each run is a disposable worker thread. Jobs use only their context and the app DB; no shared memory, `globalThis` singletons or module state.
- Call `ctx.enterPhase("mutating")` (or `"external"`) immediately before the first write or third-party-actionable request. Before that phase: user cancel = `cancelled`, deadline or worker failure = `failed`. Forced termination after it = `indeterminate`, never retried (`src/lib/automation/engine.ts`).
- Honour `ctx.signal` (deadline and cancel), or the job is killed.
- Tasks carry secret references, never plaintext. Sole exception: an enrolment check's not-yet-stored secret, sealed with the vault key and opened only in the worker.

## 7. Cross Budget Sync (`src/lib/sync/`)

- One engine. Type-specific logic lives in a registered `SyncKindAdapter`; never build a parallel preview/apply/automation path. Capability-gate; never assume transport parity.
- Preview never writes. Apply re-checks route identity, capabilities, preview freshness and target guards.
- Safe-only automation applies only items classified safe. Duplicates, drift, source deletions, blocked items, warnings and ambiguous mappings stay in review. Never widen the auto-apply set.
- **Markers** derive only from source budget ID, target budget ID, target account ID and source item key; never from flow IDs, URLs, local DB IDs or names. They are opaque equality keys; never parse them. App DB mappings are the local record; markers dedupe across instances.
- A Direct runtime holds one budget at a time; Direct→Direct flows switch sequentially.

## 8. Stack and UI

- npm only (`package-lock.json`). Never use yarn/pnpm or add other lockfiles.
- Versions live in `package.json`; the Node version is pinned by `.github/workflows/` and `docker/Dockerfile.prod`. A local difference is not a bug.
- Next.js has breaking changes vs. your training data; see the managed block at the end. Never add `--webpack`.
- React Compiler is on. The `react-hooks/incompatible-library` warning is expected; leave it.
- Build output: `.next-build` (default, overridable via `ACTUAL_BENCH_DIST_DIR`), `.next` on Vercel, `output: "standalone"` for Docker. Preserve all of these in CI/Docker changes.
- Tailwind 4: config in `src/app/globals.css` (`@theme`); no `tailwind.config.js`. Use `cn()` and semantic tokens from `src/app/globals.css`.
- Reuse `src/components/ui/`, `src/components/layout/` and `src/features/<feature>/`. Never create empty template folders.
- Accessibility on new/changed UI: `aria-label` on icon-only controls, keyboard behavior matching the ARIA role, status never by color alone, labelled inputs, focus preserved in dialogs, popovers, drawers and menus.

## 9. Testing (light)

- Add regression tests only for major, high-impact changes. Never add a test per small fix.
- Default checks, scoped to what you changed:
  ```bash
  npm test -- --findRelatedTests <changed-files>
  npm run lint -- <changed-paths>
  npm run typecheck
  ```
- If a scoped run shows wider impact, widen to that feature area, not the repo.
- Run the full suite (`npm run lint`, `npm run typecheck`, `npm test`) only when the user asks or you changed `src/types/`, the `src/lib/actual/` transport contract, `src/store/`, `src/lib/app-db/` or migrations, `src/lib/sync/`, `jest.config.cjs`, `tsconfig.json`, `eslint.config.mjs`, `package.json` or `package-lock.json`.
- Run `npm run build` only when you changed `next.config.ts`, routing under `src/app/`, the server/client import boundary, Docker/runtime layout, or dependencies.
- CI (`.github/workflows/ci.yml`) is the full gate.
- Never add `--no-cache` to lint; a cold lint takes minutes. Delete `.eslintcache` only after upgrading an ESLint plugin or config.
- `docs-site/` changes: `npm --prefix docs-site ci && npm --prefix docs-site run build`. Markdown-only changes: no checks.
- Automation tests run in-thread (`ACTUAL_BENCH_AUTOMATION_EXECUTOR=in-thread`); the worker path uses `src/lib/workers/testing/fakeWorker.ts`.
- Report what ran and what didn't. Never claim CI passed unless you saw it.

## 10. Dev Server and Live Data

- Use the existing dev server in this workspace. Never start `next dev`, `npm run dev` or another server unless the task explicitly requires it (`docs-site/scripts/capture-screenshots.mjs` intentionally starts its own isolated server).
- Manual checks run only against the test Actual server and budget in `agents/live-test-server.md`; connect with the details there. Never Save, Apply, run a sync or automation, enrol credentials or touch the vault on any other server or budget. If you can't tell which budget is active, stop and ask.
- Never copy values from `agents/live-test-server.md` into code, tests, logs, commits, docs or PR text.

## 11. Docs

Update in the same change:

| Change | Update |
|---|---|
| User-facing behavior | `FEATURES.md` + the relevant `docs-site/` guide |
| Setup, architecture, entry point, privacy, positioning | `README.md` + `docs-site/` admin docs |
| Env var | `docs-site/` config/deployment docs + example env file |
| Demo | `docs/DEMO_DEPLOYMENT.md`, `demo/` |
| Docker/runtime layout | `docker/Dockerfile.prod`, `docs-site/` deployment docs, `.github/workflows/` paths |

## 12. Planning (`agents/`)

**Planning files are only for implementing an RD-### or F-### item.**
- Never create an RD or F item on your own. Create one only when the user explicitly asks to add it to the roadmap or findings. A task request is not that request.
- Create a PR-spec, or edit `agents/pr-specs/INDEX.md`, `agents/roadmap.md` or `agents/findings.md`, only when implementing an existing RD/F item or adding one the user asked for.
- Everything else (fixes, tweaks, refactors, adjustments, follow-ups) is done directly: no RD/F item, no PR-spec, no new number, no index or roadmap edits.
- `agents/` is gitignored, so its edits never appear in `git diff`. List every `agents/` file you changed in the handoff.

**RD/F work**
- Follow its PR-spec (Why, Scope, Out of scope, Relevant files, Acceptance criteria). If the spec's files have drifted from the repo, report it before implementing.
- One short-lived branch per shippable PR-spec. Lettered PR-specs (`PR-NNNa`, `PR-NNNb`) stay on the parent branch.
- Combine items in one PR only when they share files or a tightly coupled area.
- On completion update: the PR-spec, `agents/pr-specs/INDEX.md`, `agents/roadmap.md` or `agents/findings.md` (move resolved F items to Done), `agents/knowledge.md` (new binding constraints), and docs per §11.

**Numbering: the user decides when an RD/F item exists; you assign its number.** PR numbers are assigned only for PR-specs that implement an RD/F item.
- Each namespace has one index: RD → `agents/roadmap.md`, F → `agents/findings.md`, PR → `agents/pr-specs/INDEX.md`.
- Next number = the next free number in that index, skipping any number its numbering/reservation notes reserve.
- Re-read the index, then add the row before starting work.
- Never reuse or renumber; mark merged/superseded items instead.

## 13. Git

- Never work on `main`; PRs target `main`. Branches: `feat/`, `fix/`, `refactor/`, `docs/`; with a PR-spec: `<type>/pr-NNN-<slug>`.
- Commit, push, open a PR, merge, tag or release only when explicitly instructed. An instruction covers only the named action and branch. Otherwise show the diff and the proposed message, then wait.
- Never amend, rebase, force-push, delete branches or rewrite history without approval.
- Commits are authored as Manaf (GitHub `x-rous`). Never change git config.
- Never commit secrets, `secrets/`, `.env*` files with real values, vault keys or app DB files.
- Commit messages and PR titles (PR titles become changelog entries): `<type>(<scope>): <summary>`, type `feat|fix|refactor|docs|chore|test`, imperative, lowercase start, no trailing period.
  ✅ `fix(ui): prevent double submission on submit button click` · ❌ `fix(ui): fix button bug`

## 14. Ask First

- Adding, removing or major-upgrading a dependency.
- Changing build output, Docker/runtime layout or CI beyond the task.
- Changing `src/lib/http/serverQueue.ts`, `src/lib/http/serverRequestGate.ts`, `src/lib/credentials/vaultKey.ts`, `src/lib/credentials/vaultState.ts` or a shipped migration.
- Switching a workflow between staged and immediate writes.

With nobody available to answer, stop at that point and state what you would have done.

## 15. Done

Done = the request is implemented without scope creep; both transports are handled or the gap is explicit; write model, secrets, units, staged edits and sync gates are intact; scoped checks pass; docs are updated (and, for RD/F work only, `agents/` indexes). Mark an RD/F/PR item complete only when its acceptance criteria are met.

Handoff: files changed (including `agents/`), numbers created, behavior changed, checks run and not run, known gaps.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->