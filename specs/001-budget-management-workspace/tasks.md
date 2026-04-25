# Tasks: Budget Management Workspace

**Input**: Design documents from `specs/001-budget-management-workspace/`
**Prerequisites**: plan.md ✅, spec.md ✅, data-model.md ✅, contracts/ ✅, research.md ✅, quickstart.md ✅

**Tests**: Not explicitly requested in the feature specification — test tasks are omitted. Unit tests for pure logic (budgetMath, budgetCsv, budgetEditsStore) are strongly recommended and can be added as a follow-up.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no unresolved dependencies)
- **[Story]**: Which user story this task belongs to ([US1]–[US5])

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Feature folder structure and core store that everything else depends on.

- [X] T001 Create feature folder skeleton: `src/features/budget-management/` with `components/`, `hooks/`, `lib/` sub-directories (empty index files)
- [X] T002 Create `src/features/budget-management/types.ts` with all domain types from `data-model.md`: `BudgetMode`, `BudgetCellKey`, `LoadedMonthSummary`, `LoadedBudgetCategory`, `LoadedCategoryGroup`, `LoadedMonthData`, `StagedBudgetEdit`, `BudgetEditSnapshot`, `BudgetEditsState`, `BudgetEditsActions`, `BudgetCellSelection`, `BudgetSelectionSummary`, `BudgetSaveResult`, `CategoryTransferInput`, `NextMonthHoldInput`
- [X] T003 Create `src/store/budgetEdits.ts` Zustand 5 store implementing `BudgetEditsState` + `BudgetEditsActions`: `edits`, `undoStack`, `redoStack`, `stageEdit` (auto-pushUndo), `stageBulkEdits` (one pushUndo before all), `discardAll`, `clearEditsForMonths`, `setSaveError`, `clearSaveError`, `pushUndo`, `undo`, `redo`, `hasPendingEdits`

**Checkpoint**: Store compiles and exports correctly; `hasPendingEdits()` returns `false` on fresh state.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared utilities and data hooks used by ALL user stories. Must be complete before any story work begins.

**⚠️ CRITICAL**: No user story implementation can begin until this phase is complete.

- [X] T004 Extract `deriveBudgetMode` from `src/features/overview/lib/overviewQueries.ts` into `src/lib/budget/deriveBudgetMode.ts`; the shared function MUST preserve the existing **uppercase** return type (`"Envelope" | "Tracking" | "Unidentified"` from `src/features/overview/types.ts`) so the overview feature requires zero changes; replace the private function in `overviewQueries.ts` with an import from the new shared path; the lowercase normalization to `"envelope" | "tracking" | "unidentified"` is done inside `useBudgetMode.ts` (T009), not in the shared utility
- [X] T005 [P] Create `src/features/budget-management/lib/budgetMath.ts`: recursive-descent parser for `+`, `-`, `*`, `/`, parentheses; input: `string`; output: `{ ok: true; value: number } | { ok: false; error: string }`; no `eval`; result rounded to nearest integer (minor units); exports `parseBudgetExpression(expr: string)`
- [X] T006 [P] Create `src/features/budget-management/lib/budgetValidation.ts`: export `LARGE_CHANGE_THRESHOLD = 500_000`; `isLargeChange(prev: number, next: number): boolean`; `isIncomeBlocked(category: LoadedBudgetCategory, mode: BudgetMode): boolean` (true when `category.isIncome && mode === "envelope"`)
- [X] T007 [P] Create `src/features/budget-management/lib/budgetSelectionUtils.ts`: export `resolveSelectionCells(selection: BudgetCellSelection, months: string[], categories: LoadedBudgetCategory[]): Array<{ month: string; categoryId: string }>` — resolves rectangular anchor→focus selection to explicit cell list using index-based range in `months[]` and `categories[]`; also export `parsePastePayload(text: string): string[][]` — splits tab-and-newline-delimited clipboard text (spreadsheet copy format) into a 2D array of cell strings for use by the grid paste handler; this is distinct from `parseCsv` which handles comma-separated file uploads
- [X] T008 [P] Create `src/features/budget-management/lib/budgetCsv.ts`: export `exportToCsv(months, groups, opts, edits?)`, `parseCsv(raw: string): BudgetCsvRow[]`, `matchImportRows(rows, categories, availableMonths, visibleMonths): ImportRowResult[]` (exact match on `groupName:categoryName` key, Levenshtein ≤ 2 for suggestions, month availability classification), `buildImportPreview(approved, groups): ImportPreviewEntry[]`; types from `contracts/budget-import-csv.ts`
- [X] T009 Create `src/features/budget-management/hooks/useBudgetMode.ts`: TanStack Query 5 hook; key `["budget-mode", connectionId]`; runs `ZERO_BUDGET_COUNT_QUERY` and `REFLECT_BUDGET_COUNT_QUERY` via `runQuery` from `src/lib/api/query.ts`; calls shared `deriveBudgetMode`; returns `{ data: BudgetMode | undefined; isLoading: boolean; error: unknown }`
- [X] T010 [P] Create `src/features/budget-management/hooks/useAvailableMonths.ts`: TanStack Query 5; key `["budget-months", connectionId]`; calls `GET /months` via `apiRequest()`; returns `string[]` sorted ascending
- [X] T011 [P] Create `src/features/budget-management/hooks/useMonthData.ts`: TanStack Query 5; key `["budget-month-data", connectionId, month]`; calls `GET /months/{month}/categorygroups` via `apiRequest()`; assembles `LoadedMonthData` (attaches `groupName` to each `LoadedBudgetCategory`, flattens to `categories[]`); returns `{ data: LoadedMonthData | undefined; isLoading: boolean; error: unknown }`

