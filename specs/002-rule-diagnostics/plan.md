# Implementation Plan: Rule Diagnostics / Linting

**Branch**: `feat/002-rule-diagnostics` | **Date**: 2026-04-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-rule-diagnostics/spec.md`

## Summary

Ship a purely client-side, advisory Rule Diagnostics workspace at `/rules/diagnostics` that lints the user's current rule working set (server snapshot + unsaved staged edits) and surfaces a severity-grouped, explainable list of findings covering broken entity references, impossible/contradictory conditions, strictly shadowed rules, empty/no-op action lists, broad-match criteria, unsupported field/operator combinations, and duplicate / near-duplicate rule groups. The feature runs on entry to the route and on manual Refresh — never reactively while the user is on the view — and never mutates rules. It reuses the existing staged store, `rulePreview`, and `CONDITION_FIELDS`/`ACTION_FIELDS` field/operator catalogs as the ground truth for "what a valid rule looks like" so the lint rules track the same model the Rule Drawer already edits against.

## Technical Context

**Language/Version**: TypeScript 5 / Node 20
**Primary Dependencies**: Next.js 16 (Turbopack, app router), React 19, Zustand 5 (existing `staged.ts` store), TanStack Query 5 (existing `useRules` hook), Tailwind 4 (via `globals.css` `@theme`), shadcn/ui primitives already in `src/components/ui/`
**Storage**: None — analysis runs entirely in-memory against the staged store and TanStack Query cache that are already loaded for the Rules page. No new API endpoints, no persistence.
**Testing**: Jest (unit tests for each lint rule + the orchestrator + canonical-signature utility) and React Testing Library for the view, matching existing `src/features/**/*.test.ts(x)` conventions. `npm run lint`, `npx tsc --noEmit`, and `npm test` must all pass.
**Target Platform**: Web browsers (same targets as the rest of the product — modern evergreen desktop browsers).
**Project Type**: Web application (Next.js app router, `src/app/(app)/...` route segment).
**Performance Goals**: Initial report for 500 rules in <2 s; 2000-rule stress set in <5 s; no synchronous task longer than 100 ms (yield to the event loop between checks). Duplicate grouping must be O(n) via canonical-signature hashing — no naive O(n²) pairwise comparison across the whole rule set.
**Constraints**: Staged-first safety (FR-016: no writes, no stages, no mutations); no new backend endpoints (FR-017); client-side only over already-loaded data; schedule-generated rules (`link-schedule` action) must be excluded from lint checks that would implicitly suggest editing them; the "stage" field normalization (`""` ↔ `"default"`) is already handled at the API boundary in `src/lib/api/rules.ts` — diagnostics operates on the normalized `"default"` form.
**Scale/Scope**: ~10-15 new files under `src/features/rule-diagnostics/`, one new route file at `src/app/(app)/rules/diagnostics/page.tsx`, a small entry-point edit to `RulesView.tsx`, and docs updates in `FEATURES.md`, `agents/future-roadmap.md`, and `README.md`. Expected diff: ~1 000–1 500 LOC of implementation plus tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Staged-First Safety | PASS | Diagnostics is strictly read-only. FR-016 and SC-005 explicitly forbid any mutation side effect. Jump-to-rule navigates to the existing Rules page editor without pre-staging anything. |
| II. Controlled Connection Integrity | PASS | No new network calls. All data comes from `useStagedStore` and the existing `useRules`/`usePreloadEntities` query caches. The proxy is untouched. |
| III. Workbench Scope Before Product Drift | PASS | A lint/audit tool for a power-user rule set is a textbook workbench capability — diagnostic analysis over already-loaded admin data. It reinforces the workbench positioning already established by Budget Diagnostics and the Rules page. |
| IV. Brownfield Evolution Over Reinvention | PASS | Reuses `rulePreview()` for finding display summaries (satisfies Clarification 3 without duplicating summary logic), `CONDITION_FIELDS`/`ACTION_FIELDS`/`getConditionOps()` as the operator catalog, `deduplicateParts()`-style canonical hashing for duplicate detection, the staged-store working-set pattern, `PageLayout`, and the `?highlight=<id>` + `useHighlight` mechanism already used for cross-view rule navigation. No new stores; `budgetEdits.ts`-style parallel store is explicitly NOT introduced because diagnostics stages nothing. |
| V. Clear Boundaries and Consistent Domain Modeling | PASS | Analysis operates on the internal normalized `Rule` / `ConditionOrAction` types from `src/types/entities.ts`. No upstream API types leak in. New types (`Finding`, `DiagnosticReport`, check-function signatures) are scoped to the feature folder's `types.ts`. |
| VI. User Clarity, Reviewability, and Trust | PASS | FR-023 requires plain-language explanations per finding; Clarification 3 locks finding identity to the human-readable rule summary, not raw UUIDs. Interactive controls (severity filter, code filter, Refresh, jump-to-rule, copy-ID) will carry `aria-label`s and be keyboard-operable — constitutionally required for dense admin workflows. `FEATURES.md` and `README.md` coming-soon entry will be updated on ship. |

No exceptions required. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/002-rule-diagnostics/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output — how to manually verify the feature
├── contracts/
│   └── diagnostic-engine.md   # Internal function + data contracts (no external HTTP contracts)
├── checklists/
│   └── requirements.md  # From /speckit.specify
└── spec.md              # From /speckit.specify + /speckit.clarify
```

