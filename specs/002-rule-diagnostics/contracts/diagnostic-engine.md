# Contract: Diagnostic Engine Internal API

**Feature**: `feat/002-rule-diagnostics`
**Date**: 2026-04-23
**Scope**: Internal — this feature exposes no HTTP contract. The engine is a client-side TypeScript module.

The "contract" below is the set of public function signatures that other parts of the feature (and potentially future tests or follow-ups) can rely on. Breaking changes to any signature below are visible breaking changes to the feature; additive changes are safe.

All types referenced (`WorkingSet`, `DiagnosticReport`, `Finding`, `CheckFn`, `CheckContext`, `RuleRef`, `Severity`, `FindingCode`) are defined in `src/features/rule-diagnostics/types.ts` and documented in `data-model.md`.

---

## 1. Engine entrypoint — `runDiagnostics`

**Module**: `src/features/rule-diagnostics/lib/runDiagnostics.ts`

```ts
/**
 * Run every v1 diagnostic check against the given working set.
 * Pure & deterministic: identical input → byte-identical output.
 * Yields to the event loop between checks to keep the UI responsive on large sets.
 */
export async function runDiagnostics(ws: WorkingSet): Promise<DiagnosticReport>;
```

**Inputs**:
- `ws: WorkingSet` — must already exclude staged-deleted rules/entities and include staged-new ones. Callers MUST NOT pass in the raw server snapshot; use `buildWorkingSetFromStagedStore` instead.

**Outputs**:
- A `DiagnosticReport` with `findings` sorted as described in `data-model.md §5`.

**Guarantees**:
- G1 — **Deterministic**: `runDiagnostics(ws)` called twice in a row with the same `ws` reference MUST return reports with identical `findings` arrays (JSON-equal, same order).
- G2 — **No mutation**: the function MUST NOT write to any Zustand store, TanStack Query cache, or upstream API. No DOM mutation beyond what the engine itself returns.
- G3 — **Schedule-linked rules are excluded from editor-relevant checks**: rules with any `link-schedule` action are still included in the working set but are NOT subjects of `RULE_EMPTY_ACTIONS`, `RULE_NOOP_ACTIONS`, `RULE_SHADOWED`, `RULE_BROAD_MATCH`, `RULE_DUPLICATE_GROUP`, `RULE_NEAR_DUPLICATE_PAIR`, or `RULE_UNSUPPORTED_*` findings. They ARE still evaluated for `RULE_MISSING_*` (a schedule-linked rule with a deleted payee is still broken).
- G4 — **Bounded execution**: the engine yields to the event loop between checks and (for large partitions) every ~500 iterations. Callers can rely on the UI remaining responsive during the call.
- G5 — **Non-throwing**: unexpected conditions (e.g. a rule referencing a field not in `CONDITION_FIELDS`) produce a `RULE_ANALYZER_SKIPPED` info-level finding for that rule rather than throwing.

**Performance budget**: See SC-002, SC-003. Measured against the 500-rule and 2000-rule fixtures documented in `quickstart.md`.

---

## 2. Working-set builder — `buildWorkingSet`

**Module**: `src/features/rule-diagnostics/hooks/useRuleDiagnostics.ts` (co-located utility)

```ts
/**
 * Construct a WorkingSet from the current staged-store snapshot.
 * Staged deletions are excluded. Staged updates are reflected in their new form.
 * Staged-new rows are included.
 */
export function buildWorkingSet(
  stagedRules: StagedMap<Rule>,
  entityMaps: EntityMaps
): WorkingSet;
```

**Inputs**: Snapshots of the relevant staged maps (`rules`, `payees`, `categories`, `accounts`, `categoryGroups`, `schedules`). Callers MUST pass store-read values, NOT the store instance — otherwise tests cannot inject fixtures.

**Output**: A `WorkingSet` whose `entityExists` sets are pre-computed for O(1) existence checks.

**Guarantees**:
- The output is a pure function of the inputs (important for the signature-based stale detection).

---

## 3. The `useRuleDiagnostics` hook

**Module**: `src/features/rule-diagnostics/hooks/useRuleDiagnostics.ts`

```ts
export type UseRuleDiagnosticsResult = {
  report: DiagnosticReport | null;
  running: boolean;
  error: string | null;
  stale: boolean;         // Working set has changed since the last completed run
  refresh: () => void;    // Trigger a fresh run against the current working set
};

export function useRuleDiagnostics(): UseRuleDiagnosticsResult;
```

