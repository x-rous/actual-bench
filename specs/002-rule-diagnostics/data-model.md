# Phase 1 Data Model: Rule Diagnostics / Linting

**Feature**: `feat/002-rule-diagnostics`
**Date**: 2026-04-23

All types below are internal to the feature and live in `src/features/rule-diagnostics/types.ts`. They are not exposed over HTTP — there is no network contract for this feature (see `contracts/diagnostic-engine.md` for the internal function contract).

The existing entity types from `src/types/entities.ts` — `Rule`, `ConditionOrAction`, `Payee`, `Category`, `Account`, `CategoryGroup`, `Schedule`, `RuleStage`, `ConditionsOp`, `AmountRange`, `RecurConfig` — are reused unchanged. The existing `StagedMap<T>` and `StagedEntity<T>` types from `src/types/staged.ts` are also reused.

---

## 1. `Severity`

```ts
export type Severity = "error" | "warning" | "info";
```

- Total ordering for display: `error` < `warning` < `info` (errors first).
- Matches the severity enum already used in `src/features/budget-diagnostics/types.ts` for shape consistency, but the two enums are intentionally separate types to avoid cross-feature coupling.

---

## 2. `FindingCode`

```ts
export type FindingCode =
  | "RULE_MISSING_PAYEE"
  | "RULE_MISSING_CATEGORY"
  | "RULE_MISSING_ACCOUNT"
  | "RULE_MISSING_CATEGORY_GROUP"
  | "RULE_EMPTY_ACTIONS"
  | "RULE_NOOP_ACTIONS"
  | "RULE_IMPOSSIBLE_CONDITIONS"
  | "RULE_SHADOWED"
  | "RULE_BROAD_MATCH"
  | "RULE_DUPLICATE_GROUP"
  | "RULE_NEAR_DUPLICATE_PAIR"
  | "RULE_UNSUPPORTED_CONDITION_OP"
  | "RULE_UNSUPPORTED_CONDITION_FIELD"
  | "RULE_UNSUPPORTED_ACTION_OP"
  | "RULE_UNSUPPORTED_ACTION_FIELD"
  | "RULE_TEMPLATE_ON_UNSUPPORTED_FIELD"
  | "RULE_ANALYZER_SKIPPED";
```

- String-literal union (not string enum) so serialized findings are just strings — reproducible across runs (SC-007).
- `RULE_ANALYZER_SKIPPED` is the catch-all code the engine emits when a rule cannot be fully analyzed (referenced unknown field, exotic value shape) — see FR-023 edge cases.

**Severity map** (enforced in `findingMessages.ts`):

| Code                                    | Severity  |
|-----------------------------------------|-----------|
| `RULE_MISSING_PAYEE`                    | `error`   |
| `RULE_MISSING_CATEGORY`                 | `error`   |
| `RULE_MISSING_ACCOUNT`                  | `error`   |
| `RULE_MISSING_CATEGORY_GROUP`           | `error`   |
| `RULE_IMPOSSIBLE_CONDITIONS`            | `error`   |
| `RULE_EMPTY_ACTIONS`                    | `warning` |
| `RULE_NOOP_ACTIONS`                     | `warning` |
| `RULE_SHADOWED`                         | `warning` |
| `RULE_BROAD_MATCH`                      | `warning` |
| `RULE_DUPLICATE_GROUP`                  | `warning` |
| `RULE_UNSUPPORTED_CONDITION_OP`         | `warning` |
| `RULE_UNSUPPORTED_CONDITION_FIELD`      | `warning` |
| `RULE_UNSUPPORTED_ACTION_OP`            | `warning` |
| `RULE_UNSUPPORTED_ACTION_FIELD`         | `warning` |
| `RULE_TEMPLATE_ON_UNSUPPORTED_FIELD`    | `warning` |
| `RULE_NEAR_DUPLICATE_PAIR`              | `info`    |
| `RULE_ANALYZER_SKIPPED`                 | `info`    |

---

## 3. `RuleRef`

```ts
export type RuleRef = {
  /** Internal rule UUID — used for copy-to-clipboard and jump-to-rule navigation. */
  id: string;
  /** Generated short display summary (stage + first condition + first action, with entity IDs resolved to names). */
  summary: string;
};
```

