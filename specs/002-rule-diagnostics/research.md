# Phase 0 Research: Rule Diagnostics / Linting

**Feature**: `feat/002-rule-diagnostics`
**Date**: 2026-04-23

The spec + clarifications leave no open `NEEDS CLARIFICATION` markers. The research items below are *technical* questions that must be answered before Phase 1 design can produce realistic contracts — driven by the user's instruction to "ensure the plan is realistic and covers the rule conditions, actions along with the operations for each entity as implemented in (/src/features/rules/*)". Each item records the decision, why it was chosen, and the alternatives considered.

---

## R1 — Source of truth for the rule model (fields, operators, value shapes)

**Decision**: Reuse the existing catalogs in `src/features/rules/utils/ruleFields.ts` verbatim. Do not redefine fields, operators, or field→operator validity tables inside the rule-diagnostics feature.

**Detail**:

- **Rule stages** (normalized form): `"pre"`, `"default"`, `"post"`. The API stores `default` as `""`; normalization already happens at the API boundary in `src/lib/api/rules.ts` (`stageFromApi`/`stageToApi`). Diagnostics works exclusively on the internal normalized form and never sees the empty-string variant.
- **Condition operator (`conditionsOp`)**: `"and"` | `"or"`.
- **Condition fields** (`CONDITION_FIELDS`): `payee` (id→payee), `account` (id→account), `category` (id→category), `category_group` (id→categoryGroup), `amount` (number), `notes` (string), `date` (date), `imported_payee` (string).
- **Action fields** (`ACTION_FIELDS`): `payee` (id→payee), `category` (id→category), `account` (id→account), `notes` (string, supports template), `cleared` (boolean), `payee_name` (string, supports template), `date` (date), `amount` (number), and `link-schedule` (string, system-generated).
- **Operator families**:
  - String ops: `is`, `isNot`, `contains`, `doesNotContain`, `oneOf`, `notOneOf`, `matches`.
  - ID ops: `is`, `isNot`, `oneOf`, `notOneOf`.
  - Account ops: ID ops plus `onBudget` / `offBudget` (no value).
  - Number ops: `is`, `isapprox`, `gt`, `gte`, `lt`, `lte`, `isbetween`.
  - Date ops: `is`, `isNot`, `isapprox`, `isAfter`, `isBefore`.
  - Action ops (`ACTION_OPS`): `set`, `prepend-notes`, `append-notes`, `delete-transaction` (no value). `link-schedule` is an implicit read-only action type; it is NOT user-creatable and must be treated as invisible to the user in every check.
- **Value shapes** (`ConditionOrAction.value` from `src/types/entities.ts`): `string | number | boolean | null | string[] | AmountRange | RecurConfig`. `isbetween` uses `AmountRange`; `date` carrying a `RecurConfig` marks a schedule-linked rule.

**Rationale**: The Rule Drawer, CSV importer, merge dialog, and this diagnostics feature must all agree on exactly the same "what is a valid field/op" table; any local copy would drift the moment the catalogs change. `ruleFields.ts` already exports the exact data a lint rule needs — `CONDITION_FIELDS`, `ACTION_FIELDS`, `getConditionOps()`, `ACTION_OPS` — and is covered by existing tests indirectly via the rule editor.

**Alternatives considered**:
- *Re-declare the catalog inside the diagnostics feature.* Rejected — duplicates ground truth and will silently drift when new ops/fields are added (exactly the surface area where drift would cause "unsupported combination" false negatives).
- *Generate catalogs from the API's OpenAPI document.* Rejected — no such contract is exposed by `actual-http-api` for rule internals; rule schema is effectively app-defined.

---

## R2 — Source of the rule and entity working set

**Decision**: Derive the working set directly from `useStagedStore` by reading the staged maps, filtering out entries with `isDeleted === true`, and reading `.entity`. Include staged-new rows (`isNew === true`). For entities, read the `payees`, `categories`, `accounts`, `categoryGroups`, and `schedules` staged maps the same way.