### Source Code (repository root)

```text
src/
├── app/
│   └── (app)/
│       └── rules/
│           ├── page.tsx                      # Existing — unchanged
│           └── diagnostics/
│               └── page.tsx                  # NEW — route shell: <RuleDiagnosticsView />
├── features/
│   ├── rules/
│   │   └── components/
│   │       └── RulesView.tsx                 # EDIT — add "Open Diagnostics" toolbar button linking to /rules/diagnostics
│   └── rule-diagnostics/                     # NEW feature folder (mandatory baseline structure from AGENTS.md)
│       ├── components/
│       │   ├── RuleDiagnosticsView.tsx       # Page shell: summary cards, filter bar, table, stale indicator, refresh button
│       │   ├── DiagnosticSummaryCards.tsx    # error / warning / info count cards at the top
│       │   ├── DiagnosticsTable.tsx          # Grouped-by-severity table of findings with jump-to-rule
│       │   ├── FindingRow.tsx                # A single finding row — severity badge, title, message, rule summary chip(s)
│       │   └── DiagnosticsFilterBar.tsx      # Severity + code filters; clears-all affordance
│       ├── hooks/
│       │   └── useRuleDiagnostics.ts         # Builds working set from staged store, runs the engine, exposes report + stale flag + refresh()
│       ├── lib/
│       │   ├── runDiagnostics.ts             # Engine: takes a typed WorkingSet, returns DiagnosticReport; orchestrates all checks
│       │   ├── ruleSignature.ts              # Canonical signatures for rules (for duplicate / near-duplicate detection)
│       │   ├── shadowDetection.ts            # Strict-shadow analysis within the same stage
│       │   ├── findingMessages.ts            # Pure functions that compose plain-language messages per code
│       │   └── checks/
│       │       ├── missingEntityReferences.ts
│       │       ├── emptyOrNoopActions.ts
│       │       ├── impossibleConditions.ts
│       │       ├── broadMatchCriteria.ts
│       │       ├── unsupportedFieldOperator.ts
│       │       ├── duplicateRules.ts
│       │       └── nearDuplicateRules.ts
│       ├── utils/
│       │   └── findingRuleSummary.ts         # Wraps existing rulePreview() and adds fallback for rules with 0 conditions/actions
│       └── types.ts                          # Finding, DiagnosticReport, Severity, FindingCode, WorkingSet, CheckFn
└── components/
    └── layout/
        └── Sidebar.tsx                       # UNCHANGED for v1 — entry point stays on the Rules page per roadmap optionality note

tests/ (colocated with source, matching existing convention)
├── src/features/rule-diagnostics/lib/runDiagnostics.test.ts
├── src/features/rule-diagnostics/lib/ruleSignature.test.ts
├── src/features/rule-diagnostics/lib/shadowDetection.test.ts
├── src/features/rule-diagnostics/lib/checks/*.test.ts   # One test file per check
└── src/features/rule-diagnostics/components/RuleDiagnosticsView.test.tsx
```

**Structure Decision**: Single-project Next.js web app, feature-folder layout under `src/features/rule-diagnostics/` matching the mandatory baseline in `AGENTS.md`. One new route segment (`/rules/diagnostics`) is the only routing change. No new Zustand store is introduced — the feature is read-only over the existing staged store (constitution principle I). No sidebar item for v1 to keep scope proportional; entry is from the Rules page toolbar (FR-001). A sidebar item is a planned v2 follow-up if usage warrants.

## Complexity Tracking

> No constitutional violations to justify. This section is intentionally empty.
