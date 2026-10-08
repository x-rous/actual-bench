# Actual Bench — Agent Instructions

> Applies to the whole repo unless a deeper `AGENTS.md` exists.
> Product: advanced administration, budgeting, diagnostics, ActualQL and budget-file-sync workbench for Actual Budget. It complements Actual Budget; it does not replace day-to-day transaction entry.

## 1. Start Here

1. Identify the smallest shippable scope of the request.
2. Inspect the relevant code, nearby tests and interfaces before trusting docs.
3. If `agents/` exists (gitignored, often absent), follow §10. If not, skip it.
4. State any material conflict between request, PR spec, code, tests and docs. Don't silently pick one.

Sources of truth: the user request (what to do); active `agents/pr-specs/PR-*.md` (PR scope); live code/types/migrations/tests (current behavior); `agents/roadmap.md`, `findings.md`, `knowledge.md` (planned/approved); `README.md`, `FEATURES.md`, `docs-site/` (user-facing); `package.json`, lockfiles, `.github/workflows/`, `next.config.ts` (versions and commands). Historical docs explain rationale; they never override live indexes or an active PR spec. Never hard-code the next RD/F/PR number; derive it from the master index.

## 2. Product Invariants

### Transport
Two transports: **Direct** (browser runtime, `@actual-app/api`) and **HTTP API** (browser → Next.js proxy → `actual-http-api`).
- All Actual reads/writes go through `getTransport()` from `@/lib/actual`. Never call Actual Server or `actual-http-api` from feature components/hooks.
- Add operations in `src/lib/actual/transport.ts`, implement both transports where supported. Never bypass capability checks.
- HTTP helpers: `src/lib/api/` via `apiRequest()`. Browser runtime: `src/lib/actual/browser/` or `browserApiTransport.ts`.
- External providers (e.g. FX) live in provider/service modules and server routes.
- Every `actual-http-api` request goes through `src/lib/http/serverQueue.ts` (FIFO + per-server lease); browser-safe code uses `serverRequestGate.ts`. Concurrent requests can wedge a budget. Never bypass it.

### Write model
| Area | Behavior |
|---|---|
| Accounts, payees, categories, rules, schedules, tags | Stage in `src/store/staged.ts`; write only on **Save** |
| Budget amounts, transfers, holds | Stage in `src/store/budgetEdits.ts`; write only on **Save** |
| Carryover toggle | Intentional direct write (`useCarryoverToggle`), per-item results |
| Notes | Intentional immediate save via transport note methods |
| Budget File Sync | Preview first; write only on **Apply** or opted-in safe-only automation |
| Bank Reconciliation | Stage in session; write only on **Apply** after a pre-flight re-read confirms rows are unchanged. Never writes a category |
| Sync flows, run history, FX registry, health metadata | Persist to the app DB |
| Diagnostics, ActualQL | Read-only unless a named workflow applies changes |

Don't change a workflow between staged and immediate without an approved product decision and updated tests/docs.

### Misc
- IDs: use `generateId()` from `@/lib/uuid`, never `crypto.randomUUID()` (plain-HTTP self-hosting).
- Version endpoints are optional: use `Promise.allSettled()`, degrade gracefully, never fail a successful connection over them.

## 3. Runtime and Dependencies

`package.json`, lockfiles and `.github/workflows/` are authoritative; don't copy versions into this file. Stack: Next.js 16 (Turbopack dev), React 19 + React Compiler, Tailwind 4 (config in `src/app/globals.css`, no `tailwind.config.js`), Zustand 5, TanStack Query 5 / Table 8, React Hook Form 7, Zod 4, strict TypeScript with `@/*` → `src/*`. Node version is whatever CI and `docker/Dockerfile.prod` pin; a local difference isn't a bug. Jest has two projects, `browser` (jsdom) and `node`; see `jest.config.cjs`.

- Next.js has breaking changes vs. your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code.
- Don't add `--webpack` to dev commands.
- The `react-hooks/incompatible-library` warning is expected. Don't weaken architecture or disable the React Compiler to silence it.
- Build output: `.next-build` outside Vercel, `.next` on Vercel, `output: "standalone"` for Docker. CI/Docker/cache/deploy changes must preserve this.

