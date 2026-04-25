# Implementation Plan: Budget Management Workspace

**Branch**: `feat/001-budget-management-workspace` | **Date**: 2026-04-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/001-budget-management-workspace/spec.md`

---

## Summary

A new `/budget-management` page that provides a multi-month budget grid with staged-safe cell editing, bulk operations, CSV import/export, and envelope-mode immediate actions (category transfers, next-month hold). Editing is orchestrated through a dedicated `budgetEditsStore` (Zustand) separate from the generic `staged.ts`. Saves issue sequential `PATCH /months/{month}/categories/{categoryId}` calls via a feature-local pipeline; envelope actions bypass staging entirely.

---

## Technical Context

**Language/Version**: TypeScript 5 / Node 20  
**Primary Dependencies**: Next.js 16 (Turbopack), React 19, TanStack Query 5, Zustand 5, TanStack Table 8, RHF 7 + Zod 4, Tailwind 4  
**Storage**: No persistent storage — server state via Budget Months API; client state in Zustand and TanStack Query cache  
**Testing**: Jest + React Testing Library (existing project setup)  
**Target Platform**: Web (server-rendered Next.js page, client-interactive grid)  
**Project Type**: Web application (feature page within Actual Bench)  
**Performance Goals**: Grid renders ≤500 cells without virtualization; bulk preview within 2 s; batch save (50 cells) with per-cell reporting  
**Constraints**: Sequential save (no parallel flood); no direct browser calls to actual-http-api; no `crypto.randomUUID()` (use `generateId()`); Zustand 5 API (no deprecated patterns)  
**Scale/Scope**: Up to 12 months × ~60 categories (~720 cells); CSV import up to 500 rows

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Staged-First Safety | **PASS** | Budget cell edits staged locally; save requires explicit confirm. Envelope actions are immediate but disclosed explicitly in UI with confirm-then-persist modal — intentional bypass per spec FR-042–FR-045, disclosed in UI. |
| II. Controlled Connection Integrity | **PASS** | All API calls via `apiRequest()` through the Next.js proxy. No direct browser calls. |
| III. Workbench Scope Before Product Drift | **PASS with justification** | Budget management is a maintenance/administration workbench function — power-user control over raw budget values, bulk editing, CSV migration. The spec explicitly notes this is not a duplicate of daily budgeting UX. |
| IV. Brownfield Evolution Over Reinvention | **PASS** | Reuses: `apiRequest()`, `generateId()`, TanStack Query patterns, existing hook shapes (`useBudgetMode` extracts from `overviewQueries.ts`). New `budgetEditsStore` justified: composite key `${month}:${categoryId}` is incompatible with `BaseEntity` (requires `id: string`). |
| V. Clear Boundaries and Consistent Domain Modeling | **PASS** | State ownership is explicit (see data-model.md State Ownership table). Server data in TanStack Query; staged edits in `budgetEditsStore`; ephemeral UI in local state. |
| VI. User Clarity, Reviewability, and Trust | **PASS** | Staged cells visually distinct; review panel before save; immediate actions disclosed; ARIA labels and keyboard navigation required per constitution. |

**Exception recorded**: Envelope actions (transfers, holds) intentionally bypass the staged pipeline. Justification: these map to dedicated API commands with no batch equivalent; the spec (FR-042) explicitly states this distinction must be communicated to the user via a confirm-then-persist modal. Risk accepted: low — the bypass is narrow, scoped to two action types, and visible in the UI.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-budget-management-workspace/
├── plan.md              ← this file
├── research.md          ← Phase 0: architectural decisions
├── data-model.md        ← Phase 1: all domain types
├── quickstart.md        ← Phase 1: developer guide
├── contracts/
│   ├── budget-months-api.ts     ← typed API request/response shapes
│   └── budget-import-csv.ts     ← CSV row, match, preview types
└── tasks.md             ← Phase 2 output (created by /speckit.tasks)
```

### Source Code Layout