**Behavior**:
- On mount, runs once against the current staged-store snapshot.
- Subscribes to the staged store with a shallow selector that reads only rules/entities maps; on any change, recomputes the working-set signature and updates `stale` — it does NOT re-run the engine automatically (Clarification 2).
- `refresh()` runs the engine again and resets `stale` to `false`.
- Error handling: engine errors are caught, stored in `error`, and the previous `report` is left visible.

**Guarantees**:
- The hook MUST NOT trigger any network calls. It MUST NOT modify the staged store.
- Unmounting the component during an in-flight run MUST NOT write state back after unmount (guarded by a local "cancelled" ref).

---

## 4. Check function contract — `CheckFn`

**Modules**: `src/features/rule-diagnostics/lib/checks/*.ts`

```ts
export type CheckFn = (ws: WorkingSet, ctx: CheckContext) => Finding[];
```

**Every check MUST**:
- Return an array of findings (possibly empty). Never `null`/`undefined`.
- Be a pure function of `(ws, ctx)` — no `Date.now()`, no `Math.random()`, no reads from global state.
- Emit at most one finding per affected rule, except: (a) `RULE_DUPLICATE_GROUP` emits one finding per duplicate group (not per member rule); (b) `RULE_ANALYZER_SKIPPED` raised for a partition cap MAY be emitted once per capped partition with an empty `affected` array.
- Use severity from the severity map in `data-model.md §2`. Severity is not the check's choice; it's fixed per code.
- Produce stable ordering: findings within one check's output MUST be sorted by `affected[0].id` to preserve determinism when concatenated with other checks.
- Use `findingMessages.ts` helpers for `title` / `message` / `details` so phrasing stays consistent across checks.

**Every check MUST NOT**:
- Throw. Unexpected inputs → emit `RULE_ANALYZER_SKIPPED` for the offending rule.
- Mutate `ws` or `ctx` or any value inside them.
- Call any async code (they run synchronously between the engine's `await setTimeout(0)` yield points).

---

## 5. Check registry

**Module**: `src/features/rule-diagnostics/lib/runDiagnostics.ts`

```ts
export const CHECKS: readonly CheckFn[];   // defined in ascending cost order (cheap → expensive)
```

Execution order (and therefore the order in which their findings are collected before the final sort):

1. `missingEntityReferences`                 — O(n × parts)
2. `emptyOrNoopActions`                       — O(n)
3. `unsupportedFieldOperator`                 — O(n × parts)
4. `impossibleConditions`                     — O(n × parts²) but parts per rule is tiny (typically ≤ 5)
5. `broadMatchCriteria`                       — O(n × parts)
6. `duplicateRules`                           — O(n) via signature grouping
7. `shadowDetection`                          — O(Σ partition² × parts²) — partition-limited
8. `nearDuplicateRules`                       — O(Σ partition²) — partition-limited, capped at `partition.length ≤ 300`

---

## 6. Finding message / title / details contract

**Module**: `src/features/rule-diagnostics/lib/findingMessages.ts`

```ts
export function buildFinding(
  code: FindingCode,
  affected: RuleRef[],
  args: Record<string, unknown>,
  counterpart?: RuleRef
): Finding;
```

`buildFinding` is the single-source-of-truth factory. Checks do not construct `Finding` objects directly; they always go through this helper. This guarantees:
- Severity comes from the severity map, never from the call site.
- `title` and `message` are deterministic functions of `(code, args)`.
- `details` are produced deterministically (e.g. always listing missing-entity IDs in sorted order).

---

## 7. Jump-to-rule URL contract

**Consumers**: `DiagnosticsTable.tsx` and `FindingRow.tsx`.

```
/rules?highlight=<ruleId>
```

- Matches the existing `useHighlight` hook's expected query param (`src/hooks/useHighlight.ts`).
- The rules page already scrolls to `[data-row-id="<ruleId>"]`, briefly highlights it, and clears the param. No change needed to the rules page to support diagnostics.
- If the rule no longer exists in the working set (staged-deleted while the user was on the diagnostics view), the user lands on `/rules` and sees a toast "rule no longer exists" — handled by a small addition guarded by the working-set signature check at jump time (see spec User Story 2 Acceptance Scenario 3).

---

## 8. Backward-compatibility & extensibility notes

- `FindingCode` is a string-literal union. Adding a new code is a non-breaking change. Removing or renaming one is breaking — callers (i.e. the UI filter-by-code dropdown) rely on the list.
- `CHECKS` order is NOT part of the contract; the final report order is determined by the engine's sort. Reordering checks (e.g. to parallelize or re-prioritize) is safe.
- Any new check added in v2 (heuristic overlap, merge suggestions, template/grouped-category suggestions) slots in behind this contract with no changes to consumers.