## 4. Persistence, Secrets and Workers

### Browser
Connections and all credentials are memory-only. Saved server presets may keep non-secret metadata in `sessionStorage`. Query caches are session-only. UI prefs in browser storage must hold no credentials or budget data. Never put API keys, server passwords, budget encryption passwords, the vault key or decrypted unattended credentials in storage, URLs, logs, analytics or error messages.

### App DB (`src/lib/app-db/`, server-only, `better-sqlite3`)
- Never import it into client code. Use repository/service modules, not SQL in components.
- Migrations: additive, ordered, transactional, backward compatible. Never edit a shipped migration; add a new one.
- A new persisted enum value (schedule kind, run status, trigger) needs a schema-version bump even with no column change, because `runMigrations` refuses a newer DB. Readers handle unknown values explicitly.
- Use foreign keys and indexes where access patterns need them; wrap multi-row transitions in transactions.
- Default path `/data/actual-bench.sqlite`; Vercel uses non-durable temp storage unless configured. It is workflow metadata, not a copy of a budget.

### Credential store
Every secret is a row in the `credentials` table, accessed only via `src/lib/credentials/store.ts` and the modules on top (`rememberedCredentials`, `unattendedCredentials`, `backupSecrets`). Don't add another sealing table/module.
- Each secret has one fixed **key domain**: `passphrase` (remembered, opened after user unlock) or `operator` (unattended/backup, opened with the vault key).
- Never read a secret in one domain and write it in the other (Bench has no login). Enrolling a remembered server for unattended use means the user re-supplies the secret.
- Reset/withdrawal in one domain never touches the other. Migrations copy ciphertext and never decrypt.

### Unattended-sync vault
Opt-in, server-side, for HTTP API and Direct alike.
- HTTP API enrols its API key. Direct enrols the Actual server **password**, never a session token (shared, non-expiring, survives password change). Secrets are one per server, with encryption passwords per budget.
- An enrolment is verified against the Actual server, in a worker, **before** storing (`src/lib/credentials/enrolments.ts`).
- Encrypted at rest with the operator key, resolved only in `src/lib/credentials/vaultKey.ts`: `ACTUAL_BENCH_VAULT_KEY` → deprecated `SYNC_VAULT_KEY` → `secrets/vault.key`.
- A key is generated only when no operator-domain secret exists; otherwise only a key that opens the stored secrets is acceptable (`vaultState.ts`). Never regenerate or overwrite a key file.
- Missing/wrong key = **locked**: fail closed, show it in App Health, never seal new operator secrets.
- Decrypted values never reach the browser. Direct budgets run unattended in a worker via `src/lib/actual/runtime/nodeHost.ts`, never on the web server thread.

### Automation workers (`src/lib/workers/`, `src/lib/automation/executor.ts`)
Every run executes in a disposable worker thread; the engine claims, schedules and records.
- A job uses only its context and the app DB. Server memory, `globalThis` singletons and module state aren't shared.
- Call `ctx.enterPhase("mutating")` (or `"external"`) immediately **before** the first budget/destination write or third-party-actionable request. Stopped after → `indeterminate`, never retried; before → failed. A write before the call is misreported.
- Honour `ctx.signal` (deadline + cancel) or the job is killed after a grace period.
- No plaintext secret crosses the worker boundary: tasks carry references. The sole exception is a not-yet-stored secret (enrolment check), sealed with the vault key and opened only in the worker.
- Tests run jobs in-thread (`ACTUAL_BENCH_AUTOMATION_EXECUTOR=in-thread`); the worker path uses `src/lib/workers/testing/fakeWorker.ts`; Docker smoke tests a real worker.

## 5. State and Data Flow

| Owner | Responsibility |
|---|---|
| TanStack Query | Fetch triggers, loading/error state, server snapshots |
| `staged.ts` | Entity working set, pending changes, save errors, merge metadata, undo/redo |
| `budgetEdits.ts` | Budget-cell/hold edits, selection, inverse-patch undo/redo |
| `connection.ts` / `savedServers.ts` | Memory-only connections / non-secret presets |
| App DB | Sync flows/runs/mappings, vault records, FX registry/snapshots, reconciliation data |
| Local React state | Ephemeral UI only |