```text
src/
├── app/(app)/budget-management/
│   └── page.tsx                               # Route: /budget-management

├── features/budget-management/
│   ├── types.ts                               # All domain types (from data-model.md)
│   │
│   ├── components/
│   │   ├── BudgetManagementView.tsx           # Page shell; owns month range state
│   │   ├── BudgetWorkspace.tsx                # Grid + toolbar + panels composite
│   │   ├── BudgetGrid.tsx                     # Category rows × month columns grid
│   │   ├── BudgetCell.tsx                     # Single editable cell
│   │   ├── BudgetToolbar.tsx                  # Month range picker + Save/Discard/Bulk
│   │   ├── BudgetContextPanel.tsx             # Right-side panel: spent/balance/carryover
│   │   ├── BudgetSavePanel.tsx                # Staged review modal
│   │   ├── BudgetSelectionSummary.tsx         # Footer bar: selected cells stats
│   │   ├── BulkActionDialog.tsx               # Bulk edit preview + confirm modal
│   │   ├── BudgetExportDialog.tsx             # CSV export options modal
│   │   ├── BudgetImportDialog.tsx             # CSV import + match preview modal
│   │   ├── CategoryTransferDialog.tsx         # Envelope: immediate transfer modal
│   │   └── NextMonthHoldDialog.tsx            # Envelope: immediate hold/clear modal
│   │
│   ├── hooks/
│   │   ├── useBudgetMode.ts                   # ActualQL → BudgetMode (normalized lowercase)
│   │   ├── useAvailableMonths.ts              # GET /months → string[]
│   │   ├── useMonthData.ts                    # GET /months/{month}/categorygroups
│   │   ├── useBudgetSave.ts                   # Sequential PATCH loop
│   │   ├── useBulkAction.ts                   # Preview generation + stageBulkEdits
│   │   ├── useCategoryTransfer.ts             # Immediate POST /categorytransfers
│   │   └── useNextMonthHold.ts               # Immediate POST/DELETE /nextmonthbudgethold
│   │
│   ├── lib/
│   │   ├── budgetMath.ts                      # Arithmetic expression parser (no eval)
│   │   ├── budgetValidation.ts                # Large-change flag, income-block guard
│   │   ├── budgetCsv.ts                       # CSV serialize/parse, Levenshtein matching
│   │   └── budgetSelectionUtils.ts            # BudgetCellSelection → cell set resolution
│   │
│   └── csv/                                   # (empty; CSV logic lives in lib/budgetCsv.ts)
│
└── store/
    └── budgetEdits.ts                         # Zustand: edits + undoStack + redoStack
```

**Structure Decision**: Standard feature-folder layout matching all existing features (`accounts`, `rules`, `schedules`, etc.). The page route lives in `src/app/(app)/budget-management/` per the existing app convention. A new top-level `budgetEdits.ts` store is added alongside the existing `staged.ts` — justified by composite key incompatibility (see research.md).

---

## Phase 1: Foundation — Store + API Layer

### 1.1 Domain types (`features/budget-management/types.ts`)

Create all types from `data-model.md`:
- `BudgetMode`, `BudgetCellKey`
- `LoadedMonthSummary`, `LoadedBudgetCategory`, `LoadedCategoryGroup`, `LoadedMonthData`
- `StagedBudgetEdit`, `BudgetEditSnapshot`, `BudgetEditsState`, `BudgetEditsActions`
- `BudgetCellSelection`, `BudgetSelectionSummary`, `BudgetSaveResult`
- `CategoryTransferInput`, `NextMonthHoldInput`

### 1.2 Budget edits store (`store/budgetEdits.ts`)

Implement standalone Zustand store with shape:

```ts
{
  edits: Record<BudgetCellKey, StagedBudgetEdit>;
  undoStack: BudgetEditSnapshot[];
  redoStack: BudgetEditSnapshot[];

  stageEdit(edit: StagedBudgetEdit): void;        // single-cell; auto-pushes undo
  stageBulkEdits(edits: StagedBudgetEdit[]): void; // bulk; one undo push before all
  discardAll(): void;
  clearEditsForMonths(months: string[]): void;
  setSaveError(key: BudgetCellKey, msg: string): void;
  clearSaveError(key: BudgetCellKey): void;
  pushUndo(): void;
  undo(): void;
  redo(): void;
  hasPendingEdits(): boolean;
}
```

Key rules:
- `stageEdit` calls `pushUndo` automatically before applying; clears `redoStack`
- `stageBulkEdits` calls `pushUndo` once before applying all edits atomically
- `clearEditsForMonths` called after successful save for those months