**Checkpoint**: All hooks and utilities compile with `npx tsc --noEmit`. `useBudgetMode` can be imported and called in isolation.

---

## Phase 3: User Story 1 — Multi-Month Budget Editing Workspace (Priority: P1) 🎯 MVP

**Goal**: Navigable budget grid with staged cell editing, selection, paste, broadcast, and undo/redo.

**Independent Test**: Connect a budget, open `/budget-management`, change budget amounts for 3 categories across 2 months, verify cells are highlighted as pending, verify undo reverses each edit, verify Discard All returns all cells to persisted values, and confirm no server call was issued at any point.

### Implementation for User Story 1

- [X] T012 [US1] Create `src/app/(app)/budget-management/page.tsx`: server component that renders `<BudgetManagementView />`; follows existing page convention (see `src/app/(app)/accounts/page.tsx`)
- [X] T013 [P] [US1] Create `src/features/budget-management/components/BudgetManagementView.tsx`: top-level page shell; owns `activeMonths: string[]` local state (subset of available months, max 12); renders `<BudgetToolbar>` + `<BudgetWorkspace>` + budget mode badge in header; consumes `useBudgetMode` and `useAvailableMonths`; shows loading/error states for both
- [X] T014 [P] [US1] Create `src/features/budget-management/components/BudgetToolbar.tsx`: month range multi-select (months from `useAvailableMonths`); Save button (disabled when no pending edits); Discard All button; bulk action trigger button; export/import button stubs (wired in later phases); mode badge; accessible labels on all controls per Principle VI
- [X] T015 [US1] Create `src/features/budget-management/components/BudgetGrid.tsx`: CSS grid layout — first column category/group labels, subsequent columns are active months; renders `<BudgetGridGroupRow>` headers with group aggregate totals; renders `<BudgetCell>` for each category×month; renders month summary row at column footer (total budgeted + envelope `toBudget`); passes `onCellFocus` / `onCellSelect` callbacks up; keyboard navigation: arrow keys move focus, Tab/Shift+Tab advance horizontally
- [X] T016 [US1] Create `src/features/budget-management/components/BudgetCell.tsx`: display state shows budgeted amount (formatted decimal) + staged indicator when `budgetEditsStore.edits[key]` exists; edit mode: text input accepting numeric value or arithmetic expression; on blur/Enter: call `parseBudgetExpression` → validate with `isIncomeBlocked` / `isLargeChange` → call `stageEdit()`; Escape cancels edit without staging; income hard-block (`isIncomeBlocked` true): renders as non-interactive display with `aria-readonly="true"`; `aria-label="{categoryName} budget for {month}"`; broadcasts single value to multi-cell selection via parent callback
- [X] T017 [P] [US1] Create `src/features/budget-management/components/BudgetContextPanel.tsx`: shown when a cell is selected; displays budgeted (staged or persisted), spent, balance, carryover (boolean badge — read-only, no edit control), previous month budgeted, category name, group name; reads from `useMonthData` for the selected month; no API call of its own
- [X] T018 [P] [US1] Create `src/features/budget-management/components/BudgetSelectionSummary.tsx`: footer bar showing live: selected months count, selected categories count, staged-edit cell count in selection, total staged delta (Σ nextBudgeted − previousBudgeted); derived from `BudgetCellSelection` + `budgetEditsStore.edits` with no API call; updates on every selection or edit change
- [X] T019 [US1] Create `src/features/budget-management/components/BudgetWorkspace.tsx`: composes `<BudgetGrid>`, `<BudgetContextPanel>`, `<BudgetSelectionSummary>`; owns `BudgetCellSelection` local state; handles paste (clipboard read → `parsePastePayload` from `budgetSelectionUtils.ts` to get 2D string array → resolve each value via `parseBudgetExpression` → `stageBulkEdits` from top-left anchor per FR-013); handles Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z for undo/redo; passes selection state down to grid and summary