**Queries:** the client uses infinite stale/cache times with no focus/reconnect refetch, because background loads can clobber unsaved work. New queries: scope keys by connection, invalidate explicit keys after writes, preserve staged rows on refetch, and add no broad auto-refetch without proving it can't overwrite unsaved edits.

**Save pipeline:** derive create/update/delete from staged state → call the active transport → keep per-item partial failures → clear only successes → record actionable errors on failed entries → sync the Direct runtime after success → invalidate the smallest query keys → leave failures retryable. Direct writes are serialized where required; don't swap in unconditional `Promise.all()`.

## 6. Data Contracts and Money

- Domain types are camelCase; upstream payloads may be snake_case. Normalize and denormalize only at the API/transport boundary. Don't leak `Api*` types outside `src/lib/api/` or transport internals.
- Never infer units from names:

| Context | Unit |
|---|---|
| Budget, category and transaction amounts | Integer minor units |
| Account balances on entity pages; `initialBalance` in UI model | Decimal whole units (converted at boundary) |
| FX rates | Positive decimal strings |
| FX conversion | Integer minor units, exact integer arithmetic, round only the final amount |

- Comment units on new public types and non-obvious variables. Never mix whole and minor units. No binary floats for persisted FX math. Preserve signs. Add boundary and rounding tests.

## 7. Budget File Sync

One engine. Type-specific behavior lives in a registered `SyncKindAdapter`; never build a parallel preview/apply/automation engine. Keep preview, apply, history, review queue, flow health and scheduling generic. Capability-gate; don't assume transport parity.

- Preview never writes. Apply re-checks route identity, capabilities, preview freshness and target guards.
- Automation is server policy-gated; safe-only automation applies only explicitly classified safe items. Duplicates, drift, source deletion, blocked items, warnings and ambiguous mappings stay reviewable unless a spec says otherwise. Never widen the auto-apply set as "cleanup".
- **Markers** are deterministic and portable, derived from source budget ID, target budget ID, target account ID and source item key. Never derive them from flow IDs, server URLs, local DB IDs or display names. App DB mappings are the primary local record; markers are the cross-instance dedupe mechanism. Treat them as opaque equality keys; don't parse them.
- A Direct runtime (tab or worker Node host) holds **one budget at a time**; Direct→Direct flows switch sequentially. No in-place same-server switch unless upstream adds a supported primitive and the architecture is revisited.

## 8. UI, Styling, Accessibility

- Reuse `src/components/ui/` (primitives), `src/components/layout/`, `src/features/<feature>/`, `src/app/(app)/...`. Don't create empty template folders.
- Tailwind 4 syntax, `cn()` for conditionals, semantic tokens from `globals.css` over raw palette/dark pairs. No unrelated mass token refactors.
- New/changed UI: icon-only controls get `aria-label`; keyboard behavior matches the ARIA role; status never by color alone; form controls labelled; preserve focus management in dialogs/popovers/drawers/menus; check narrow screens; reuse Base UI/shadcn patterns.

## 9. Testing and Validation

Add co-located regression tests (`.test.ts` / `.test.tsx`) for major changes, prioritizing: normalization/units, staged-state preservation and partial saves, transport parity and capability gates, sync planning/idempotency/apply guards, migrations and transactions, secret handling and serialization, easy-to-regress accessibility. Don't hard-code test counts in docs.

**CI is the full gate. Locally, run the smallest check that covers your change.** Full suite, cold lint and production build each cost minutes, and CI (`.github/workflows/ci.yml`) runs them in parallel on every PR.

**While implementing (every edit):**
```bash
npm test -- --findRelatedTests <changed-files> --bail   # or: npm test -- <path-or-pattern>
npm run lint -- <changed-paths>
```
- If a scoped run suggests wider impact, widen to that feature area, not the repo.
- Run `npm run typecheck` once per logical unit, not per edit.
- Run independent checks in parallel.
- `npm run lint` is cached and additive. **Never add `--no-cache`**: a cold lint takes minutes because `react-hooks/static-components` runs the React Compiler on every component. Run `rm -f .eslintcache` only after upgrading an ESLint plugin/config (the cache keys on file content, not rules).