### 1.3 Shared budget mode utility

Extract `deriveBudgetMode` from `src/features/overview/lib/overviewQueries.ts` into a shared utility. The overview queries file exports `ZERO_BUDGET_COUNT_QUERY` and `REFLECT_BUDGET_COUNT_QUERY`; the extraction is a refactor of existing logic, not new logic.

**Decision**: Add `src/lib/budget/deriveBudgetMode.ts` (shared lib, not feature-specific — overview also uses it). Export `deriveBudgetMode(zeroBudgetCount: number, reflectBudgetCount: number): OverviewBudgetMode` returning the **existing uppercase** type (`"Envelope" | "Tracking" | "Unidentified"`) from `src/features/overview/types.ts`. The existing `overviewQueries.ts` function already returns uppercase — the shared extraction MUST preserve that return type so no change to the overview feature is required.

**Lowercase normalization**: The `useBudgetMode` hook in the budget-management feature normalizes the result to lowercase (`"envelope" | "tracking" | "unidentified"`) at the hook boundary, keeping the internal feature type distinct from the overview type. This is consistent with research.md: "mapping is a one-liner at the hook layer."

**Migration**: Replace the private `deriveBudgetMode` function in `overviewQueries.ts` with an import from the shared utility. No functional change to overview.

### 1.4 Data hooks

All hooks use TanStack Query 5 patterns. All keys scoped by `connectionId` to preserve per-connection isolation (Principle II).

**`useBudgetMode(connectionId)`**
- Query key: `["budget-mode", connectionId]`
- Runs `ZERO_BUDGET_COUNT_QUERY` and `REFLECT_BUDGET_COUNT_QUERY` via `runQuery` (reuses `src/lib/api/query.ts`)
- Calls shared `deriveBudgetMode` (returns uppercase); normalizes result to lowercase `BudgetMode` at the hook boundary

**`useAvailableMonths(connectionId)`**
- Query key: `["budget-months", connectionId]`
- Calls `GET /months` via `apiRequest()`
- Returns `string[]` sorted ascending

**`useMonthData(connectionId, month)`**
- Query key: `["budget-month-data", connectionId, month]`
- Calls `GET /months/{month}/categorygroups` via `apiRequest()`
- Assembles `LoadedMonthData`: attaches `groupName` to each `LoadedBudgetCategory`, flattens to `categories[]`
- Invalidated after successful save or successful envelope action for that month

### 1.5 Lib utilities

**`budgetMath.ts`**: Recursive-descent parser for `+`, `-`, `*`, `/`, parentheses. Input: string expression. Output: `{ ok: true; value: number } | { ok: false; error: string }`. No `eval`. Returns integer (round to nearest minor unit).

**`budgetValidation.ts`**:
- `LARGE_CHANGE_THRESHOLD = 500000` (500,000 minor units = $5,000)
- `isLargeChange(prev: number, next: number): boolean`
- `isIncomeBlocked(category: LoadedBudgetCategory, mode: BudgetMode): boolean` — returns `true` when `category.isIncome && mode === "envelope"` (triggers hard-block)

**`budgetSelectionUtils.ts`**:
- `resolveSelectionCells(selection: BudgetCellSelection, months: string[], categories: LoadedBudgetCategory[]): Array<{ month: string; categoryId: string }>`
- Resolves rectangular selection (anchor→focus in month list × category list) to explicit cell list
- `parsePastePayload(text: string): string[][]` — parses **tab-and-newline-delimited** clipboard paste text (the format produced by spreadsheet copy) into a 2D array of cell strings; used by `BudgetWorkspace` paste handler; distinct from `parseCsv` which handles comma-separated file uploads

**`budgetCsv.ts`**:
- `exportToCsv(months: string[], groups: LoadedCategoryGroup[], opts: BudgetExportOptions, edits?: Record<BudgetCellKey, StagedBudgetEdit>): string` — builds CSV string
- `parseCsv(raw: string): BudgetCsvRow[]` — parses uploaded CSV
- `matchImportRows(rows: BudgetCsvRow[], categories: LoadedBudgetCategory[], availableMonths: string[], visibleMonths: string[]): ImportRowResult[]`
  - Exact match: `groupName.trim().toLowerCase() + ":" + categoryName.trim().toLowerCase()`
  - Suggestion: Levenshtein distance ≤ 2 against same key space
  - Month availability: "available" | "out-of-range" | "absent"