- Produced by `findingRuleSummary(rule, entityMaps)` which wraps `rulePreview()` from `src/features/rules/utils/rulePreview.ts` and truncates to 160 characters with an ellipsis.
- Every finding must carry at least one `RuleRef`; group findings carry ≥ 2.

---

## 4. `Finding`

```ts
export type Finding = {
  /** Stable machine-readable code — reproducible across runs. */
  code: FindingCode;
  severity: Severity;
  /** Short finding title for the table row (e.g. "Rule references a deleted payee"). */
  title: string;
  /** Plain-language explanation, stands on its own without the rule context (FR-023). */
  message: string;
  /** Optional supporting detail bullets (e.g. which specific field was missing). */
  details?: string[];
  /** Primary affected rules (always ≥ 1, except for partition-cap `RULE_ANALYZER_SKIPPED` findings which MAY be empty). For group findings, every rule in the group. */
  affected: RuleRef[];
  /** For shadow findings: the rule that does the shadowing. For near-duplicate findings: the paired rule. */
  counterpart?: RuleRef;
};
```

- `affected` is an ordered array. For single-rule findings (`RULE_MISSING_*`, `RULE_BROAD_MATCH`, `RULE_SHADOWED`, `RULE_EMPTY_ACTIONS`, etc.) it has exactly one entry. For `RULE_DUPLICATE_GROUP` it holds every rule in the duplicate cluster. For `RULE_NEAR_DUPLICATE_PAIR` it holds both rules of the pair and `counterpart` is left empty. For partition-cap `RULE_ANALYZER_SKIPPED` findings (emitted when a `(stage, conditionsOp)` partition exceeds the near-duplicate evaluation cap), `affected` MAY be empty — the finding describes a class of rules, not a specific rule.
- Findings are equality-comparable by `(code, affected.map(r => r.id).sort().join(","))` for deduplication and for the SC-007 reproducibility check.

---

## 5. `DiagnosticReport`

```ts
export type DiagnosticReport = {
  /** ISO-8601 timestamp of when the report was produced. */
  runAt: string;
  /** Findings, stable-sorted: by severity (error → warning → info), then by code alphabetically, then by first affected rule ID. */
  findings: Finding[];
  /** Summary counts for the DiagnosticSummaryCards component. */
  summary: {
    error: number;
    warning: number;
    info: number;
    total: number;
  };
  /** Working-set signature at the time of the run — used to compute the stale flag. */
  workingSetSignature: string;
  /** Count of rules evaluated (staged deletions excluded, staged-new rules included). */
  ruleCount: number;
};
```

- `runAt` is informational (visible on the page footer). The signature, not the timestamp, is what drives the stale indicator.
- The stable sort MUST be deterministic so that two runs against the same working set produce byte-identical findings arrays (SC-007). The `ruleSignature` module provides the comparator.

---

## 6. `WorkingSet`

```ts
export type WorkingSet = {
  /** Rules evaluated: staged deletions excluded, staged updates in their new form, staged-new rules included. */
  rules: Rule[];
  /** Entity catalogs at the time of the run — for resolution (summary) and for existence checks (missing-entity findings). */
  entityMaps: EntityMaps;
  /**
   * A subset view useful for the engine: entities keyed by id returning `true` if present in the working set.
   * Derived from entityMaps by filtering out isDeleted entries. Precomputed for O(1) lookup.
   */
  entityExists: {
    payees: Set<string>;
    categories: Set<string>;
    accounts: Set<string>;
    categoryGroups: Set<string>;
  };
};
```

- `EntityMaps` is the existing type from `src/features/rules/utils/rulePreview.ts`:
  ```ts
  type EntityMaps = {
    payees: StagedMap<Payee>;
    categories: StagedMap<Category>;
    accounts: StagedMap<Account>;
    categoryGroups: StagedMap<CategoryGroup>;
    schedules?: StagedMap<Schedule>;
  };
  ```
  Schedules are optional in `EntityMaps` but always included in the WorkingSet so `findingRuleSummary` can resolve `link-schedule` names if ever needed for a reported rule.
- Rules with any `link-schedule` action are carried in `WorkingSet.rules` but most checks skip them (each check documents its own inclusion rule).

---

## 7. `CheckFn`