**Before push or PR, scoped gate (default):**
```bash
npm run lint -- <changed-paths>
npm run typecheck
npm test -- --findRelatedTests <changed-files>
```
**Full gate** (`npm run lint`, `typecheck`, `npm test`, `npm run build`) only if: the user asks; you changed shared infrastructure (`src/types/`, the `src/lib/actual/` transport contract, `src/store/`, `src/lib/app-db/` or migrations, the `src/lib/sync/` engine, `jest.*`, `tsconfig.json`, `eslint.config.mjs`, `package.json`/lockfiles); or a scoped run implied wider reach.
**`npm run build`** only when you changed `next.config.ts`, routing/`src/app/` structure, the server/client import boundary, Docker/runtime layout, or dependencies.

`docs-site/` changes: `npm --prefix docs-site ci && npm --prefix docs-site run build`. Markdown-only root changes: no app suite unless executable config is affected or the user asks.

Report exactly what ran, which gate (scoped/full) and why, and what didn't run. Never claim CI passed unless observed.

## 10. Docs and Internal Planning

**Update docs in the same change:**
| Change | Update |
|---|---|
| User-facing behavior | `FEATURES.md` + relevant `docs-site/` guide |
| Setup, architecture, entry point, privacy, positioning | `README.md` + admin docs |
| Env var | Config/deployment docs + example/reference |
| Demo | `docs/DEMO_DEPLOYMENT.md`, `demo/` |
| Docker/runtime layout | `docker/Dockerfile.prod`, deployment docs, CI paths |

Keep claims consistent; avoid absolutes like "nothing writes until Save" given the documented exceptions.

**`agents/` (internal, gitignored; skip if absent).** Read only the live indexes: `roadmap.md` (RD-###), `findings.md` (F-###), `knowledge.md` (constraints, rejected/deferred), `FRAMEWORK.md` (process), `pr-specs/INDEX.md` (the only "what's next" dispatch table). Stale status text elsewhere isn't authoritative.
For non-trivial work: confirm the RD/F item and PR-spec → read its Why, Scope, Out of scope, Relevant files, Acceptance criteria, Status → verify files against the repo → one short-lived branch per shippable spec (lettered milestones stay on the parent branch) → on completion update the spec, `INDEX.md`, `roadmap.md`/`findings.md` (move resolved F to Done), `knowledge.md` for new binding constraints, and user docs. Batch items into one PR only if they share files or a tightly coupled area.
Numbers: never reuse; derive the next from the master index; record merged/superseded items instead of renumbering.

## 11. Git and Change Control

- Never work on `main`; PRs target `main`. Branch prefixes: `feat/`, `fix/`, `refactor/`, `docs/` (with a PR-spec: `<type>/pr-NNN-<slug>`). Keep changes focused.
- No amend, rebase, force-push, branch deletion or history rewrite without explicit approval.
- Don't commit, push, open a PR, merge or release on your own initiative: show the diff, propose wording, wait for approval. **Exception:** an explicit user/session instruction (e.g. "commit and push to branch X") is that approval, for the named branch and action only. It doesn't extend to opening a PR, merging or releasing.
- Author identity, when required: GitHub user `x-rous`, name `Manaf`.
- Commit messages and PR titles (PR titles become changelog entries): `<type>(<optional scope>): <summary>`, with type one of `feat|fix|refactor|docs|chore|test`; imperative mood, lowercase start (unless a code symbol/proper noun), no trailing punctuation, specific about what and where.
  `fix(ui): prevent double submission on submit button click` ✅ · `fix(ui): fix button bug` ❌

## 12. Completion Standard

Done means: requested behavior implemented without scope creep; both transports handled (or the unsupported capability is explicit and tested); write model preserved; no secret persisted or logged; units explicit and tested; staged changes can't be silently overwritten; sync preview/idempotency/review gates intact; relevant tests pass; docs and internal indexes updated. Don't mark an RD/F/PR item complete unless its acceptance criteria and doc updates are satisfied. State uncertainty plainly.

Handoff lists: files changed, behavior changed, validation performed (scoped or full), known limitations/follow-ups, commands not run.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->