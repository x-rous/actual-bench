# Tasks: Rule Diagnostics / Linting

**Input**: Design documents from `/specs/002-rule-diagnostics/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/diagnostic-engine.md`, `quickstart.md`

**Tests**: Tests are REQUIRED by this project — `plan.md` mandates that `npm run lint`, `npx tsc --noEmit`, and `npm test` pass, and `research.md §R11` defines a per-check unit-test strategy. Test tasks are therefore included.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested as an independent slice. The five user stories in `spec.md` are:

- **US1 (P1)**: Surface high-confidence rule problems (missing entities, shadowed, empty actions) — MVP
- **US2 (P1)**: Jump from a finding to the offending rule
- **US3 (P2)**: Inspect broad / risky / impossible / unsupported-combination conditions
- **US4 (P2)**: Detect duplicate and near-duplicate rule groups
- **US5 (P3)**: Filter and organize findings

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on other incomplete tasks in the same phase)
- **[Story]**: Maps to a user story in `spec.md` (US1, US2, US3, US4, US5)
- Paths are repo-relative from `/home/coder/projects/actual-bench/`

## Path Conventions

- Feature code: `src/features/rule-diagnostics/{components,hooks,lib,utils}/`
- Route: `src/app/(app)/rules/diagnostics/page.tsx`
- Rules feature reuse: `src/features/rules/utils/ruleFields.ts`, `src/features/rules/utils/rulePreview.ts`
- Shared stores / types: `src/store/staged.ts`, `src/types/entities.ts`
- Tests colocated: `*.test.ts` / `*.test.tsx` next to the file under test

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the feature folder and its internal type surface so every subsequent task has a home.