**Detail**:
- The staged store is the only store that correctly models "working set". Reading directly from TanStack Query would miss unsaved edits and would break the "lint what you are about to save" user intent already codified in FR-002.
- The Rules page uses `useStagedStore` identically (`RulesTable.tsx` lines 59-64). The existing `EntityMaps` shape used by `rulePreview` is:
  ```ts
  { payees: StagedMap<Payee>, categories: StagedMap<Category>, accounts: StagedMap<Account>, categoryGroups: StagedMap<CategoryGroup>, schedules?: StagedMap<Schedule> }
  ```
  Diagnostics reuses this shape unchanged.
- Entity "existence" for the missing-reference check is defined as: `entityMap[id] !== undefined && entityMap[id].isDeleted === false`.

**Rationale**: Matches the editing semantics the user already experiences. Also means the diagnostic view automatically reflects staged entity deletions (a rule referencing a staged-deleted payee is flagged immediately without waiting for save).

**Alternatives considered**:
- *Read from the TanStack Query cache directly.* Rejected — does not include staged edits.
- *Ask the user to save before running diagnostics.* Rejected — contradicts FR-002 and the spec's edge-case handling.

---

## R3 — How to identify findings and display them (Clarification 3)

**Decision**: Primary display identity of a rule in every finding is the existing `rulePreview(rule, entityMaps)` output (e.g. `If Imported Payee contains "amz" → set Payee → "Amazon"`). The internal UUID is carried on every finding and surfaced via hover tooltip and a copy-to-clipboard affordance.

**Detail**:
- `rulePreview()` already resolves entity IDs → names using the same entity maps, so findings stay readable when a user has renamed a payee or category.
- Wrap it in `findingRuleSummary(rule, entityMaps)` to add two trivial fallbacks the bare function does not handle gracefully for diagnostic use: (a) `(no conditions)` for catch-all rules, and (b) truncation to a bounded character length (e.g. 160 chars + ellipsis) so that pathological conditions don't blow up the table row layout.
- Rules carry a stable `id` (UUID) in the staged store — that's the hoverable / copyable identifier.

**Rationale**: Satisfies Clarification 3 without duplicating summary logic (Principle IV). Matches the Rules table's own display so the user's mental mapping between the diagnostics report and the Rules page is 1:1.

**Alternatives considered**:
- *Build a custom short summary in-feature.* Rejected — duplication, and would visibly diverge from the Rules table.
- *Show UUID as the primary identifier.* Rejected in Clarification 3.

---

## R4 — Canonical signatures for duplicate and near-duplicate detection

**Decision**: Adapt the existing `deduplicateParts()` + `partsKey()` approach from `src/features/rules/components/MergeRulesDialog.tsx` into a dedicated `ruleSignature.ts` module that computes three signatures per rule:

1. **Condition signature**: sorted array of `JSON.stringify({ field, op, value, options })` strings, joined with `"||"`.
2. **Action signature**: sorted array of the same per-action representation, joined with `"||"`.
3. **Full rule signature**: `${stage}|${conditionsOp}|${conditionSig}#${actionSig}`.

Duplicates: group rules by full rule signature. Every group of size ≥ 2 yields exactly one `RULE_DUPLICATE_GROUP` finding.

Near-duplicates: only evaluated within rules sharing the same `(stage, conditionsOp)` partition. Compare each pair's normalized condition array and action array using set-difference of the per-part signatures. Flag the pair as near-duplicate when `|conditionsSymDiff| + |actionsSymDiff| ∈ {1, 2}` AND the pair is NOT already a full duplicate.