**Checkpoint**: Open `/budget-management`, edit cells, verify pending highlight, undo, redo, Discard All, multi-cell broadcast, and paste all work without any server writes.

---

## Phase 4: User Story 2 — Staged Review and Save (Priority: P2)

**Goal**: Review panel listing all staged changes with PATCH call estimate, per-cell save with sequential pipeline, partial-failure reporting and retry.

**Independent Test**: Stage 10 edits, open review panel, verify correct staged count and affected months, confirm save, verify all 10 changes persist on fresh page load. Then stage 5 edits and simulate one API failure: verify the 4 successes are cleared, the 1 failure remains staged with an error indicator, and retry sends only the failed cell.

### Implementation for User Story 2

- [X] T020 [US2] Create `src/features/budget-management/hooks/useBudgetSave.ts`: accepts `connectionId`; `save(edits)` iterates entries sequentially (one `PATCH /months/{month}/categories/{categoryId}` at a time via `apiRequest()`); on cell success calls `clearEditsForMonths([month])` and invalidates TanStack Query key `["budget-month-data", connectionId, month]`; on cell failure calls `setSaveError(key, message)`; pre-save: re-fetches `GET /months` and filters out any edits whose month is now absent; returns `BudgetSaveResult[]`; exposes `isSaving: boolean` and `progress: { completed: number; total: number }` (incremented after each PATCH, reset to `{ completed: 0, total: 0 }` when not saving)
- [X] T021 [US2] Create `src/features/budget-management/components/BudgetSavePanel.tsx`: modal showing total staged edit count, affected months list, estimated PATCH call count; warning list for: large-change cells (`isLargeChange`), absent-month edits (filtered by pre-save check); during save: display a **live progress counter** ("Saving N of M…") that increments after each sequential PATCH completes — `useBudgetSave` must expose a `progress: { completed: number; total: number }` value alongside `isSaving`; after save: per-cell success/failure count; failed cells listed with retry option (`useBudgetSave.save` called with only cells where `saveError` is set); "Cancel" closes without saving
- [X] T022 [US2] Wire `BudgetSavePanel` into `BudgetWorkspace.tsx` / `BudgetToolbar.tsx`: Save button in toolbar opens `BudgetSavePanel`; panel receives staged edits from `budgetEditsStore`; on successful complete save, panel closes and grid reflects updated data

**Checkpoint**: Full save round-trip works. Partial failures are attributed per cell. Retry succeeds for failed cells. Save panel accurately shows pre-save warnings.

---

## Phase 5: User Story 3 — Bulk Budget Actions (Priority: P3)

**Goal**: Preview-gated bulk edit operations on rectangular selections (copy month, set fixed, apply %, fill empty, set zero, clear).

**Independent Test**: Select 10 cells across 2 months and 5 categories, run "Copy from previous month", verify preview shows the correct proposed values sourced from the prior month, confirm, verify all 10 cells are staged as a single undo step that can be reversed in one Ctrl+Z.

### Implementation for User Story 3