```ts
export type CheckFn = (ws: WorkingSet, ctx: CheckContext) => Finding[];

export type CheckContext = {
  /** Pre-computed condition-part signatures for every rule, keyed by ruleId → part index. */
  partSignatures: Map<string, string[]>;
  /** Pre-computed full rule signatures, keyed by ruleId. */
  ruleSignatures: Map<string, string>;
  /** Rules grouped by (stage, conditionsOp) for partitioned checks (shadow, near-duplicate). */
  rulesByPartition: Map<string, Rule[]>;
  /** Convenience flag: rules whose actions include a link-schedule op — these are excluded from many checks. */
  scheduleLinkedRuleIds: Set<string>;
};
```

- Each check is a pure function: same `(ws, ctx)` in → same `Finding[]` out. Non-determinism (timestamps, randomness) is forbidden inside checks (SC-007).
- `ctx` is built once in `runDiagnostics.ts` and passed to every check — this amortizes the O(n) signature cost across all checks so they can focus on their specific logic.

---

## 8. `RuleSignature` (internal to `ruleSignature.ts`)

Not exported as a type — represented as plain `string`. Three canonical-form strings are produced per rule:

```ts
function partSignature(part: ConditionOrAction): string;       // stable JSON of {field, op, normalizedValue, options}
function conditionsSignature(rule: Rule): string;              // sorted partSignatures joined by "||"
function actionsSignature(rule: Rule): string;                 // sorted partSignatures joined by "||"
function ruleSignature(rule: Rule): string;                    // `${stage}|${conditionsOp}#${conditionsSig}>>${actionsSig}`
```

Value normalization rules (from R4 in research.md):
- `number` on `amount` field → rounded to 2 decimal places.
- `string[]` → sorted before stringify.
- `null` and `undefined` → `null`.
- `AmountRange { num1, num2 }` → preserved in source order.
- `RecurConfig` → JSON-stringified whole object.
- Other `string` / `number` / `boolean` → native JSON.

---

## 9. View state (ephemeral, in-component)

Local React state on `RuleDiagnosticsView`:

```ts
type ViewState = {
  report: DiagnosticReport | null;      // null while loading / running
  running: boolean;
  error: string | null;                 // engine error (caught and surfaced non-fatally)
  stale: boolean;                       // true if working set signature has changed since report.workingSetSignature
  severityFilter: Set<Severity>;        // empty set == no filter; otherwise only these severities visible
  codeFilter: Set<FindingCode>;         // same semantics
};
```

- Lives in local React state only (ephemeral UI per AGENTS.md state-ownership table).
- Filter state resets on route leave — explicit non-persistence decision per the spec's out-of-scope list (filter persistence is not a v1 requirement).

---

## 10. Validation & lifecycle

- **Construction**: `runDiagnostics(ws)` is called once per "Refresh" or per route entry. It builds `CheckContext`, runs each check in order (cheap checks first so errors surface quickly), concatenates their findings, sorts them, and packages a `DiagnosticReport`.
- **No lifecycle transitions on findings**: findings are ephemeral per run. There is no "ignore", "snooze", or "acknowledge" state in v1 (explicitly out of scope in the spec's Assumptions).
- **Idempotency**: running `runDiagnostics(ws)` N times against the same `ws` must return reports with identical `findings` arrays (same order, same contents) — enforced by the sort comparator and by each check being a pure function.

---

## 11. Relationships to existing types

| New type              | Depends on existing                                    | Why                                        |
|-----------------------|--------------------------------------------------------|--------------------------------------------|
| `RuleRef`             | `Rule` (via `findingRuleSummary`)                      | Summary production                         |
| `WorkingSet.rules`    | `Rule` from `src/types/entities.ts`                    | The entity being linted                    |
| `WorkingSet.entityMaps` | `EntityMaps` from `src/features/rules/utils/rulePreview.ts` | Reuses existing entity-resolution contract |
| `CheckContext.rulesByPartition` | `RuleStage`, `ConditionsOp`                    | Partitioning for shadow / near-dup checks  |
| `Severity`            | —                                                      | Independent enum                           |
| `Finding`             | `Severity`, `FindingCode`, `RuleRef`                   | Composite output type                      |
| `DiagnosticReport`    | `Finding`                                              | Aggregate                                  |

No changes to `src/types/entities.ts`, `src/types/staged.ts`, or the staged store are required by this feature.