- `buildImportPreview(approved: ImportRowResult[], groups: LoadedCategoryGroup[]): ImportPreviewEntry[]`

---

## Phase 2: Grid and Cell Components

### 2.1 Page entry (`app/(app)/budget-management/page.tsx`)

Server component that renders `<BudgetManagementView />`. Follows existing page convention (see `src/app/(app)/accounts/page.tsx`).

### 2.2 `BudgetManagementView`

- Owns: active month range state (`string[]` — subset of available months, at most 12)
- Renders: `<BudgetToolbar>`, `<BudgetWorkspace>`, mode badge
- Fetches: `useBudgetMode`, `useAvailableMonths`
- Shows navigation guard (FR-048): uses `beforeunload` listener and Next.js navigation interception when `hasPendingEdits()` is true

### 2.3 `BudgetGrid`

- Layout: CSS grid — first column is category/group labels, subsequent columns are months
- Rows: `<BudgetGridGroupRow>` (group header with aggregates) + `<BudgetCell>` rows for each category
- Month summary row at bottom of each month column (FR-028)
- No virtualization in initial implementation (see research.md: start simple, add `@tanstack/react-virtual` only if measured)

### 2.4 `BudgetCell`

Cell behavior:
- Displays: budgeted amount (formatted decimal); staged indicator if edit pending
- Edit mode: text input accepting numeric values or arithmetic expressions
- On confirm: calls `budgetMath.ts` to resolve expression → integer; validates with `budgetValidation.ts`; calls `stageEdit()`
- Income hard-block (envelope mode): cell renders as read-only; no focus or keyboard entry
- Keyboard navigation delegates to parent grid (arrow keys, Tab, Enter, Escape)
- ARIA: `aria-label="{categoryName} budget for {month}"` on the cell element; input has associated label

### 2.5 `BudgetContextPanel`

Shows for selected cell (FR-027):
- Budgeted (current staged or persisted value)
- Spent
- Balance
- Carryover (boolean badge — read-only, no edit control)
- Previous month budgeted
- Category group name

### 2.6 `BudgetSelectionSummary` (footer bar)

Live display (FR-022):
- Selected months count
- Selected categories count
- Cells with staged edits count
- Total staged delta (Σ nextBudgeted − previousBudgeted for staged cells in selection)

Derived entirely from `BudgetCellSelection` + `budgetEditsStore.edits` — no API call.

---

## Phase 3: Save Pipeline and Review Panel

### 3.1 `useBudgetSave`

```ts
function useBudgetSave(connectionId: string): {
  save: (edits: Record<BudgetCellKey, StagedBudgetEdit>) => Promise<BudgetSaveResult[]>;
  isSaving: boolean;
}
```

Algorithm:
1. For each entry in `edits` (entries processed one at a time — sequential):
   - Call `PATCH /months/{month}/categories/{categoryId}` via `apiRequest()` with `{ budgeted: nextBudgeted }`
   - On success: push `{ status: "success" }` result; call `clearEditsForMonths([month])`
   - On failure: push `{ status: "error", message }` result; call `setSaveError(key, message)`
2. Invalidate TanStack Query cache for all affected months after all attempts complete

**No `Promise.all` or parallel batching** — one PATCH issued, awaited, then next.

Pre-save validation (FR-021):
- Re-fetch `GET /months` before issuing any PATCHes to confirm all target months still exist
- Flag any edit whose month is absent in fresh response → exclude from save, surface as error
- Flag large-change cells (threshold: `LARGE_CHANGE_THRESHOLD = 500,000`) in the review panel

### 3.2 `BudgetSavePanel`

Modal/drawer showing (FR-018):
- Total staged edit count
- Affected months list
- Estimated PATCH call count (= staged edit count)
- Warning list: large-change cells, absent-month cells
- "Save" and "Cancel" actions

After save:
- Shows per-cell success/failure count (FR-020)
- Failed cells remain staged with `saveError` set
- "Retry failed" option re-runs save only for cells with `saveError`

---

## Phase 4: Bulk Actions

### 4.1 `useBulkAction`