- [X] T023 [US3] Create `src/features/budget-management/hooks/useBulkAction.ts`: `preview(action, selection, params)` resolves selection cells via `resolveSelectionCells`, fetches source month data for copy operations, applies transformation, returns `ImportPreviewEntry[]`; `apply(previews)` calls `stageBulkEdits()` — one undo step for the full bulk operation; supported actions: `"copy-previous-month"`, `"copy-from-month"`, `"set-to-zero"`, `"set-fixed"`, `"apply-percentage"`, `"fill-empty"` (only zero/empty cells), `"clear-values"` (set to 0)
- [X] T024 [US3] Create `src/features/budget-management/components/BulkActionDialog.tsx`: Step 1 — action type selector + params input (amount for set-fixed, source month for copy-from-month, percentage for apply-percentage); Step 2 — preview table (category, month, old value → new value) rendered from `useBulkAction.preview`; Step 3 — confirm calls `useBulkAction.apply`; cancel at any step discards without staging
- [X] T025 [US3] Wire `BulkActionDialog` into `BudgetToolbar.tsx`: Bulk Action button enabled when selection is non-empty; passes current `BudgetCellSelection` to dialog; disabled when no cells selected

**Checkpoint**: Bulk copy, set, and percentage actions all stage correctly as single undoable operations. Preview accurately reflects proposed values before confirmation.

---

## Phase 6: User Story 4 — CSV Export and Import (Priority: P4)

**Goal**: Export current budget data to CSV; import a modified CSV with match review, preview, and staged confirmation.

**Independent Test**: Export 3 months of data, modify 5 values in the resulting CSV, import the file, verify the match preview shows exactly 5 proposed changes with correct before/after values, confirm, verify those 5 cells are staged in the grid. Separately, import a CSV with one unmatched category (suggestion offered, not auto-applied) and one row referencing a month absent from `GET /months` (rejected with clear message).

### Implementation for User Story 4

- [X] T026 [P] [US4] Create `src/features/budget-management/components/BudgetExportDialog.tsx`: month range multi-select (from available months); checkboxes for include hidden categories and include income groups; "Export" button calls `exportToCsv(months, groups, opts)` and triggers browser download via `URL.createObjectURL(new Blob([csv], { type: "text/csv" }))`; "Download blank template" uses same shape but empty amount cells; accessible labels on all form controls
- [X] T027 [US4] Create `src/features/budget-management/components/BudgetImportDialog.tsx`: three-step wizard: (1) file upload (drag-and-drop + file input) → `parseCsv()` → `BudgetCsvRow[]`; (2) match review — exact matches shown checked, suggested matches shown with suggestion key and explicit approval checkbox, absent-month rows shown as errors, out-of-range month rows shown with "Extend visible range" option, unmatched rows shown as excluded; (3) preview table → `buildImportPreview()` → confirm calls `stageBulkEdits()`; if user accepts "extend range" offer, updates active months in `BudgetManagementView` then re-runs preview
- [X] T028 [US4] Wire export and import dialogs into `BudgetToolbar.tsx`: Export button opens `BudgetExportDialog`; Import button opens `BudgetImportDialog`; both pass current `activeMonths`, loaded `groups`, and `availableMonths` as props

**Checkpoint**: Full CSV round-trip: export → modify 5 values → import → preview shows exactly 5 changes → confirm → 5 cells staged. Unmatched and absent-month rows are correctly handled.

---

## Phase 7: User Story 5 — Envelope-Mode Immediate Actions (Priority: P5)

**Goal**: Envelope-only category transfer and next-month hold controls that confirm-then-persist immediately, bypassing the staged pipeline.

**Independent Test**: In envelope mode, initiate a category transfer from category A to category B for a given amount, confirm, verify the API is called immediately and the grid reloads the affected month. In tracking mode, verify neither the transfer button nor the hold button appears anywhere on the page.

### Implementation for User Story 5