- [X] T001 Create the `rule-diagnostics` feature folder tree per `plan.md` project structure: `src/features/rule-diagnostics/components/`, `src/features/rule-diagnostics/hooks/`, `src/features/rule-diagnostics/lib/`, `src/features/rule-diagnostics/lib/checks/`, `src/features/rule-diagnostics/utils/` (empty directories with a `.gitkeep` only where needed; real files land in later tasks).
- [X] T002 [P] Create `src/features/rule-diagnostics/types.ts` with the type definitions from `data-model.md`: `Severity`, `FindingCode` (string-literal union, all 17 codes), `RuleRef`, `Finding`, `DiagnosticReport`, `WorkingSet`, `CheckContext`, `CheckFn`. Re-export nothing from other features — only `Rule`, `ConditionOrAction`, etc., imported where needed.
- [X] T003 [P] Create `src/features/rule-diagnostics/lib/findingMessages.ts` with the severity map (`FINDING_SEVERITY: Record<FindingCode, Severity>`) exactly as specified in `data-model.md §2`. Leave `buildFinding()` unimplemented (stub throwing `not-implemented`) — it's fleshed out in T008.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: All engine plumbing, the view shell, and the entry point. No user story can be implemented until these are in place.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 [P] Implement `src/features/rule-diagnostics/utils/findingRuleSummary.ts` exporting `findingRuleSummary(rule: Rule, maps: EntityMaps): string`. Reuse `rulePreview` from `src/features/rules/utils/rulePreview.ts`; add fallback for `rule.conditions.length === 0 && rule.actions.length === 0` → `"(catch-all rule with no actions)"`; truncate result to 160 chars with a single trailing `…`. Reuse the `EntityMaps` type from `src/features/rules/utils/rulePreview.ts`.
- [X] T005 [P] Implement `src/features/rule-diagnostics/lib/ruleSignature.ts` with `partSignature(part)`, `conditionsSignature(rule)`, `actionsSignature(rule)`, `ruleSignature(rule)`, and `workingSetSignature(rules)`. Apply the value-normalization rules from `research.md §R4`: sort `string[]`, round `amount` numbers to 2 decimals, `null`/`undefined` → `null`, preserve `AmountRange` order, JSON-stringify `RecurConfig`. Do NOT depend on Zustand or React.
- [X] T006 [P] Implement `src/features/rule-diagnostics/lib/ruleSignature.test.ts` covering: (a) two rules with identical parts in different order produce identical signatures, (b) two rules differing only in order of `oneOf` values produce identical signatures, (c) `amount 10` vs `amount 10.00` produce identical signatures, (d) rules differing in stage or `conditionsOp` produce different signatures.
- [X] T007 Implement `buildWorkingSet(stagedRules, entityMaps)` in `src/features/rule-diagnostics/hooks/useRuleDiagnostics.ts` (co-located export). Filter out `isDeleted` rules, include `isNew`, pre-compute `entityExists` sets by filtering out `isDeleted` entities from each `StagedMap`. Pure function — no store reads inside.
- [X] T008 Complete `src/features/rule-diagnostics/lib/findingMessages.ts` — implement `buildFinding(code, affected, args, counterpart?)`. Switch on `code`, produce deterministic `title`, `message`, and `details` strings for every `FindingCode` in `data-model.md §2`. Severity comes from `FINDING_SEVERITY[code]`; callers never supply severity. Message wording must stand alone (FR-023) and include the rule summary context when useful (e.g. for `RULE_SHADOWED` mention the shadowing rule's `summary`).
- [X] T009 Implement `src/features/rule-diagnostics/lib/runDiagnostics.ts` engine shell: `async function runDiagnostics(ws: WorkingSet): Promise<DiagnosticReport>`. Build `CheckContext` (pre-compute `partSignatures`, `ruleSignatures`, `rulesByPartition`, `scheduleLinkedRuleIds`), iterate over an initially-empty exported `CHECKS: readonly CheckFn[]` array, `await new Promise(r => setTimeout(r, 0))` between checks, concatenate findings, sort by `(severity, code, affected[0].id)`, package `DiagnosticReport` with `runAt`, `summary`, `workingSetSignature`, `ruleCount`. This shell produces an empty report until checks are registered.
- [X] T010 Implement `useRuleDiagnostics()` in `src/features/rule-diagnostics/hooks/useRuleDiagnostics.ts`. Subscribe to `useStagedStore` with a shallow selector reading `rules`, `payees`, `categories`, `accounts`, `categoryGroups`, `schedules`. On mount, call `buildWorkingSet` and `runDiagnostics`. Expose `{ report, running, error, stale, refresh }` per the contract in `contracts/diagnostic-engine.md §3`. The `stale` flag compares `workingSetSignature(currentRules)` to `report.workingSetSignature`; the engine does NOT auto-rerun (Clarification 2). Guard against setState-after-unmount with a cancelled ref.
- [X] T011 [P] Create route file `src/app/(app)/rules/diagnostics/page.tsx`. Export `metadata: Metadata = { title: "Rule Diagnostics — Actual Bench" }`. Default export renders `<RuleDiagnosticsView />`. Match the existing pattern in `src/app/(app)/rules/page.tsx`.
- [X] T012 [P] Create skeleton `src/features/rule-diagnostics/components/RuleDiagnosticsView.tsx` that uses `PageLayout` (from `src/components/layout/PageLayout.tsx`) with title "Rule Diagnostics", calls `useRuleDiagnostics()`, renders: loading state while `running`, an error banner when `error`, the empty state `"No issues found"` when `report && report.summary.total === 0`, and a placeholder `"Findings coming soon"` panel otherwise. Also render a Refresh button (calls `refresh()`) and the stale banner when `stale === true`. No filter bar yet, no table yet.
- [X] T013 [P] Edit `src/features/rules/components/RulesView.tsx`: add an "Open Diagnostics" button to the `actions` prop of `PageLayout`, placed BEFORE the Import button. It's a `<Button variant="outline" size="sm">` wrapping a `<Link href="/rules/diagnostics">` with an appropriate Lucide icon (e.g. `Stethoscope`, same as `Sidebar.tsx` uses for Budget Diagnostics). `aria-label="Open rule diagnostics"`. Gating: `RulesView` only renders under the `(app)` route segment (auth-guarded by `AppShell`), so the button naturally appears only when a live connection is active — no additional disabled-state logic is required. Verify this assumption by reading `src/components/layout/AppShell.tsx`; if it does NOT hold, add `disabled + aria-disabled + title` fallback with the message "Connect to a budget to run diagnostics". No other behavior changes.

**Checkpoint**: Foundation ready — navigating to `/rules/diagnostics` renders an empty report shell, and the Rules page has an entry-point button. User story work can now begin in parallel.

---

## Phase 3: User Story 1 — Surface high-confidence rule problems at a glance (Priority: P1) 🎯 MVP

**Goal**: User sees a prioritized list of definitely-broken rules (missing entity references, shadowed, empty actions), grouped by severity, with plain-language explanations and a per-severity summary at the top.

**Independent Test**: Seed a working set containing (a) one rule referencing a deleted payee, (b) two rules where the second is strictly shadowed by the first, and (c) one rule with zero actions. Open `/rules/diagnostics`. Verify exactly those three findings appear — each with correct severity, correct rule summary, and a human-readable explanation — and the summary header shows `Errors: 1 · Warnings: 2 · Info: 0`.

### Tests for User Story 1

- [X] T014 [P] [US1] Write `src/features/rule-diagnostics/lib/checks/missingEntityReferences.test.ts`: seed 4 rules (referencing deleted payee, deleted category, deleted account, deleted category_group) plus one fully-valid rule and one schedule-linked rule with deleted payee; assert 5 findings (schedule-linked still flagged for missing entity), with correct `code` and `details` naming the missing entity.
- [X] T015 [P] [US1] Write `src/features/rule-diagnostics/lib/checks/emptyOrNoopActions.test.ts`: seed rules with (a) empty actions array, (b) single `link-schedule` action only (NOT flagged — schedule-linked exclusion), (c) valid non-empty actions; assert `RULE_EMPTY_ACTIONS` for (a), nothing for (b) or (c).
- [X] T016 [P] [US1] Write `src/features/rule-diagnostics/lib/shadowDetection.test.ts` covering the R5 algorithm: (a) strictly-shadowed pair in same stage → shadow; (b) same pair with different `conditionsOp` → not shadowed; (c) later rule writes a field the earlier doesn't → not shadowed; (d) `or`-combined rules → not flagged in v1; (e) unconditional `delete-transaction` earlier → shadows all later matching rules.
- [X] T017 [P] [US1] Write `src/features/rule-diagnostics/lib/checks/shadowedRules.test.ts`: integration-style test wiring shadowDetection into a check, asserting one `RULE_SHADOWED` finding names the correct `counterpart` rule.
- [X] T018 [P] [US1] Write `src/features/rule-diagnostics/lib/runDiagnostics.test.ts`: (a) running the engine twice against the same working set produces `JSON.stringify`-equal `findings` arrays (SC-007 determinism); (b) empty working set → `summary.total === 0`; (c) findings are sorted `error` → `warning` → `info`; (d) schedule-linked rules are still evaluated for `RULE_MISSING_*` but not `RULE_EMPTY_ACTIONS` (guarantee G3).
- [X] T019 [P] [US1] Write `src/features/rule-diagnostics/components/RuleDiagnosticsView.test.tsx`: render with a mocked `useRuleDiagnostics` returning (a) `running: true` → assert loading state; (b) `report: null, error: "boom"` → assert error banner; (c) a canned report with 1 error + 1 warning → assert summary card counts and that both findings render in severity order; (d) `stale: true` → assert stale banner visible.

### Implementation for User Story 1

- [X] T020 [P] [US1] Implement `src/features/rule-diagnostics/lib/checks/missingEntityReferences.ts`. Walk every rule's conditions and actions; for parts whose `field` maps via `CONDITION_FIELDS`/`ACTION_FIELDS` to `entity: "payee" | "category" | "account" | "categoryGroup"`, collect all referenced IDs (handling scalar vs `string[]`), and emit one `RULE_MISSING_<TYPE>` finding per rule per missing entity type. Use `ws.entityExists` sets for O(1) lookup. Include the ID and the field name in `details`. Applies to schedule-linked rules as well (guarantee G3).
- [X] T021 [P] [US1] Implement `src/features/rule-diagnostics/lib/checks/emptyOrNoopActions.ts`. Skip rules whose actions include a `link-schedule` op (schedule-generated). For the remainder, emit `RULE_EMPTY_ACTIONS` when `actions.length === 0`, or `RULE_NOOP_ACTIONS` when every action is a no-op per FR-006 — i.e. a `set` action with a missing `field`, OR a `prepend-notes`/`append-notes` action whose value is empty or whitespace-only. One finding per rule max.
- [X] T022 [US1] Implement `src/features/rule-diagnostics/lib/shadowDetection.ts` exporting `findShadowedPairs(rulesInStage: Rule[]): Array<{ shadowed: Rule; shadowing: Rule }>`. Implements the narrow algorithm in `research.md §R5`: only `and`-combined rules, strict condition coverage (equal/narrower same-op on same field per R5's (a)/(b)/(c)), and action-override dominance. Skip rules with `link-schedule` actions.
- [X] T023 [US1] Implement `src/features/rule-diagnostics/lib/checks/shadowedRules.ts`. Uses `ctx.rulesByPartition` to walk each `(stage, conditionsOp)` partition, calls `findShadowedPairs` for each, emits one `RULE_SHADOWED` finding per shadowed rule with `counterpart` set to the shadowing rule's `RuleRef`.
- [X] T024 [US1] Register US1 checks in `src/features/rule-diagnostics/lib/runDiagnostics.ts` `CHECKS` array in the order: `missingEntityReferences`, `emptyOrNoopActions`, `shadowedRules`. Do NOT remove other placeholder imports — later stories add to the same array.
- [X] T025 [P] [US1] Implement `src/features/rule-diagnostics/components/DiagnosticSummaryCards.tsx` rendering three Tailwind-styled cards for `summary.error`, `summary.warning`, `summary.info` with color-coded severity badges consistent with Budget Diagnostics' `DiagnosticsSummaryCards.tsx` style. Each card has an `aria-label` (e.g. "1 error finding"). Props: `{ summary: DiagnosticReport["summary"] }`.
- [X] T026 [US1] Implement `src/features/rule-diagnostics/components/FindingRow.tsx`. Props: `{ finding: Finding }`. Renders: severity badge (using existing `Badge` variants — `status-error` / `status-warning` / `status-inactive`), finding `title`, `message`, optional `details` bullet list, and a plain-text rule summary chip per `affected` entry (no link yet — that's US2). Each summary chip shows the truncated `summary`; on hover, a tooltip shows the full UUID; a copy-UUID button sits beside it (`aria-label="Copy rule ID"`). When `counterpart` is set, render it inline with a "shadowed by" / "near-duplicate of" prefix (label chosen by `code`).
- [X] T027 [US1] Implement `src/features/rule-diagnostics/components/DiagnosticsTable.tsx`. Props: `{ findings: Finding[] }`. Renders findings grouped by severity (errors first, then warnings, then info), with a small section header for each severity group. Uses `FindingRow` for each row. Virtualization NOT required for v1 — the sorted-flat list pattern used by `RulesTable` is sufficient up to the 2000-rule stress budget.
- [X] T028 [US1] Wire `DiagnosticSummaryCards` and `DiagnosticsTable` into `src/features/rule-diagnostics/components/RuleDiagnosticsView.tsx`. Replace the "Findings coming soon" placeholder with these two components, passing `report.summary` and `report.findings`. Keep the Refresh button, stale banner, loading/error/empty states intact.

**Checkpoint**: US1 is fully functional and testable. The user can navigate to `/rules/diagnostics`, see error / warning counts, and read a full list of broken-reference, empty-action, and shadowed-rule findings each with a plain-text rule summary. Jump-to-rule links don't work yet — that's US2.

---

## Phase 4: User Story 2 — Jump from a finding directly to the offending rule (Priority: P1)

**Goal**: Clicking the rule summary on any finding opens the rule in the Rules page editor, with no side effects.

**Independent Test**: From the diagnostics view, click any finding's rule summary. Verify the URL navigates to `/rules?highlight=<ruleId>`, the Rules page renders with that rule scrolled into view and temporarily highlighted via the existing `useHighlight` hook, and no mutation has been made to any rule. Also verify that if the rule has been staged-deleted since the report was generated, the user sees a toast message and does NOT navigate to a stale record.

### Tests for User Story 2

- [X] T029 [P] [US2] Update `src/features/rule-diagnostics/components/RuleDiagnosticsView.test.tsx` (or add a sibling `FindingRow.test.tsx`) to assert: (a) each rule summary renders as an `<a>` / `<Link>` with `href="/rules?highlight=<ruleId>"`; (b) the anchor has `aria-label` naming the rule (e.g. "Open rule …"); (c) clicking a finding whose rule has been removed from the mocked staged store triggers a toast and does not navigate.

### Implementation for User Story 2

- [X] T030 [US2] Update `src/features/rule-diagnostics/components/FindingRow.tsx`. Wrap each rule summary chip in a Next.js `<Link>` pointing to `/rules?highlight=<ruleRef.id>`. Add `aria-label="Open rule: <summary>"`. On click: read the current `useStagedStore.getState().rules` map; if `!rules[ruleRef.id] || rules[ruleRef.id].isDeleted`, `e.preventDefault()` and `toast.error("This rule no longer exists in the current working set.")`. Import `toast` from `sonner` as used elsewhere in the project. Keep keyboard operability — the Link is natively focusable.

**Checkpoint**: MVP complete after US1 + US2. The feature ships as described in `spec.md` Story 1 + Story 2. Deferring US3–US5 still produces a usable product increment.

---

## Phase 5: User Story 3 — Inspect broad and risky match criteria (Priority: P2)

**Goal**: Surface `warning`-level broad-match findings, `error`-level impossible-conditions findings, and `warning`-level unsupported field/operator combinations.

**Independent Test**: Seed rules with (a) `imported_payee contains "a"`, (b) `and`-combined `amount is 10` + `amount is 20`, (c) a rule with `field=amount, op=contains` (unsupported combo), and (d) a plausibly-correct rule. Open `/rules/diagnostics`. Verify findings for (a), (b), (c) only — with the codes `RULE_BROAD_MATCH`, `RULE_IMPOSSIBLE_CONDITIONS`, and `RULE_UNSUPPORTED_CONDITION_OP` respectively — and that (d) produces nothing.

### Tests for User Story 3

- [X] T031 [P] [US3] Write `src/features/rule-diagnostics/lib/checks/broadMatchCriteria.test.ts`. Cover: `contains "a"` (short → warning), `contains "Netflix"` (not flagged), `matches "."` (short regex → warning), whitespace-only values, `doesNotContain ""` (empty → warning). Verify the `BROAD_MATCH_MIN_LENGTH` constant is the threshold (exported for testing).
- [X] T032 [P] [US3] Write `src/features/rule-diagnostics/lib/checks/impossibleConditions.test.ts`. Cover: two `amount is X` with different X on an `and` rule, `amount gt 10` + `amount lt 5`, `is "X"` + `isNot "X"`, `onBudget` + `offBudget` on the account field, `or` rule with same patterns (NOT flagged — v1 scope). Also assert that a rule with 1 condition never flags impossible.
- [X] T033 [P] [US3] Write `src/features/rule-diagnostics/lib/checks/unsupportedFieldOperator.test.ts`. Cover: `field=amount, op=contains` → `RULE_UNSUPPORTED_CONDITION_OP`; `field=cleared, op=set, action field missing` → `RULE_UNSUPPORTED_ACTION_FIELD`; `field=category (id), template set` → `RULE_TEMPLATE_ON_UNSUPPORTED_FIELD`; `link-schedule` action → not flagged (exclusion).

### Implementation for User Story 3

- [X] T034 [P] [US3] Implement `src/features/rule-diagnostics/lib/checks/broadMatchCriteria.ts`. Export `BROAD_MATCH_MIN_LENGTH = 3`. Walk each rule's conditions; for parts whose `op ∈ {contains, doesNotContain, matches}` and `typeof value === "string"` and `value.trim().length < BROAD_MATCH_MIN_LENGTH`, emit `RULE_BROAD_MATCH` (one per offending part). Skip schedule-linked rules.
- [X] T035 [P] [US3] Implement `src/features/rule-diagnostics/lib/checks/impossibleConditions.ts`. Only evaluate `and`-combined rules. For each rule, group its conditions by field; for each field, apply the contradiction rules from `research.md §R6` (different equality literals, opposing ranges, string is/isNot, account onBudget/offBudget). Emit one `RULE_IMPOSSIBLE_CONDITIONS` per rule (not per contradiction) with `details` listing the conflicting condition summaries. Skip schedule-linked rules.
- [X] T036 [P] [US3] Implement `src/features/rule-diagnostics/lib/checks/unsupportedFieldOperator.ts`. Import `CONDITION_FIELDS`, `ACTION_FIELDS`, `getConditionOps`, `ACTION_OPS` from `src/features/rules/utils/ruleFields.ts`. For each condition: if `field` not in `CONDITION_FIELDS` → `RULE_UNSUPPORTED_CONDITION_FIELD`; else if `op` not in `getConditionOps(field)` → `RULE_UNSUPPORTED_CONDITION_OP`. For each action: skip `link-schedule`; if `op` not in `ACTION_OPS` → `RULE_UNSUPPORTED_ACTION_OP`; else if `op === "set"` and `field` not in `ACTION_FIELDS` → `RULE_UNSUPPORTED_ACTION_FIELD`; else if `options.template !== undefined` and `ACTION_FIELDS[field]?.supportsTemplate !== true` → `RULE_TEMPLATE_ON_UNSUPPORTED_FIELD`. One finding per offending part. Skip schedule-linked rules (checked via `ctx.scheduleLinkedRuleIds`).
- [X] T037 [US3] Register US3 checks in `src/features/rule-diagnostics/lib/runDiagnostics.ts` `CHECKS` array: insert after `emptyOrNoopActions` and before `shadowedRules` in the order `unsupportedFieldOperator`, `impossibleConditions`, `broadMatchCriteria`.

**Checkpoint**: US3 is functional. The user sees warnings for broad match and unsupported combinations, and errors for impossible conditions, on top of the US1/US2 findings.

---

## Phase 6: User Story 4 — Detect duplicate and near-duplicate rules (Priority: P2)

**Goal**: Group findings for rules that are structurally identical (warning) or almost identical (info), so the user can merge or delete redundant rules.

**Independent Test**: Seed 2 rules with identical conditions + identical actions, and a third rule with the same conditions plus one extra action. Open `/rules/diagnostics`. Verify one `RULE_DUPLICATE_GROUP` finding (warning) listing the first two rules as a cluster, and one `RULE_NEAR_DUPLICATE_PAIR` finding (info) for the second pair. Jump-to-rule works on each member.

### Tests for User Story 4

- [X] T038 [P] [US4] Write `src/features/rule-diagnostics/lib/checks/duplicateRules.test.ts`. Cover: (a) two identical rules → one group finding with 2 affected; (b) three identical rules → one group finding with 3 affected (NOT three findings); (c) rules with same conditions but different `conditionsOp` → NOT grouped; (d) rules whose `oneOf` values differ only in order → grouped (normalized); (e) schedule-linked rules → excluded from duplicate detection.
- [X] T039 [P] [US4] Write `src/features/rule-diagnostics/lib/checks/nearDuplicateRules.test.ts`. Cover: (a) pair differing by exactly one action → pair finding; (b) pair differing by two actions → pair finding; (c) pair differing by three actions → NOT flagged; (d) pair already flagged as full duplicates → NOT also flagged as near-duplicate; (e) a partition of 400 similar rules → pair evaluation is skipped with an info-level `RULE_ANALYZER_SKIPPED`-style notice per the partition cap in `research.md §R4`.

### Implementation for User Story 4

- [X] T040 [P] [US4] Implement `src/features/rule-diagnostics/lib/checks/duplicateRules.ts`. Use `ctx.ruleSignatures` to bucket rules by signature (skipping schedule-linked rules). For each bucket with `size ≥ 2`, emit one `RULE_DUPLICATE_GROUP` finding whose `affected` is every rule in the bucket, sorted by `id`.
- [X] T041 [US4] Implement `src/features/rule-diagnostics/lib/checks/nearDuplicateRules.ts`. For each `(stage, conditionsOp)` partition in `ctx.rulesByPartition` (skipping schedule-linked rules and excluding full-duplicate members), if partition size > 300, emit a single partition-level `RULE_ANALYZER_SKIPPED` info finding (no `affected`; use `details` to explain cap). Otherwise for each pair, compute symmetric-difference count over `partSignatures` for conditions and actions separately; if total diff ∈ {1, 2}, emit one `RULE_NEAR_DUPLICATE_PAIR` finding with both rules in `affected`. Sort emitted findings by the pair's lower-of-two `id`s.
- [X] T042 [US4] Register US4 checks in `src/features/rule-diagnostics/lib/runDiagnostics.ts` `CHECKS` array at the end: `duplicateRules`, then `nearDuplicateRules`. Confirm the final order matches `contracts/diagnostic-engine.md §5`.

**Checkpoint**: US4 is functional. Full and near-duplicate groups are visible, each member of a group is independently navigable via jump-to-rule.

---

## Phase 7: User Story 5 — Filter and organize findings (Priority: P3)

**Goal**: Let the user filter the displayed findings by severity and by finding code, and clear filters to restore the full report.

**Independent Test**: With a report containing ≥2 severities and ≥3 codes, toggle a severity filter and verify only that severity remains; toggle a code filter and verify only that code remains; clear filters and verify the full report is restored. Filter state resets when the user leaves the route.

### Tests for User Story 5

- [X] T043 [P] [US5] Extend `src/features/rule-diagnostics/components/RuleDiagnosticsView.test.tsx` with filter scenarios: (a) render view with 1 error, 2 warnings, 1 info; toggle warning filter off → only error and info remain; (b) filter by `RULE_DUPLICATE_GROUP` code → only that code's findings remain; (c) clear filters via the "Clear" button → full list returns; (d) summary card counts update to reflect visible-after-filter totals (clarifying which: the spec says "the summary reflects the filtered count" for severity filters — confirm this and implement accordingly).

### Implementation for User Story 5

- [X] T044 [P] [US5] Implement `src/features/rule-diagnostics/components/DiagnosticsFilterBar.tsx`. Props: `{ severityFilter: Set<Severity>; codeFilter: Set<FindingCode>; availableCodes: FindingCode[]; onSeverityToggle: (s: Severity) => void; onCodeChange: (codes: Set<FindingCode>) => void; onClear: () => void }`. Render three severity toggle buttons (using `PillGroup` from `src/components/ui/pill-group.tsx` for consistency with `src/features/rules/components/FilterBar.tsx`) and a multi-select dropdown of codes (built from the union of codes present in the current report). Include a "Clear filters" button visible only when at least one filter is active. Every control must have an `aria-label` and be keyboard-operable (constitutional requirement VI).
- [X] T045 [US5] Lift filter state into `src/features/rule-diagnostics/components/RuleDiagnosticsView.tsx` as `useState<Set<Severity>>(new Set())` and `useState<Set<FindingCode>>(new Set())`. Derive `visibleFindings` via a memoized filter: empty set = show all; non-empty = only findings whose severity/code are in the set. Pass `visibleFindings` to `DiagnosticsTable` and (per T043.d decision — yes, the summary reflects the filtered view) pass a derived `summary` (recompute counts from `visibleFindings`) to `DiagnosticSummaryCards`. Render `DiagnosticsFilterBar` above the summary cards.
- [X] T046 [US5] Confirm filter state is ephemeral — it lives only in the view's local React state and resets on route leave. Do NOT use `searchParams` or Zustand. Explicit non-persistence per the spec's out-of-scope list.

**Checkpoint**: All five user stories functional. The full spec is implemented.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Accessibility audit, performance verification, pre-commit gates, and documentation updates per `AGENTS.md`.

- [X] T047 [P] Accessibility pass — confirm every interactive control in the feature has `aria-label` (filter pills, code dropdown, Refresh button, summary cards, rule summary links, copy-UUID buttons, Clear Filters) and responds to keyboard (Tab / Shift+Tab / Enter / Space / Escape). Fix any gaps found. No new tests required beyond the existing component tests.
- [X] T048 Performance smoke test — follow `quickstart.md §5`. Seed 500 rules and confirm initial render < 2 s (SC-002); seed 2 000 rules and confirm initial render < 5 s (SC-003); DevTools Performance tab must show no long task > 100 ms during the run. If either budget is missed, investigate missing `await setTimeout(0)` yield points or a broken partition cap.
- [X] T049 Reproducibility smoke test — follow `quickstart.md §6`. Click Refresh twice on the same working set; verify the rendered findings list is visually identical (SC-007).
- [X] T050 Run `npm run lint` from repo root — must exit with 0 errors.
- [X] T051 Run `npx tsc --noEmit` from repo root — must exit with 0 errors.
- [X] T052 Run `npm test` from repo root — all suites pass.
- [X] T053 [P] Update `FEATURES.md` — add a "Rule Diagnostics" bullet under the Rules section describing the `/rules/diagnostics` workspace, severity-grouped findings, the full list of v1 checks, and the read-only/advisory nature. Remove from any "Not Yet Implemented" section if present.
- [X] T054 [P] Update `agents/future-roadmap.md` — change `RD-023 — Rule Diagnostics / Linting` status from `pending` to `complete`.
- [X] T055 [P] Update `README.md` — remove the "Rule diagnostics — detect conflicting, shadowed, or redundant rules across stages" line from the "Coming Soon" section, and add a short bullet about the feature in the main Features list with a link to `FEATURES.md`.
- [X] T056 End-to-end manual validation via `quickstart.md §1–§4`. Seed every fixture (A–I), verify all expected findings appear, the severity/code filters work, jump-to-rule works, the stale banner appears after an edit, and the "No issues found" empty state renders after fixing every rule.
- [X] T057 [P] Add an automated no-mutation regression test at `src/features/rule-diagnostics/no-mutation.test.tsx`. Render `<RuleDiagnosticsView />` with a canned mocked `useRuleDiagnostics` result containing at least one finding per severity. Spy on every mutator exposed by `useStagedStore` (`stageNew`, `stageUpdate`, `stageDelete`, `revertEntity`, `pushUndo`, `setSaveErrors`, `clearSaveError`, `discardAll`, `markClean`, `markSaved`, `stagePayeeMerge`, `clearPendingPayeeMerges`, `loadRules` and the other loaders). Drive the view through: initial render, toggling each severity and code filter, clicking Refresh, and invoking every finding's jump-to-rule link (with a mocked `next/navigation` router). Assert that zero mutator spies were called. This closes the automated-coverage gap for FR-016, SC-005, and Constitution Principle I (Staged-First Safety).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1. BLOCKS all user stories.
- **Phase 3 (US1)**: Depends on Phase 2. MVP.
- **Phase 4 (US2)**: Depends on Phase 3 (reuses `FindingRow` from T026) — but is a very small delta. US2 CANNOT ship before US1 in practice because there are no rows to link to.
- **Phase 5 (US3)**: Depends on Phase 2 only. Can proceed in parallel with US1/US2 after foundational is done.
- **Phase 6 (US4)**: Depends on Phase 2 only. Can proceed in parallel with US1/US3.
- **Phase 7 (US5)**: Depends on Phase 3 (reuses `RuleDiagnosticsView` shell) and Phase 2. Best sequenced after US1–US4 so there are real findings to filter, but technically can be built atop the empty shell.
- **Phase 8 (Polish)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2. MVP.
- **US2 (P1)**: Can start after T026 (`FindingRow`). Logically tied to US1 for deploy.
- **US3 (P2)**: Can start after Phase 2 — independent of US1/US2. A new check adds its findings to the existing pipeline.
- **US4 (P2)**: Can start after Phase 2 — independent.
- **US5 (P3)**: Best after US1/US2 so filters operate on real data; technically unblocked after Phase 2.

### Within Each User Story

- Tests must be written FIRST and must FAIL before the matching implementation task lands (per `plan.md` testing strategy).
- Checks (pure functions) before component wiring.
- Component subparts (summary cards, finding row) before the composing view (`RuleDiagnosticsView`).
- One check per file, one finding code family per check.

### Parallel Opportunities

- **Phase 1**: T002 and T003 can run in parallel after T001.
- **Phase 2**: T004, T005, T006, T011, T012, T013 can all run in parallel; T007–T010 are sequential (each depends on the previous).
- **Phase 3 (US1)**: All five test tasks (T014–T018) parallelize; then T020–T023 parallelize (check implementations); T025 parallelizes with them; T026 and T027 are sequential; T028 is last.
- **Phase 5 (US3)**: Tests T031–T033 and implementations T034–T036 all parallelize — three independent checks, three independent files.
- **Phase 6 (US4)**: Tests T038 + T039 parallelize; T040 parallelizes with T041 once the signature utility exists.
- **Phase 8**: T053, T054, T055, T047 can all run in parallel.

---

## Parallel Example: User Story 1

```bash
# Launch all US1 tests in parallel (they touch separate files):
Task: "Write src/features/rule-diagnostics/lib/checks/missingEntityReferences.test.ts"
Task: "Write src/features/rule-diagnostics/lib/checks/emptyOrNoopActions.test.ts"
Task: "Write src/features/rule-diagnostics/lib/shadowDetection.test.ts"
Task: "Write src/features/rule-diagnostics/lib/checks/shadowedRules.test.ts"
Task: "Write src/features/rule-diagnostics/lib/runDiagnostics.test.ts"
Task: "Write src/features/rule-diagnostics/components/RuleDiagnosticsView.test.tsx"

# Then launch the three US1 check implementations in parallel:
Task: "Implement src/features/rule-diagnostics/lib/checks/missingEntityReferences.ts"
Task: "Implement src/features/rule-diagnostics/lib/checks/emptyOrNoopActions.ts"
Task: "Implement src/features/rule-diagnostics/lib/shadowDetection.ts"

# Summary cards can be built in parallel with checks:
Task: "Implement src/features/rule-diagnostics/components/DiagnosticSummaryCards.tsx"
```

---

## Implementation Strategy

### MVP First (US1 + US2 only)

1. Complete Phase 1 (Setup — T001–T003).
2. Complete Phase 2 (Foundational — T004–T013). **CRITICAL** — blocks everything.
3. Complete Phase 3 (US1 — T014–T028).
4. Complete Phase 4 (US2 — T029–T030).
5. **STOP and VALIDATE**: walk the MVP path in `quickstart.md §2 and §4` — user sees findings for missing entities, empty actions, shadowed rules, and can jump to each rule. No mutations.
6. Deploy or demo if ready.

### Incremental Delivery

- Setup + Foundational → foundation ready.
- Add US1 + US2 → MVP ships. User sees the high-confidence problems and can act on them.
- Add US3 → broader lint coverage (broad match, impossible, unsupported combos).
- Add US4 → duplicate / near-duplicate grouping.
- Add US5 → filtering.
- Polish & ship final: accessibility audit, perf verification, docs updates.

Each increment is a complete, shippable slice — `npm run lint`, `npx tsc --noEmit`, and `npm test` MUST pass at every phase boundary.

### Parallel Team Strategy

With multiple contributors after Phase 2:

- Developer A: US1 (P1 MVP) + US2 (P1 wiring).
- Developer B: US3 (P2 — independent checks).
- Developer C: US4 (P2 — independent checks).
- Developer D: US5 (P3 — view-only work; depends on US1 shell landing first).

All four streams integrate cleanly because the `runDiagnostics` engine is additive via `CHECKS` and the view composes around `useRuleDiagnostics`.

---

## Notes

- **[P]** tasks touch different files and can run in parallel within their phase.
- **[Story]** label traces every task back to a specific user story in `spec.md`; Setup, Foundational, and Polish tasks are intentionally unlabelled.
- Every check is a pure function of `(WorkingSet, CheckContext)` — no store reads inside, no timestamps, no randomness (SC-007).
- Schedule-linked rules (those with any `link-schedule` action) are excluded from every editor-relevant check; only `RULE_MISSING_*` applies to them (guarantee G3 in `contracts/diagnostic-engine.md`).
- The `useHighlight` mechanism on the Rules page is untouched — we produce `/rules?highlight=<id>` links and the existing hook handles scroll + highlight.
- No new Zustand store. No new API endpoints. No proxy changes.
- Do NOT commit after each task automatically — per standing user feedback, commits require explicit approval.