```ts
function useBulkAction(connectionId: string): {
  preview: (
    action: BulkActionType,
    selection: BudgetCellSelection,
    params: BulkActionParams
  ) => Promise<ImportPreviewEntry[]>;
  apply: (previews: ImportPreviewEntry[]) => void;
}
```

Supported bulk action types (FR-015):
- `"copy-previous-month"` — uses persisted value from `month − 1`
- `"copy-from-month"` — uses persisted value from specified source month
- `"set-to-zero"` — nextBudgeted = 0
- `"set-fixed"` — nextBudgeted = params.amount
- `"apply-percentage"` — nextBudgeted = round(previousBudgeted × (1 + params.pct / 100))
- `"fill-empty"` — same as `"set-fixed"` but only for cells where previousBudgeted === 0

`apply()` calls `stageBulkEdits()` (one undo step for the entire bulk operation).

### 4.2 `BulkActionDialog`

- Step 1: Select action type + params
- Step 2: Preview table (category, month, old value, new value)
- Step 3: Confirm → `apply()`

---

## Phase 5: CSV Import and Export

### 5.1 `BudgetExportDialog`

- Options: month range (multi-select from available months), include hidden, include income
- On confirm: calls `exportToCsv()`, triggers browser download via `URL.createObjectURL`
- "Download template" button uses same logic with all values empty

### 5.2 `BudgetImportDialog`

Three-step flow:
1. **Upload**: drag-and-drop or file input; `parseCsv()` → `BudgetCsvRow[]`
2. **Match review**: `matchImportRows()` → `ImportRowResult[]`
   - Exact matches: checked by default
   - Suggested matches: shown with suggestion key, require explicit checkbox approval
   - Absent months: shown as errors in a separate section
   - Out-of-range months: shown with "Extend visible range" prompt
   - Unmatched rows: shown as excluded
3. **Preview + confirm**: `buildImportPreview()` → table of changes; confirm calls `stageBulkEdits()`

---

## Phase 6: Envelope-Mode Immediate Actions

### 6.1 `useCategoryTransfer(connectionId)`

```ts
function useCategoryTransfer(connectionId: string): {
  transfer: (month: string, input: CategoryTransferInput) => Promise<void>;
  isPending: boolean;
  error: string | null;
}
```

- Calls `POST /months/{month}/categorytransfers` via `apiRequest()`
- On success: invalidates TanStack Query `["budget-month-data", connectionId, month]`
- Does NOT interact with `budgetEditsStore`

### 6.2 `useNextMonthHold(connectionId)`

```ts
function useNextMonthHold(connectionId: string): {
  setHold: (month: string, input: NextMonthHoldInput) => Promise<void>;
  clearHold: (month: string) => Promise<void>;
  isPending: boolean;
  error: string | null;
}
```

- `setHold` → `POST /months/{month}/nextmonthbudgethold`
- `clearHold` → `DELETE /months/{month}/nextmonthbudgethold`
- Both invalidate the affected month's TanStack Query cache on success

### 6.3 `CategoryTransferDialog` and `NextMonthHoldDialog`

Both are confirm-then-persist modals. Copy from existing dialog patterns in the codebase.

UI must state explicitly (per spec US-5): "This action takes effect immediately and does not go through the save panel."

Source/destination selectors: only non-income spending categories. Enforce `!category.isIncome` filter.

---

## Phase 7: Navigation Guard and Polish

### 7.1 Navigation guard (FR-048)

- `beforeunload` event listener when `hasPendingEdits()` is true
- Next.js router `beforePopState` interception for in-app navigation
- Confirmation dialog: "You have unsaved budget changes. Leave anyway?"

### 7.2 Month header and summary row

- Month column header: month label (abbreviated, e.g. "Mar 2026") + total budgeted + (envelope only) available-to-assign from `LoadedMonthSummary.toBudget`
- Income group rows hidden by default in envelope mode (toggle available)

### 7.3 ARIA and keyboard

All interactive controls MUST have programmatically associated labels. Keyboard navigation:
- Arrow keys: move cell focus within grid
- Enter / F2: enter edit mode on focused cell
- Escape: exit edit mode, revert uncommitted input
- Tab: advance to next cell (horizontal)
- Shift+Tab: previous cell
- Ctrl+Z: undo; Ctrl+Y / Ctrl+Shift+Z: redo