- [X] T029 [P] [US5] Create `src/features/budget-management/hooks/useCategoryTransfer.ts`: `transfer(month, input: CategoryTransferInput): Promise<void>` calls `POST /months/{month}/categorytransfers` via `apiRequest()`; on success invalidates `["budget-month-data", connectionId, month]`; does NOT interact with `budgetEditsStore`; exposes `isPending: boolean` and `error: string | null`
- [X] T030 [P] [US5] Create `src/features/budget-management/hooks/useNextMonthHold.ts`: `setHold(month, input: NextMonthHoldInput): Promise<void>` calls `POST /months/{month}/nextmonthbudgethold`; `clearHold(month): Promise<void>` calls `DELETE /months/{month}/nextmonthbudgethold`; both invalidate `["budget-month-data", connectionId, month]` on success; exposes `isPending: boolean` and `error: string | null`
- [X] T031 [P] [US5] Create `src/features/budget-management/components/CategoryTransferDialog.tsx`: source category selector (non-income spending categories only — filter `!category.isIncome`), destination category selector (same filter, excludes source), amount input; disclaimer text: "This action takes effect immediately and does not go through the save panel."; on confirm calls `useCategoryTransfer.transfer`; shows inline error on failure; accessible labels on all controls
- [X] T032 [US5] Create `src/features/budget-management/components/NextMonthHoldDialog.tsx`: amount input for setting hold; "Set Hold" and "Clear Hold" actions; disclaimer text: "This action takes effect immediately and does not go through the save panel."; calls `useNextMonthHold.setHold` / `useNextMonthHold.clearHold`; shows inline error on failure; accessible labels
- [X] T033 [US5] Wire `CategoryTransferDialog` and `NextMonthHoldDialog` into `BudgetWorkspace.tsx`: render both only when `budgetMode === "envelope"`; add Transfer and Hold action buttons to toolbar or context panel, also only when envelope mode; in tracking mode these buttons and dialogs MUST NOT be rendered (not just hidden)

**Checkpoint**: Transfer and hold are invisible in tracking mode. In envelope mode, both actions complete or fail with visible inline feedback; grid reloads after success.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Navigation safety, full accessibility compliance, documentation, final quality gates.

- [X] T034 Implement navigation guard in `src/features/budget-management/components/BudgetManagementView.tsx`: add `beforeunload` event listener (`event.preventDefault()` + `event.returnValue = ""`) when `hasPendingEdits()` is true; add Next.js `router.beforePopState` / navigation intercept equivalent to prompt confirmation for in-app navigation when staged changes exist; clean up listeners on unmount
- [X] T035 [P] Accessibility audit across all new components: verify every interactive control has a programmatically associated label (`aria-label`, `htmlFor`/`id`, or visually-hidden text); verify keyboard navigation is complete for grid (arrow keys, Enter, Escape, Tab, Shift+Tab) and dialogs (focus trap, Escape closes); verify `aria-readonly="true"` on income hard-blocked cells; fix any issues found
- [X] T036 [P] Run full quality gate: `npm run lint` (0 errors), `npx tsc --noEmit` (0 errors), `npm test` (all suites pass); fix any failures introduced by this feature
- [X] T037 [P] Update `FEATURES.md` to document the shipped Budget Management Workspace page, its URL, key capabilities, and any known v1 limitations (carryover read-only, pool routing deferred, transfer scope v1)
- [X] T038 Review `AGENTS.md` / `CLAUDE.md` for any stale or missing entries resulting from this feature (e.g., new store path, new feature folder, new shared utility in `src/lib/budget/`)

**Checkpoint**: `npm run lint && npx tsc --noEmit && npm test` all pass. Navigation guard triggers on unsaved-changes navigation. All interactive controls pass a basic accessibility check.

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup) ──────────────────────────────────────┐
                                                       ↓
Phase 2 (Foundational) ──────────────────────────────┐│
  T004 → T009 (useBudgetMode needs deriveBudgetMode)  ││
  T005–T008 can run in parallel                        ││
  T010–T011 can run in parallel                        ││
                                                       ↓↓
Phase 3 (US1, P1) ← BLOCKS US2–US5 grid integration  │
Phase 4 (US2, P2) ← can start after T009–T011        │
Phase 5 (US3, P3) ← can start after T007 (selectionUtils) ← foundational
Phase 6 (US4, P4) ← can start after T008 (budgetCsv)  ← foundational
Phase 7 (US5, P5) ← can start after T009–T011         ← foundational