**Detail / complexity**:
- Full-duplicate detection is a one-pass signature grouping — `O(n)` in the rule count, with stringification cost proportional to rule size.
- Near-duplicate detection is `O(k²)` within each `(stage, conditionsOp)` partition where `k` is the partition size. Against the 2000-rule SC-003 stress budget we'll cap near-duplicate evaluation per partition (e.g. skip partitions with `k > 300` and surface an info-level "too many similar rules to compare" notice instead). This keeps the whole run well under the 5 s budget. The cap threshold is tunable.
- Value normalization for signature equality:
  - `number` values for `amount` fields: round to 2 decimal places (the internal representation is already the display form — see `normalizeAmountParts` in `src/lib/api/rules.ts`).
  - Array values (`oneOf` / `notOneOf`): sort before stringification so `["a","b"]` and `["b","a"]` produce the same signature.
  - `null`/`undefined` values: both map to `null` in the signature.
  - `AmountRange`: keep as `{num1, num2}`; do NOT normalize to sorted min/max — `isbetween` is inclusive both ways semantically but the UI writes them ordered, so preserving order avoids false duplicates at practically zero cost.
  - `RecurConfig`: JSON-stringify the whole object; rules with identical recur configs will match, which is what the user expects.

**Rationale**: This is the same canonical form the merge dialog uses when deduplicating; matching it keeps diagnostics consistent with the behavior the user already sees during merge. Linear grouping is the only viable algorithm for the 2000-rule stress budget.

**Alternatives considered**:
- *Pairwise Levenshtein-style similarity across all conditions.* Rejected — O(n²) with heavy per-pair cost, violates SC-003.
- *Hash only by condition set, ignoring action differences.* Rejected — would merge visibly different rules that happen to share conditions; violates user expectation of "same rule".

---

## R5 — Strict-shadow detection (FR-008)

**Decision**: Within each stage partition (`pre`, `default`, `post`), evaluate rules in their stored order. A later rule `B` is flagged as strictly shadowed by an earlier rule `A` when all three hold:

1. **Same condition operator**: `A.conditionsOp === B.conditionsOp === "and"`. Shadow detection is only attempted on `and` rules in v1, because `or` shadowing requires reasoning about arbitrary disjunctions and is unsafe to treat as "strict" without false positives.
2. **Condition coverage**: Every condition in `A` has at least one matching condition in `B` that is semantically narrower or equal. A matching pair is "narrower or equal" if both target the same field and: (a) values are equal, or (b) A uses `contains "X"` and B uses `contains "Y"` with `Y` containing `X`, or (c) A uses `oneOf [a,b,c]` and B uses `oneOf` whose values ⊆ A's, or `is Y` with Y ∈ A's set. No cross-field implications (e.g. `amount > 10` ⊆ `amount > 5`) beyond exact same-op comparison are attempted in v1.
3. **Action override**: Every output field that `B` writes is already written by `A` with a value that is either identical to `B`'s write or is a `set` on the same field regardless of value. (Rationale: when `A` already runs `set category = X` on every transaction that would also match `B`, `B`'s `set category = Y` cannot take effect; Actual Budget's rule engine executes pre→default→post in order and later actions on the same field overwrite earlier ones within the same stage — this is a conservative rule-of-thumb that errs toward reporting only the clearest cases.)

**Detail**:
- If any of the three conditions is uncertain (e.g. a condition field is not recognized or a value shape is exotic), the shadow check skips the pair silently — it is an advisory warning, not a proof.
- Rules with `delete-transaction` actions are always considered "output-dominant": a rule with an unconditional `delete-transaction` in an earlier position shadows every later rule in the same stage whose conditions it covers.
- Schedule-generated rules (any action with op `link-schedule`) are excluded from both sides of shadow comparisons.

**Rationale**: Satisfies FR-008 while holding to the spec's "only strictly-shadowed rules are flagged in v1" assumption. Conservative by design — false positives on shadow detection are worse than misses because the user cannot easily verify the claim.

**Alternatives considered**:
- *Symbolic condition solving (SMT-style).* Rejected — massive over-engineering; out of scope for v1 per the spec assumptions.
- *Treat "shadowed" as any two rules where one's conditions are a subset of the other's.* Rejected — produces too many noisy "but the actions are different" false positives.