---

## Cross-Cutting Decisions

### Data flow summary

```
GET /months  →  useAvailableMonths  →  BudgetManagementView (month range)
                                         ↓
GET /months/{month}/categorygroups  →  useMonthData(month)  →  BudgetGrid rows

User edits cell  →  budgetMath resolve  →  stageEdit()  →  budgetEditsStore
                                                             ↓
User clicks Save  →  BudgetSavePanel (review)
                        ↓
                    useBudgetSave: sequential PATCH loop
                        ↓ success
                    clearEditsForMonths + invalidate TQ cache

Envelope action  →  CategoryTransferDialog / NextMonthHoldDialog
                      ↓ confirm
                    useCategoryTransfer / useNextMonthHold: immediate POST/DELETE
                      ↓ success
                    invalidate TQ cache for affected month
```

### TanStack Query cache invalidation strategy

| Event | Invalidated keys |
|-------|-----------------|
| Successful PATCH for month M | `["budget-month-data", connectionId, M]` |
| Successful category transfer for month M | `["budget-month-data", connectionId, M]` |
| Successful hold set/clear for month M | `["budget-month-data", connectionId, M]` |
| Connection change | All `["budget-*", connectionId]` keys |

### Error handling

| Error scenario | Behavior |
|----------------|----------|
| `GET /months` fails | Show error state in toolbar; no grid rendered |
| `GET /months/{month}/categorygroups` fails | Month column shows error indicator; other months unaffected |
| PATCH fails (partial batch) | Cell gets `saveError`; save panel shows failure count + retry |
| Category transfer fails | Dialog shows error inline; grid unchanged |
| Next-month hold fails | Dialog shows error inline; month state unchanged |
| Month absent at save time | Pre-save validation rejects those edits before any PATCH issued |

### Arithmetic expression resolution

Expressions are resolved in `BudgetCell` before `stageEdit()` is called. If resolution fails (invalid syntax), the cell shows an inline error and does not stage. The API only ever receives resolved integer values.

### Large-change threshold

`LARGE_CHANGE_THRESHOLD = 500_000` (500,000 minor units = $5,000). Defined as a named constant in `budgetValidation.ts`. Flagged in the save review panel as a soft warning — user can acknowledge and proceed.

### Income-category hard-block (envelope mode)

`budgetValidation.ts` exports `isIncomeBlocked(category, mode)`. In `BudgetCell`, this renders the cell as a non-interactive display element with `aria-readonly="true"`. No keyboard entry, no click-to-edit. This is enforced in the component layer, not only in the store.

---

## Dependencies and Integration Points

| Integration | File | Pattern |
|-------------|------|---------|
| API calls | `src/lib/api/*.ts` + `apiRequest()` | Proxy route |
| ID generation | `src/lib/uuid.ts` `generateId()` | Only if cell IDs needed |
| Budget mode (shared) | `src/lib/budget/deriveBudgetMode.ts` | Extract from overview |
| ActualQL queries | `src/lib/api/query.ts` `runQuery()` | Reuse |
| Overview types | `src/features/overview/types.ts` | Read `BudgetMode` type (then normalize) |
| Page layout | `src/app/(app)/` layout convention | Existing shell |
| Tailwind 4 | `globals.css` `@theme` | No tailwind.config.js |

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Grid performance with >500 cells | Low (most budgets ≤60 categories) | Start without virtualization; add `@tanstack/react-virtual` if measured |
| Sequential save latency for large batches | Medium | Show progress per-cell in save panel; user is informed before starting |
| CSV category matching false positives | Low | Suggestions require explicit user approval; no silent fuzzy apply |
| Budget mode unavailable at page render | Low | `useBudgetMode` shows loading state; grid defers render |
| Stale month data after envelope action | Low | Invalidate TanStack Query key on every successful immediate action |
| Navigation loss of staged changes | Addressed | Navigation guard via `beforeunload` + router interception |

---

## Out of Scope (v1)

- Carryover editing (read-only in v1; shown in context panel)
- Transfer to/from available-to-budget pool (pool routing deferred)
- Virtualized grid (deferred until performance measured)
- Budget goals, templates, or projections
- Multi-year trend analysis or historical averages
- Rolling-average or forward-scaling bulk actions