Phase 8 (Polish) ── depends on all story phases complete
```

### User Story Dependencies

- **US1 (P1)**: Foundational complete; no other story dependency. Most of the grid scaffolding is needed by later stories — complete first.
- **US2 (P2)**: T009–T011 (data hooks) complete. Integrates into `BudgetWorkspace` built in US1 (T022 wires into US1 files).
- **US3 (P3)**: T007 (`resolveSelectionCells`) + T011 (`useMonthData`) complete. `BulkActionDialog` integrates with grid selection from US1.
- **US4 (P4)**: T008 (`budgetCsv`) complete. `BudgetImportDialog` calls `stageBulkEdits` from store (T003). Export/import buttons wire into toolbar from US1.
- **US5 (P5)**: T009 (`useBudgetMode`) complete. Dialogs conditionally rendered based on mode.

### Within Each User Story

- Foundation lib utilities (T005–T008) → hooks (T009–T011) → components (story phases)
- Grid composition: grid leaf cells (T016) before grid container (T015) before workspace composite (T019)
- Save: hook (T020) before panel UI (T021) before wiring (T022)
- Bulk: hook (T023) before dialog (T024) before wiring (T025)
- CSV: lib (T008, foundational) before dialogs (T026–T027) before wiring (T028)
- Envelope: hooks (T029–T030) before dialogs (T031–T032) before wiring (T033)

### Parallel Opportunities

All Phase 2 tasks marked [P] can run in parallel once T001–T003 are complete:

```
T005 (budgetMath)         ──┐
T006 (budgetValidation)   ──┤
T007 (budgetSelectionUtils)─┤  All parallel
T008 (budgetCsv)          ──┤
T010 (useAvailableMonths) ──┤
T011 (useMonthData)       ──┘
↑ T004 (deriveBudgetMode) must complete before T009
```

Within US1, T013, T014, T017, T018 can run in parallel (different files), then converge at T015, T016, T019.

---

## Parallel Example: User Story 1

```bash
# After T012 (page.tsx), these can run in parallel:
Task T013: BudgetManagementView.tsx (page shell)
Task T014: BudgetToolbar.tsx (toolbar)
Task T017: BudgetContextPanel.tsx (context panel)
Task T018: BudgetSelectionSummary.tsx (footer summary)

# After T013–T018 complete, these run sequentially:
Task T015: BudgetGrid.tsx (depends on cell structure from T016 shape)
Task T016: BudgetCell.tsx (depends on grid layout from T015 structure)
Task T019: BudgetWorkspace.tsx (composes all of the above)
```

## Parallel Example: User Story 5

```bash
# These can all run in parallel after T009 (useBudgetMode):
Task T029: useCategoryTransfer.ts hook
Task T030: useNextMonthHold.ts hook
Task T031: CategoryTransferDialog.tsx (can use hook stub)
# Then:
Task T032: NextMonthHoldDialog.tsx (after T030)
Task T033: Wire into BudgetWorkspace.tsx (after T031 + T032)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) — T001–T003
2. Complete Phase 2 (Foundational) — T004–T011
3. Complete Phase 3 (US1) — T012–T019
4. **STOP and VALIDATE**: Navigable grid with staged editing, undo, discard, selection, paste, broadcast — no server writes until Save is pressed
5. Demonstrate: edit budget values for multiple categories and months, show pending highlights

### Incremental Delivery

1. Setup + Foundational → Foundation ready (T001–T011)
2. US1 → Navigable staged grid (T012–T019) — **MVP**
3. US2 → Save pipeline + review panel (T020–T022)
4. US3 → Bulk actions (T023–T025)
5. US4 → CSV import/export (T026–T028)
6. US5 → Envelope immediate actions (T029–T033)
7. Polish → Navigation guard + a11y + docs (T034–T038)

### Parallel Team Strategy

With two developers after Foundational is complete:

- **Dev A**: US1 (grid + cells) → US2 (save pipeline)
- **Dev B**: US5 (envelope hooks + dialogs, can stub grid integration) → US4 (CSV lib is foundational, dialog is self-contained)
- US3 (bulk actions) fills naturally after US1 grid selection is in place

---

## Notes

- [P] = different files, no unresolved incoming dependencies — safe to parallelize
- [Story] label maps each task to its user story for traceability and MVP scoping
- No test tasks included — US1 independent test can be validated manually per the acceptance scenarios in spec.md
- `generateId()` from `src/lib/uuid.ts` must be used if any ID generation is needed; `crypto.randomUUID()` is prohibited
- `apiRequest()` is the only approved API path — no direct `fetch()` to actual-http-api
- Zustand 5 API — use `create` with no deprecated patterns
- Tailwind 4 — no `tailwind.config.js`; all theme tokens in `globals.css` via `@theme`
- Sequential save constraint (FR-019): `useBudgetSave` MUST NOT use `Promise.all` — one PATCH at a time
- Envelope action disclaimer MUST be present in dialogs — users must know these bypass the staged pipeline