---

## R6 — Impossible-conditions detection (FR-007)

**Decision**: Within `and`-combined condition groups only, detect known-impossible pairs on a per-field basis:

- **Same field, two equality ops with different literal values** (`is` vs `is`, `is` vs `oneOf [set]` where `set` does not include the `is` value).
- **Mutually exclusive range bounds on `amount` or `date`**: e.g. `gt 10` + `lt 5`, `gte X` + `lte Y` where X > Y, `is 10` + `isbetween {num1: 20, num2: 30}`.
- **Contradictory string criteria**: `is "X"` + `isNot "X"`; `oneOf [A, B]` + `notOneOf` superset.
- **Account ops contradiction**: `onBudget` + `offBudget` simultaneously.

`or`-combined groups are not checked for impossibility in v1 — an `or` of contradictory conditions is still satisfiable by either branch.

**Rationale**: These are the only contradictions that can be detected in constant time per field-pair without building a constraint solver. The list is explicitly finite and each entry has a one-sentence explanation that can be produced mechanically (`findingMessages.ts`). Conservative; false positives here would be an `error` severity finding, which is the worst kind to get wrong.

**Alternatives considered**:
- *General constraint solver.* Rejected — out of scope; would delay v1 significantly.
- *Narrower: only the "same field, two different `is` values" case.* Rejected — misses the common `amount gt X` + `amount lt Y` contradiction users actually make.

---

## R7 — Broad-match detection threshold (FR-009)

**Decision**: Flag any condition where `op ∈ {contains, doesNotContain, matches}` AND the value is a string AND `value.trim().length ≤ 2` as `RULE_BROAD_MATCH` (warning). The threshold is a named constant (`BROAD_MATCH_MIN_LENGTH = 3`) in `findingMessages.ts` / `checks/broadMatchCriteria.ts` so it can be tuned without a spec change.

**Rationale**: Two-character-or-shorter `contains` values in the Rules page are overwhelmingly mistakes (common in imported-payee autofill typos). Three characters is the shortest realistic intended match (`"Uber"` etc., but the `"Ube"` partial is still plausible — we warn, not error). Covers the `matches` regex case too since short regexes like `.` or `.+` also match everything.

**Alternatives considered**:
- *Language-model heuristic.* Rejected — non-deterministic; violates FR-003.
- *Threshold of 1.* Rejected — misses the "contains \"a\"" pathological case cited in the spec's independent test for User Story 3.

---

## R8 — Unsupported field/operator combinations (FR-012)

**Decision**: For each condition, look up the field in `CONDITION_FIELDS` and fetch its allowed ops via `getConditionOps(field)`. If the field is missing or the op is not in the allowed op table, emit `RULE_UNSUPPORTED_CONDITION_OP`. For each action, look up the field in `ACTION_FIELDS` and check `ACTION_OPS` — emit `RULE_UNSUPPORTED_ACTION_OP` if the op isn't in `ACTION_OPS`, or `RULE_UNSUPPORTED_ACTION_FIELD` if the field isn't in `ACTION_FIELDS`. `link-schedule` actions are skipped (they live in `ACTION_FIELDS` but are never user-authored). Actions with `options.template !== undefined` where the field's `supportsTemplate !== true` are flagged as `RULE_TEMPLATE_ON_UNSUPPORTED_FIELD`.

**Rationale**: Uses the exact catalog the rule editor validates against (`ruleEditor.ts:validateActionPart` / `validateConditionPart`). By definition, anything the editor would reject for save is what the lint rule should flag on existing rules.

**Alternatives considered**:
- *Skip this check for v1.* Rejected — it's in the v1 scope list in the roadmap and is free given R1.
- *Run the existing `validateRuleDraft` on each rule.* Rejected — that validator is geared toward the editor's per-index error shape and requires mapping to the editor's `EditorPart[]` form; re-implementing the subset we need keeps the feature decoupled from editor internals.

