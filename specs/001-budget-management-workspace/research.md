# Research: Budget Management Workspace

## How budget mode is determined

**Decision**: Read budget mode via a dedicated `useBudgetMode` hook that runs the same
ActualQL queries used by the overview feature (`zero_budgets` vs `reflect_budgets` count
comparison), using the shared `runQuery` helper from `src/lib/api/query.ts`.

**Rationale**: Budget mode is not stored in `ConnectionInstance` and the overview snapshot
may not be loaded when the user navigates directly to `/budget-management`. A lightweight
standalone hook guarantees mode availability without coupling to the overview page.
`deriveBudgetMode` logic from `src/features/overview/lib/overviewQueries.ts` will be
extracted to a shared utility to avoid duplication.

**Alternatives considered**:
- Store budget mode in `ConnectionInstance` — rejected; would require all connection flows
  to run the mode query, adding latency to unrelated pages.
- Read from overview query cache if available, fall back to fetch — valid but more complex;
  deferred to a follow-up optimisation.

---

## Budget edits store design

**Decision**: Implement a **separate** Zustand store `src/store/budgetEdits.ts` for budget
cell edits, distinct from the generic `staged.ts` entity store.

**Rationale**: The generic `StagedMap<T extends BaseEntity>` pattern requires `id: string`
on each entity. Budget cells are keyed by `${month}:${categoryId}` (composite, not a
server-assigned ID). Budget edits also have a different lifecycle (scoped to an open
budget/month range, not to entity CRUD) and different undo semantics (cell-level snapshot
vs entity-row snapshot). Reusing the generic store would require significant structural
changes that would complicate both the store and every existing consumer.

The new store exposes:
- `edits: Record<BudgetCellKey, StagedBudgetEdit>` — pending cell edits
- `undoStack / redoStack` — snapshots of `edits` only
- `pushUndo / undo / redo / discardAll / stageEdit / stageBulkEdits / clearEditsForMonths`

**Alternatives considered**:
- Adding a `budgetEdits` slice directly to `staged.ts` — rejected; would require changes to
  `EntityKey`, `StagedStoreSnapshot`, and every consumer that iterates entity keys.

---

## Save pipeline design

**Decision**: `useBudgetSave` is a **feature-local save hook**, isolated from the main
`useBudgetSavePipeline`. The budget management page has its own toolbar save button; saves
do not share the app-wide save panel.

**Rationale**: The main save pipeline handles entity CRUD (accounts, payees, categories,
rules, etc.). Budget cell edits are month-scoped PATCH operations with no cross-entity
dependencies. Mixing them into the same pipeline would complicate the dependency ordering
with no benefit.

Save operations MUST be sequential (not parallel flood) per FR-019, because the Budget
Months API has no batch endpoint and issuing many concurrent PATCH requests risks race
conditions on the server's budget sync state.

**Alternatives considered**:
- Plug budget save into `useBudgetSavePipeline` as an additional phase — rejected; pipeline
  is for entity CRUD, not month-cell operations. Would confuse the shared save/discard panel
  semantics.

---

## Grid rendering approach

**Decision**: Implement the workspace grid as a CSS-grid/table hybrid with virtualization
**only if** the visible cell count exceeds ~500 (approximately 12 months × 40+ categories).
Start without virtualization; add `@tanstack/react-virtual` if performance is measured to
be insufficient.

**Rationale**: Most budgets have 20–60 categories. At 12 months that's 240–720 cells —
at the boundary for virtualization. The spec says "use virtualization only if the visible
scope becomes large enough." Starting simple keeps the selection and keyboard navigation
logic straightforward.

---

## Arithmetic expression parsing

**Decision**: Implement a minimal arithmetic parser in `src/features/budget-management/lib/budgetMath.ts`
that supports `+`, `-`, `*`, `/`, and parentheses. No external math library.

**Rationale**: The spec limits scope to "basic arithmetic only." A small hand-rolled
evaluator is safer than a general expression evaluator (no `eval`, no arbitrary code
execution risk). Expressions are resolved to a numeric value before staging — they never
reach the API.

---

## CSV import matching strategy

**Decision**: Primary match key is `groupName.trim().toLowerCase() + ":" + categoryName.trim().toLowerCase()`.
Suggestions for unmatched rows use Levenshtein distance ≤ 2 against the same key space.

**Rationale**: The spec requires exact match first, suggestions for unmatched, never silent
fuzzy application. A simple string-distance check is sufficient for the category name domain
and avoids adding a heavy fuzzy-search dependency.

---

## Suspiciously large change threshold (FR-021)

**Decision**: Flag a cell edit as a large-change warning when:
`abs(nextBudgeted - previousBudgeted) > 500000` (i.e., > $5,000 in minor units at 100¢/$).

**Rationale**: $5,000 is a natural break point between routine monthly budget adjustments
and potentially accidental entries (e.g., typing `1500000` instead of `150000`). The
threshold is defined as a named constant in `budgetValidation.ts` for easy future tuning.

---

## Budget mode type normalisation

**Decision**: Use `"envelope" | "tracking" | "unidentified"` (lowercase) as the canonical
`BudgetMode` type for the budget-management feature, mapping from the overview's
`"Envelope" | "Tracking" | "Unidentified"` at the reading boundary.

**Rationale**: Lowercase aligns with the spec and the RD-027 types. The mapping is a
one-liner at the hook layer and keeps internal feature code clean.
