# Actual Bench — Agent Instructions

> Scope: this file applies to the entire repository unless a more specific `AGENTS.md` exists below the working directory.
>
> Product: Actual Bench is an advanced administration, budgeting, diagnostics, ActualQL, and budget-file-sync workbench for Actual Budget. It complements Actual Budget; it does not replace its day-to-day transaction-entry experience.

---

## 1. Start Here

Before changing code:

1. Read the user's request and identify the smallest shippable scope.
2. Read this file.
3. Inspect the relevant implementation, nearby tests, and current interfaces before trusting older documentation.
4. When the internal `agents/` folder is available, follow the planning and execution workflow in [Internal Planning Framework](#12-internal-planning-framework).
5. State any material conflict between the request, active PR spec, live code, tests, and documentation. Do not silently choose one.

### Source-of-truth hierarchy

Use the following hierarchy, but distinguish **intended scope** from **current behavior**:

| Question | Primary source |
|---|---|
| What did the user ask for? | The current user request |
| What is this PR supposed to deliver? | Active `agents/pr-specs/PR-*.md`, when present |
| What does the application do today? | Live code, types, migrations, and tests |
| What is planned or approved? | `agents/roadmap.md`, `agents/findings.md`, and `agents/knowledge.md` |
| What should users be told? | `README.md`, `FEATURES.md`, and `docs-site/` |
| What versions and commands are current? | `package.json`, lockfiles, workflow files, and `next.config.ts` |

Historical planning and review documents explain rationale; they do not override live master indexes or an active PR spec.

Do not hard-code the “next” RD, F, or PR number in this file. Derive it from the current master index.

---

## 2. Non-Negotiable Product Invariants

### Dual transport architecture

Actual Bench supports two maintained transports:

- **Direct Actual Server mode**: browser runtime using `@actual-app/api`.
- **HTTP API Server mode**: browser → Next.js proxy → `actual-http-api`.

All reads and writes against an Actual budget must use the shared transport abstraction:

```ts
import { getTransport } from "@/lib/actual";
```

Rules:

- Do not call Actual Server or `actual-http-api` directly from feature components or feature hooks.
- Add or extend operations in `src/lib/actual/transport.ts`, then implement both transports where the capability is supported.
- HTTP-specific helpers belong in `src/lib/api/` and use `apiRequest()`.
- Browser-runtime behavior belongs in `src/lib/actual/browser/` or `browserApiTransport.ts`.
- External providers, such as FX providers, must be isolated in provider/service modules and server routes where appropriate.
- Never create a second implementation path that bypasses transport capability checks.

### Write-model matrix

“Staged by default” is not the same as “every write is staged.” Use the correct model:

| Area | Write behavior |
|---|---|
| Entity pages: accounts, payees, categories, rules, schedules, tags | Stage in `src/store/staged.ts`; write only on explicit **Save** |
| Budget amounts, transfers, and holds | Stage in `src/store/budgetEdits.ts`; write only on explicit **Save** |
| Carryover toggle | Current intentional direct-write exception through `useCarryoverToggle`; explicit action with per-item results |
| Notes | Intentional immediate-save exception through transport note methods |
| Budget File Sync | Preview first; write only through explicit **Apply** or an opted-in safe-only automation policy |
| Sync flows, run history, FX registry, app health metadata | Persist to the Actual Bench app database according to the action |
| Diagnostics and ActualQL | Read-only unless a separately named workflow explicitly applies changes |

Do not move an existing workflow from staged to immediate, or immediate to staged, without an approved product decision and updated tests/docs. Carryover remains direct until the approved staged-carryover work is implemented.

### IDs

Never call `crypto.randomUUID()` directly:

```ts
import { generateId } from "@/lib/uuid";
```

`generateId()` preserves support for plain-HTTP self-hosted environments.

### Optional version checks

Version endpoints are optional. A version failure must not block connection:

- use `Promise.allSettled()`;
- show unavailable version data gracefully;
- do not turn a successful connection into a failure because a version endpoint is missing.

---

## 3. Runtime and Dependency Constraints

`package.json` and lockfiles are authoritative. At the time of writing, the important constraints are:

- Next.js 16 with Turbopack as the normal development server.
- React 19 with React Compiler enabled.
- Tailwind CSS 4 configured through `src/app/globals.css`; there is no `tailwind.config.js`.
- Zustand 5, TanStack Query 5, TanStack Table 8, React Hook Form 7, and Zod 4.
- Node.js **22.23.1** is the CI baseline.
- Root TypeScript is strict and uses `@/*` → `src/*`.
- Jest runs with `jest-environment-jsdom`.

Do not add `--webpack` to normal Next.js development commands.

The `react-hooks/incompatible-library` warning associated with the current compiler/library combination is expected. Do not “fix” it by weakening architecture or disabling the React Compiler.

### Build output

The app uses:

- `.next-build` outside Vercel;
- `.next` on Vercel;
- `output: "standalone"` for production Docker packaging.

Any CI, Docker, cache, or deployment change must preserve this distinction.

---

## 4. Client, Server, and Persistence Boundaries

### Browser/client state

- Active connections and all credentials are **memory-only**.
- Saved server presets may persist **non-secret metadata only** in `sessionStorage`.
- TanStack Query caches are session-only and are not persisted.
- Local UI preferences may use browser storage only when they contain no credentials or budget data.

Never persist these in `localStorage`, `sessionStorage`, URLs, logs, analytics, or error messages:

- API keys;
- Actual Server passwords;
- budget encryption passwords;
- `SYNC_VAULT_KEY`;
- decrypted unattended-sync credentials.

### Actual Bench app database

`src/lib/app-db/` is server-only and uses `better-sqlite3`.

Rules:

- Never import app-database modules into client components or browser bundles.
- Use repository/service modules rather than SQL in React components.
- Keep migrations additive, ordered, transactional, and backward compatible.
- Never rewrite a migration that may have shipped. Add a new migration.
- Use foreign keys and explicit indexes where the access pattern requires them.
- Multi-row state transitions should be transactional.
- The default self-hosted path is `/data/actual-bench.sqlite`; Vercel falls back to non-durable temp storage unless explicitly configured.
- Treat the app database as workflow metadata, not as a copy of an Actual Budget file.

### Unattended-sync credential vault

Unattended HTTP-mode sync is opt-in and server-side:

- credentials are encrypted at rest;
- encryption depends on `SYNC_VAULT_KEY`;
- decrypted values never return to the browser;
- a missing/rotated key must fail closed and surface health state;
- Direct-mode flows cannot become unattended server jobs because their runtime is browser-owned.

---

## 5. State Ownership and Data Flow

| Owner | Responsibility |
|---|---|
| TanStack Query | Fetch triggers, loading/error state, and server snapshots |
| Zustand `staged.ts` | Entity working set, pending changes, save errors, merge metadata, undo/redo |
| Zustand `budgetEdits.ts` | Budget-cell and hold edits, selection state, inverse-patch undo/redo |
| Zustand `connection.ts` | Active memory-only connections |
| Zustand `savedServers.ts` | Non-secret server presets in session storage |
| Actual Bench app DB | Sync flows/runs/mappings, encrypted opt-in vault records, FX registry/snapshots |
| Local React state | Ephemeral component UI only |

### Query behavior

The query client intentionally uses infinite stale/cache times and disables focus/reconnect refetches because background loads can conflict with unsaved work.

For new server queries:

- scope keys by connection identity where applicable;
- invalidate explicit keys after successful writes;
- preserve staged rows during refetch;
- do not add broad auto-refetch behavior without proving it cannot overwrite or confuse unsaved edits.

### Save pipelines

Follow the established pattern:

1. derive create/update/delete operations from staged state;
2. call the active transport, never the component-facing API directly;
3. preserve per-item partial failures;
4. clear only successful staged entries;
5. record actionable save errors on failed entries;
6. sync the Direct runtime after successful writes;
7. invalidate the smallest relevant query keys;
8. leave failed work available for retry.

Direct transport writes are intentionally serialized where required. Do not replace transport-aware write helpers with unconditional `Promise.all()`.

---

## 6. Data Contracts and Money

### API normalization

Internal domain entities are camelCase. Upstream API payloads may be snake_case.

- Normalize at the API/transport boundary.
- Denormalize only in API/transport writers.
- Do not leak `Api*` types outside `src/lib/api/` or transport internals.
- Keep UI, stores, and feature logic on normalized app-level types.

### Amount-unit rules

Actual Bench uses more than one amount representation. Never infer the unit from the variable name alone.

| Context | Unit |
|---|---|
| Budget month/category amounts and transaction amounts | Integer minor units |
| Account balances displayed on entity pages | Decimal whole-currency units |
| Account `initialBalance` in the normalized UI model | Decimal whole-currency units; converted at the boundary |
| FX rates | Positive decimal strings |
| FX conversion | Integer minor units with precise integer arithmetic; round only the final amount |

Rules:

- Add unit comments to new public types and non-obvious variables.
- Never mix whole units and minor units in arithmetic.
- Do not use binary floating-point for persisted FX-rate calculations.
- Preserve signs exactly.
- Add boundary and rounding tests for financial transformations.

---

## 7. Budget File Sync Invariants

Budget File Sync is one unified engine.

### Adapter architecture

All data-type-specific behavior belongs in a `SyncKindAdapter`.

- Do not create a parallel preview/apply/automation engine.
- Add a new adapter and register it.
- Keep preview, apply, history, review queue, flow health, and scheduling generic.
- Capability-gate behavior instead of assuming transport parity.

### Preview and apply safety

- Preview must not write to Actual.
- Apply must re-check route identity, capabilities, preview freshness, and target guards.
- Automation is policy-gated on the server.
- Safe-only automation may apply only explicitly classified safe items.
- Duplicates, source drift, source deletion, blocked items, warnings, and ambiguous mappings remain reviewable unless an approved spec says otherwise.
- Never widen the auto-apply set as a “cleanup.”

### Idempotency and markers

Transaction sync markers are deterministic and portable across Actual Bench instances.

They derive from stable route identity:

- source budget ID;
- target budget ID;
- target account ID;
- source item key.

Never derive the marker from:

- random flow IDs;
- server URLs;
- local database IDs;
- display names.

App DB mappings remain the primary local record. The marker is the cross-instance recovery and dedupe mechanism. Do not parse markers; treat them as opaque equality keys.

### Direct runtime limitation

The Direct browser runtime owns one active budget runtime at a time. Opening another connection tears down and initializes the runtime for that budget.

Do not attempt an in-place same-server budget switch unless the upstream Actual API provides a supported primitive and the architecture is explicitly revisited.

---

## 8. UI, Styling, and Accessibility

### Components and feature layout

Use existing primitives before introducing new UI infrastructure:

- reusable primitives: `src/components/ui/`;
- app-wide layout: `src/components/layout/`;
- feature code: `src/features/<feature>/`;
- route entry points: `src/app/(app)/...`.

A feature may use `components/`, `hooks/`, `lib/`, `schemas/`, `csv/`, `utils/`, or other folders when justified. Do not create empty folders merely to match a template.

### Tailwind and themes

- Use Tailwind 4 syntax.
- Use `cn()` for conditional class composition.
- Prefer semantic theme tokens from `globals.css`.
- Do not introduce new raw palette/dark-mode pairs when a semantic token fits.
- Do not perform unrelated mass token refactors inside a feature PR.

### Accessibility requirements for new or changed UI

- Icon-only controls require an accessible name, normally `aria-label`.
- Keyboard interaction must match the declared ARIA role.
- Status must not be conveyed by color alone.
- Form controls need programmatic labels.
- Preserve focus management in dialogs, popovers, drawers, and menus.
- Validate narrow-screen behavior for any layout you touch.
- Reuse existing Base UI/shadcn patterns unless there is a clear gap.

---

## 9. Testing and Validation

Add focused regression tests for behavior changes. Co-locate tests near the implementation using the existing `.test.ts` / `.test.tsx` convention.

Prioritize tests for:

- normalization and unit conversion;
- staged-state preservation and partial saves;
- transport parity and capability gates;
- sync planning, idempotency, and apply guards;
- app DB migrations and transaction boundaries;
- security-sensitive serialization, shell escaping, and secret handling;
- accessibility behavior that is easy to regress.

Do not hard-code the repository's current test count in documentation.

### During implementation

Run the narrowest useful check first:

```bash
npm test -- <relevant-test-path-or-pattern>
npm run lint -- <relevant-path>
```

### Before code handoff or PR

For application code, run:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

For `docs-site/` changes, run:

```bash
npm --prefix docs-site ci
npm --prefix docs-site run build
```

For root Markdown-only changes, do not run the full application suite unless the change also affects executable configuration or the user asks for it.

Report exactly what ran and what did not run. Never claim CI passed unless you observed it.

---

## 10. Documentation and Configuration Updates

Update documentation as part of the same change when behavior changes.

| Change | Required update |
|---|---|
| User-facing feature or material behavior | `FEATURES.md` and the relevant `docs-site/` guide |
| Setup, architecture, primary entry point, privacy, or positioning | `README.md` and relevant admin docs |
| Environment variable | Configuration/deployment docs and an appropriate example/reference |
| Demo behavior or deployment | `docs/DEMO_DEPLOYMENT.md` and, if relevant, `demo/` |
| Docker/runtime layout | `docker/Dockerfile.prod`, deployment docs, and CI paths as applicable |
| RD status/scope | `agents/roadmap.md` when internal files are available |
| F finding resolved | Move it from Open to Done in `agents/findings.md` |
| Binding constraint or rejected/deferred rationale | `agents/knowledge.md` |
| PR execution status | Active PR spec and `agents/pr-specs/INDEX.md` |

Keep product claims internally consistent. Avoid absolute phrases such as “nothing ever writes until Save” when documented exceptions exist.

---

## 11. Repository Map

| Area | Primary paths |
|---|---|
| App routes and API routes | `src/app/` |
| App shell and navigation | `src/components/layout/` |
| Shared UI primitives | `src/components/ui/` |
| Feature modules | `src/features/` |
| Transport contract and implementations | `src/lib/actual/` |
| HTTP API wrapper helpers | `src/lib/api/` |
| HTTP compatibility proxy | `src/app/api/proxy/` |
| Direct-mode headers/assets/runtime | `src/proxy.ts`, `src/app/actual-api-assets/`, `src/lib/directMode.ts`, `src/lib/actual/browser/` |
| Entity staged store | `src/store/staged.ts` |
| Budget staged store | `src/store/budgetEdits.ts` |
| Connections and saved presets | `src/store/connection.ts`, `src/store/savedServers.ts` |
| Shared normalized types | `src/types/` |
| Query client | `src/lib/queryClient.ts` |
| Budget File Sync engine | `src/lib/sync/`, `src/features/sync/` |
| Actual Bench metadata DB | `src/lib/app-db/`, related `src/app/api/` routes |
| FX engine and registry | `src/lib/fx/`, `src/features/fx-rates/`, related API routes |
| Server startup scheduler | `src/instrumentation.ts`, `src/lib/sync/schedulerRuntime.ts` |
| Diagnostics / SQLite browser | `src/features/budget-diagnostics/` |
| End-user documentation site | `docs-site/` |
| Demo backend source | `demo/` |
| Docker | `docker/` |
| GitHub workflows | `.github/workflows/` |
| Internal agent framework | `agents/` when present |

---

## 12. Internal Planning Framework

The `agents/` folder is internal, gitignored working memory and may not exist in a public checkout. When it is present:

### Read only the live indexes for current status

- `agents/roadmap.md`: master new-feature list (`RD-###`).
- `agents/findings.md`: approved improvements to existing features (`F-###`).
- `agents/knowledge.md`: binding constraints, corrections, and rejected/deferred rationale.
- `agents/FRAMEWORK.md`: process and folder definitions.
- `agents/pr-specs/INDEX.md`: the only dispatch table for “what should be implemented next?”

Planning docs, review docs, and old RD specs provide context; do not treat their stale status text as authoritative.

### Execution workflow

For non-trivial work:

1. Confirm the RD/F item and active PR-spec.
2. Read the PR-spec's Why, Scope, Out of scope, Relevant files, Acceptance criteria, and Status.
3. Verify the listed files against the live repository.
4. Use one short-lived branch per shippable PR-spec.
5. Keep lettered milestone specs on the parent branch unless explicitly agreed otherwise.
6. When complete, update:
   - the PR-spec;
   - `pr-specs/INDEX.md`;
   - `roadmap.md` or `findings.md`;
   - `knowledge.md` when a new binding constraint was learned;
   - user documentation when behavior is visible.

Group items into one PR only when they share files or a tightly coupled feature area. Do not batch unrelated work merely because it has a similar theme.

### Numbering

- Never reuse an assigned number.
- Determine the next number from the current master/index file, not from a static note in another document.
- Record merged/superseded items instead of renumbering published history.

---

## 13. Git and Change Control

- Never work directly on `main`.
- PRs target `main`.
- Use short-lived branches with an approved prefix:
  - `feat/*`
  - `fix/*`
  - `refactor/*`
  - `docs/*`
- When following an internal PR-spec, prefer `<type>/pr-NNN-<slug>`.
- Keep changes focused; avoid unrelated formatting or cleanup.
- Do not amend, rebase, force-push, delete branches, or rewrite history without explicit approval.
- Never commit, push, open a PR, merge, or release automatically.
- First show the diff or summarize the exact pending changes, propose the commit/PR wording, and wait for explicit approval.
- When author identity is required for this repository, use GitHub user `x-rous` and author name `Manaf`.

Commit messages use plain English, imperative mood, and no trailing period, for example:

```text
fix: preserve staged accounts after a background refresh
feat: add category sync adapter
docs: explain direct-mode networking requirements
```

PR titles must be clear and user-facing because release drafting uses them as changelog entries.

---

## 14. Completion Standard

Before declaring work complete:

- The requested behavior is implemented without expanding scope.
- Both transports are handled or the unsupported capability is explicit and tested.
- The correct write model is preserved.
- No secret is persisted or logged.
- Amount units are explicit and tested.
- Existing staged changes cannot be silently overwritten.
- Sync changes preserve preview, idempotency, and review gates.
- Relevant tests pass.
- Required docs and internal master files are updated.
- The final handoff lists:
  - files changed;
  - behavior changed;
  - validation performed;
  - known limitations or follow-up work;
  - any command not run.

Do not hide uncertainty. Do not mark an RD/F/PR item complete unless its acceptance criteria and documentation updates are actually satisfied.