---

## R9 — Staleness detection while the view is open (Clarification 2)

**Decision**: On view entry, the `useRuleDiagnostics` hook computes the current "working-set signature" (a lightweight hash: number of rules + concatenated `rule.id + isNew + isUpdated + isDeleted` for each rule) and saves it alongside the report. The hook subscribes to the staged store with Zustand's shallow selector comparing that signature — when it changes, a `stale: true` flag is exposed. The UI shows a visible "Results are out of date — Refresh" banner. The report itself is NOT recomputed until the user clicks Refresh or leaves and re-enters the route.

**Rationale**: Satisfies Clarification 2 (recompute on entry + manual refresh, never silently while the user is reviewing). The signature is cheap (O(rule count)) and is never the bottleneck. Using Zustand's existing subscription means no new polling loop.

**Alternatives considered**:
- *Debounced reactive recomputation.* Rejected in Clarification 2.
- *No stale indicator, rely on route navigation.* Rejected — users can undo/redo mid-view and would silently see wrong findings.

---

## R10 — Long-running protection for the 2000-rule stress case (FR-024, SC-003)

**Decision**: Run checks sequentially inside a single `async` engine function, awaiting `await new Promise(r => setTimeout(r, 0))` between checks and (for near-duplicate detection within large partitions) every ~500 iterations. This yields to the browser event loop, keeping input responsive under the "no UI block > 100 ms" constraint without introducing a Web Worker.

**Rationale**: A Web Worker is the cleanest solution for true parallelism, but: (a) crossing the worker boundary requires copying the working set (non-trivial given `StagedMap` internal references); (b) the current performance budget (~1 M stringifications for 2000 rules) is easily met on the main thread when broken into async chunks; (c) introduces no new build/Worker infrastructure. The budget-diagnostics feature uses a Web Worker for SQLite specifically because SQLite WASM is heavy and blocking; rule linting is not. If the budget is missed in practice, a worker migration is a straightforward follow-up.

**Alternatives considered**:
- *Always synchronous.* Rejected — violates SC-003 at the 2000-rule stress point.
- *Always in a Web Worker.* Rejected — overkill for the expected workload; adds build + type plumbing that would outweigh the benefit for v1.

---

## R11 — Testing strategy

**Decision**:
- **Unit tests per check**: `src/features/rule-diagnostics/lib/checks/*.test.ts` — one file per check; each file seeds a small working set (3-5 rules + referenced entities), runs just that check, and asserts on the exact findings produced. Seed helpers shared in a `tests/fixtures/rules.ts` under the feature folder.
- **Signature and shadow unit tests**: dedicated files for `ruleSignature.ts` and `shadowDetection.ts` covering the edge cases documented in R4/R5.
- **Engine integration test**: `runDiagnostics.test.ts` — asserts that the engine orders findings by severity, emits exactly one finding per rule per check, and produces deterministic byte-identical reports on repeated runs (SC-007).
- **Component test**: `RuleDiagnosticsView.test.tsx` — renders against a mocked `useRuleDiagnostics`, verifies empty state, loading state, stale-indicator, jump-to-rule link construction (`/rules?highlight=<id>`), and keyboard navigation on the filter bar.
- **No network / no Playwright**: matches existing project convention; `npm test` must stay under its current runtime.

**Rationale**: Mirrors the existing test layout in `src/features/**` (e.g. `budget-diagnostics/lib/diagnosticChecks.test.ts`, `rules/lib/ruleEditor.test.ts`). Deterministic + small-fixture style keeps each test ≤ 20 ms.

**Alternatives considered**:
- *Single mega-test seeding 2000 rules.* Rejected — flaky and slow; perf should be verified manually via quickstart.md, not in the unit suite.
- *Golden-file snapshots of findings.* Rejected — brittle against message wording changes.
