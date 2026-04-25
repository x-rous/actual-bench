# Feature Specification: Budget Management Workspace

**Feature Branch**: `feat/001-budget-management-workspace`
**Created**: 2026-04-16
**Status**: Draft
**Input**: RD-027 — Budget Management Page (API-First) + Budget Months API documentation

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Multi-Month Budget Editing Workspace (Priority: P1)

A power user connects to their budget and opens the Budget Management page. They see their categories organized in groups, with columns for each month in their selected date range. Each cell displays the budgeted amount for that category-month intersection. The user navigates through cells with the keyboard, edits individual budget values, selects rectangular ranges, and pastes values across multiple cells at once. Pasting starts from the top-left selected cell and fills the corresponding rectangle — the user does not need to pre-select a matching target area. A single value can be broadcast to every cell in a selection. All edits are shown as highlighted "pending" cells until saved.

**Why this priority**: This is the foundational interaction model for the entire page. Every other user story builds on a working, navigable budget grid with staged editing.

**Independent Test**: A user can open the page, change the budgeted amount for three categories across two months, see those cells highlighted as pending, and verify no data has been saved until they confirm.

**Acceptance Scenarios**:

1. **Given** a connected budget with at least 3 months available in the Budget Months API, **When** the user opens the Budget Management page, **Then** the grid displays category groups, categories, and a column for each visible month showing the budgeted amount per cell.
2. **Given** the budget grid is displayed, **When** the user types a new value into a budget cell, **Then** the cell is marked as pending (visually distinct), the original persisted value is still accessible, and no server write occurs.
3. **Given** a rectangular selection containing copied budget values, **When** the user pastes, **Then** the paste fills a rectangle of the same dimensions starting from the top-left selected cell; the user is not required to pre-select a target area of matching dimensions.
4. **Given** a multi-cell selection, **When** the user types a single value and confirms, **Then** all selected cells receive that value as staged edits.
5. **Given** a staged edit exists, **When** the user presses undo, **Then** the edit is reversed; re-doing restores it.
6. **Given** staged changes exist, **When** the user chooses "Discard All", **Then** all pending cells revert to their last persisted values and no server writes occur.

---

### User Story 2 — Staged Review and Save (Priority: P2)

After making a set of edits across multiple months and categories, the user wants to review what they are about to persist before committing. They open a review panel showing a summary of all staged changes — how many cells are affected, which months are touched, and an estimate of the number of individual Budget Months API calls that will be issued. They can then confirm the save or go back and adjust.

**Why this priority**: Staged review before save is a core product safety guarantee. Without it, power users have no confidence checkpoint before a large batch of changes is written.

**Independent Test**: A user makes 10 edits, opens the review panel, sees the correct count of affected cells and months, confirms, and all 10 changes are reflected in a subsequent fresh load of the page.

**Acceptance Scenarios**:

1. **Given** staged changes exist, **When** the user opens the review/save panel, **Then** the system shows: total staged cell count, affected months, and an estimated number of individual `PATCH /months/{month}/categories/{categoryId}` calls to be issued.
2. **Given** the review panel is open and the user confirms save, **When** the save completes successfully, **Then** all staged changes are cleared and the grid reflects the newly persisted values.
3. **Given** a large batch save where some operations fail, **When** save is complete, **Then** the system shows a count of successes and failures, identifies which cells failed, and offers a retry option for failed items.
4. **Given** the review panel flags a warning (e.g., edit targeting a month absent from `GET /months`), **When** the user reviews, **Then** the warning is clearly described and does not silently block save — the user can acknowledge and proceed or cancel.

---

### User Story 3 — Bulk Budget Actions (Priority: P3)

A user wants to quickly apply the same budgeting pattern across an entire selection. They select a range of category-month cells and choose from a set of bulk actions: copy values from the previous month, copy from a specific source month, set all selected cells to zero, apply a fixed amount, or apply a percentage adjustment. A preview of the proposed changes is shown before anything is staged.

**Why this priority**: Bulk actions are a key efficiency multiplier for the power-user audience. They reduce repetitive editing significantly for common budgeting workflows.

**Independent Test**: A user selects 10 cells spanning 2 months and 5 categories, chooses "Copy from previous month", sees a preview showing what the values will become, confirms, and all 10 cells are staged with the correct values derived from the previous month.

**Acceptance Scenarios**:

1. **Given** a rectangular cell selection, **When** the user invokes "Copy from previous month", **Then** a preview shows the proposed values and only after confirmation are they staged as a single undoable bulk operation.
2. **Given** a cell selection, **When** the user applies "Apply fixed amount" with a specified value, **Then** all selected cells are staged with that value, and the entire operation is undoable as one action.
3. **Given** a cell selection, **When** the user applies "Increase by X%", **Then** each selected cell's proposed value is the existing persisted value multiplied by the percentage, shown in preview before staging.
4. **Given** a bulk action has been staged, **When** the user presses undo, **Then** all cells from that bulk operation revert to their pre-action state in a single undo step.
5. **Given** "Fill empty values only" is applied to a selection, **When** the action runs, **Then** only cells currently showing zero or no budget value are staged; non-zero cells are unchanged.

---

### User Story 4 — CSV Export and Import (Priority: P4)

A user wants to plan next year's budget in a spreadsheet and then bring it back into Actual Bench. They first export their current budget data (choosing the month range and category scope) as a CSV with columns for group name, category name, and each selected month. They edit the file externally, then import it back. The import shows a preview of every change before staging, flags any rows that don't match known categories, and requires explicit approval for any suggested fuzzy matches. If an imported row references a month outside the currently visible range but present in the Budget Months API, the user is prompted to extend the range. If a row references a month that does not exist in the Budget Months API at all, it is rejected with a clear message.

**Why this priority**: CSV import/export is a high-value workflow for budget planning and migration. It is self-contained and testable independently of the grid.

**Independent Test**: A user exports 3 months of data, modifies 5 values in the CSV file, imports the modified file, sees a preview listing exactly 5 proposed changes with the correct before/after values, confirms, and those 5 cells appear as staged edits in the grid.

**Acceptance Scenarios**:

1. **Given** the user opens the export dialog and selects a month range and category scope, **When** they confirm, **Then** a CSV file is downloaded containing group name, category name, one column per selected month, and the current budgeted values for each cell.
2. **Given** the user imports a CSV file whose rows match categories by group name + category name, **When** import parsing completes, **Then** a preview lists every proposed change (old value, new value, month, category) before any staging occurs.
3. **Given** an imported CSV contains a row whose category name does not exactly match any known category, **When** the preview is shown, **Then** the system suggests the closest match and requires explicit user approval before including it; it does not silently apply the suggestion.
4. **Given** an imported CSV contains rows targeting a month that is in the Budget Months API but outside the currently visible range, **When** the preview is shown, **Then** those rows are flagged separately as "out of visible range" and the user is offered the option to extend the visible range to include them.
5. **Given** an imported CSV contains rows targeting a month that does not exist in `GET /months` at all, **When** the preview is shown, **Then** those rows are rejected with a clear "month not available in this budget" message and excluded from staging.
6. **Given** the user downloads a budget template, **When** they open it, **Then** it contains the correct group name, category name, and visible month columns, ready to fill in.

---

### User Story 5 — Envelope-Mode Category Transfers and Next-Month Hold (Priority: P5)

An envelope-budget user wants to cover overspending in one category by moving money from another, and separately wants to hold a portion of this month's surplus for next month. These actions are only visible to envelope-mode users. Unlike the staged budget-value edits that go through the main save review pipeline, transfers and holds are **immediate commands**: the user fills in the details, confirms, and the action is sent to the Budget Months API immediately. They do not wait for the main save panel. After completion, the grid refreshes the relevant month data from the API.

**Why this priority**: These actions are envelope-specific and self-contained. They provide critical workflow completeness for envelope users without affecting other stories.

**Independent Test**: An envelope-mode user can initiate a category transfer, see the source and destination amounts, confirm, and verify the transfer is recorded. A tracking-mode user does not see these controls at all.

**Acceptance Scenarios**:

1. **Given** the active budget mode is envelope, **When** the user views the page, **Then** category transfer and next-month hold actions are visible and accessible.
2. **Given** the active budget mode is tracking, **When** the user views the page, **Then** category transfer and next-month hold actions are not rendered anywhere on the page.
3. **Given** an envelope-mode user initiates a category transfer specifying a source category, a destination category, and an amount, **When** they confirm, **Then** the transfer is immediately sent to `POST /months/{month}/categorytransfers` (bypassing the staged editing pipeline), and on success the grid reloads the affected month's values from the API.
4. **Given** an envelope-mode user sets a next-month hold amount, **When** they confirm, **Then** the hold is immediately sent to `POST /months/{month}/nextmonthbudgethold` (bypassing the staged editing pipeline), and on success the month-level summary reflects the held amount.
5. **Given** a next-month hold is active, **When** the user clears the hold, **Then** `DELETE /months/{month}/nextmonthbudgethold` is called immediately, and the amount returns to the available-to-assign pool for the current month.
6. **Given** an envelope-mode user opens the transfer dialog, **When** they view the source and destination fields, **Then** only non-income spending categories are selectable; routing money to or from the available-to-budget pool (by omitting a source or destination) is not supported in v1.

---

### Edge Cases

- What happens when a user imports a CSV referencing categories that have since been deleted from the budget? → Import preview must flag those rows as unresolvable and exclude them from staging.
- How does the system handle a partial save where 8 of 10 staged operations succeed and 2 fail? → Save must complete all possible operations, report success/failure counts per cell, and allow retry for the failed ones. Because operations are cell-mapped, failures are always attributable to a specific category-month intersection.
- What if a month disappears from `GET /months` between when the page loaded and when the user saves? → Pre-save review must re-validate staged edits against a fresh call to `GET /months` and flag any that now target unavailable months.
- How are arithmetic expressions handled when a cell's current value has not yet loaded? → Arithmetic entry is deferred for cells whose persisted value is not yet available; the cell must load its current value before accepting relative expressions.
- What if the user navigates away with unsaved staged changes? → The system must warn the user that unsaved staged changes will be lost before allowing navigation.
- How should the system behave if a category transfer confirmation call fails mid-action? → The failure message must be surfaced immediately (these are immediate commands, not staged), and the grid must remain in its pre-transfer state until a successful response is received.

---

## Requirements *(mandatory)*

### Functional Requirements

**Grid and Navigation**

- **FR-001**: The page MUST display budget values in a grid organized by category group and category (rows) and month (columns) for the user-selected month range.
- **FR-002**: The page MUST discover available months by calling the Budget Months API (`GET /budgets/{budgetSyncId}/months`) and populate the month selector with only those months.
- **FR-003**: Users MUST be able to select which months are visible in the grid; selectable months are limited to those returned by `GET /budgets/{budgetSyncId}/months`.
- **FR-004**: The page MUST support keyboard navigation (arrow keys, Tab, Enter, Escape) across budget cells.
- **FR-005**: The page MUST display the active budget mode (envelope or tracking) prominently in the page header.
- **FR-006**: Each budget cell MUST display the budgeted amount only; spent and balance for the selected cell are shown in the context panel, not in the cell itself.

**Staged Editing**

- **FR-007**: All budget-value edits MUST be staged locally; no value is persisted to the server until the user explicitly confirms a save.
- **FR-008**: Staged (unsaved) cells MUST be visually distinct from persisted cells so users can immediately identify pending changes.
- **FR-009**: The page MUST support undo and redo; bulk operations MUST be treated as a single undoable unit.
- **FR-010**: Users MUST be able to discard all staged changes and return all cells to their last persisted state.
- **FR-011**: Budget cells MUST accept simple arithmetic expressions (addition, subtraction, multiplication, division with parentheses) and resolve them to a numeric value before staging.

**Selection and Grid Interactions**

- **FR-012**: Users MUST be able to make a rectangular cell selection spanning multiple categories and multiple months.
- **FR-013**: Users MUST be able to paste a copied rectangular selection of values starting from the top-left selected cell; the paste fills the corresponding rectangle from that anchor point and does not require the user to pre-select a target area of matching dimensions.
- **FR-014**: Users MUST be able to broadcast a single entered value to all cells in a multi-cell selection.

**Bulk Actions (v1)**

- **FR-015**: The page MUST support the following bulk actions on a selection: copy from previous month, copy from a selected source month, set to zero, apply a fixed amount, apply a percentage increase or decrease, clear values, fill empty values only.
- **FR-016**: Bulk actions MUST show a preview of all proposed changes before the user confirms staging.
- **FR-017**: Each confirmed bulk action MUST be staged as a single undoable operation.

**Review and Save**

- **FR-018**: Before saving, the page MUST show a review summary containing: total staged cell count, list of affected months, and an estimated count of individual `PATCH /months/{month}/categories/{categoryId}` calls to be issued.
- **FR-019**: The save process MUST persist each staged change by calling `PATCH /budgets/{budgetSyncId}/months/{month}/categories/{categoryId}` once per changed cell. Save operations MUST be issued sequentially or with explicit concurrency limiting — not as an unconstrained parallel flood — and each operation MUST be cell-mapped so that partial failures can be attributed to a specific category-month intersection.
- **FR-020**: For batch saves, the page MUST show progress, final success count, and failure count; failed items MUST be identifiable and retryable.
- **FR-021**: Pre-save review MUST flag: edits targeting months absent from the current `GET /months` response, and suspiciously large value changes where `abs(nextBudgeted − previousBudgeted) > 500,000 minor units` (equivalent to $5,000 at 100¢/$). In tracking mode, income-category edits are permitted without restriction (FR-023) and do not require a pre-save warning.

**Selection Summary**

- **FR-022**: While cells are selected, the page MUST display a live summary: selected month count, selected category count, number of selected cells with staged edits, and total staged delta for the current selection.

**Mode-Aware Behavior**

- **FR-023**: In tracking mode, income-category budget cells MUST be editable without restriction.
- **FR-024**: In envelope mode, income-category budget cells MUST be read-only. Users cannot edit budget amounts for income categories while in envelope mode.
- **FR-025**: Category transfer actions MUST only be shown when the active budget mode is envelope.
- **FR-026**: Next-month hold and clear-hold actions MUST only be shown when the active budget mode is envelope.

**Context Panel**

- **FR-027**: Selecting a category-month cell MUST populate a context panel showing: budgeted amount, spent amount, balance, carryover status (read-only), previous month budgeted value, and category group. Carryover is shown for reference only and is not editable in v1.
- **FR-028**: Month-level summary values (total budgeted, total spent, and for envelope mode: available to assign) MUST be visible for each displayed month column.

**CSV Export**

- **FR-029**: Users MUST be able to export budget data to a CSV file, selecting the month range and category scope.
- **FR-030**: The exported CSV MUST include columns for: category group name, category name, and one column per selected month containing the budgeted value.
- **FR-031**: Export MUST support a "staged view" option that includes pending staged values rather than only persisted values.
- **FR-032**: A downloadable blank budget template MUST be available, containing the correct group name, category name, and visible month column headers.

**CSV Import**

- **FR-033**: Users MUST be able to import a CSV file to stage budget value changes.
- **FR-034**: Import MUST match rows using category group name and category name; raw identifiers MUST NOT be used as the primary match key.
- **FR-035**: Import MUST show a full preview of all proposed changes (affected category, month, current value, proposed value) before any staging occurs.
- **FR-036**: Unmatched import rows MUST be flagged; the system MAY suggest a match but MUST require explicit user approval before applying any suggested match.
- **FR-037**: Import MUST never silently apply fuzzy or approximate matches.

**Month Availability**

- **FR-038**: The page MUST clearly communicate which months are available for editing; available months are those present in the response from `GET /budgets/{budgetSyncId}/months`.
- **FR-039**: The page MUST NOT attempt to create or materialize months absent from `GET /budgets/{budgetSyncId}/months`.
- **FR-040**: When a staged edit or imported row targets a month that is present in `GET /months` but outside the currently loaded visible range, the system MUST inform the user and offer to expand the visible range — it MUST NOT silently discard the edit.
- **FR-041**: When a staged edit or imported row targets a month that does not exist in `GET /months` at all, the system MUST reject the edit with a clear "month not available in this budget" message distinct from the out-of-range message above.

**Envelope-Mode Immediate Actions**

- **FR-042**: In envelope mode, users MUST be able to initiate a category transfer by specifying a source spending category, a destination spending category, and an amount. The transfer MUST be sent immediately to `POST /budgets/{budgetSyncId}/months/{month}/categorytransfers` upon confirmation — it does NOT enter the staged editing pipeline and does NOT appear in the main save review panel.
- **FR-043**: Category transfers in v1 MUST require both a source and a destination spending category. Routing money to or from the available-to-budget pool (by omitting source or destination) is not supported in v1.
- **FR-044**: In envelope mode, users MUST be able to set a next-month hold amount. The hold MUST be sent immediately to `POST /budgets/{budgetSyncId}/months/{month}/nextmonthbudgethold` upon confirmation — it does NOT enter the staged editing pipeline.
- **FR-045**: In envelope mode, users MUST be able to clear an existing next-month hold. The clear MUST be sent immediately to `DELETE /budgets/{budgetSyncId}/months/{month}/nextmonthbudgethold` upon confirmation.
- **FR-046**: After any immediate envelope action (transfer, hold, clear-hold) completes successfully, the grid MUST reload the affected month's category and summary values from the Budget Months API.

**Error Handling**

- **FR-047**: The page MUST display clear, user-readable messages for: invalid month format, months not found in the budget, Budget Months API access errors, and partial save failures.
- **FR-048**: Navigating away with unsaved staged changes MUST trigger a confirmation prompt warning the user that pending changes will be lost.

### Key Entities

- **Budget Month**: A single month period (YYYY-MM format) within a budget, containing aggregate values: total budgeted, total spent, total balance, and (in envelope mode) available to assign and next-month hold. Discovered via `GET /months`.
- **Category Group**: A named group containing one or more budget categories, with aggregated monthly totals for budgeted, spent, and balance.
- **Budget Category**: A named spending or income classification within a group, with per-month values for budgeted amount, spent amount, balance, and carryover setting. In v1, carryover is a read-only reference value; editing is deferred.
- **Budget Cell**: The intersection of one category and one month. Displays the budgeted amount only. Balance and spent are available in the context panel when the cell is selected.
- **Staged Edit**: A locally held proposed change to a budget cell's budgeted amount, not yet persisted to the server. Tracked by `month:categoryId` key.
- **Category Transfer**: An envelope-mode immediate action that moves a specified amount from one spending category's monthly budget to another, issued directly via the Budget Months API without going through the staged editing pipeline.
- **Next-Month Hold**: An envelope-mode immediate action that reserves a specified amount from the current month's available funds for the following month, issued directly via the Budget Months API without going through the staged editing pipeline.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can view and edit budget values for up to 12 consecutive months simultaneously in a single page view without navigating away.
- **SC-002**: A user completing a standard monthly budget review (checking last month, copying forward to current month, adjusting 5 or more categories) can finish the entire workflow in under 5 minutes.
- **SC-003**: Bulk operations (copy month, apply percentage, set to zero) on a selection of up to 100 cells display a preview and stage all values within 2 seconds of user confirmation.
- **SC-004**: All staged changes remain visible, reviewable, and discardable until the user explicitly triggers a save or chooses to discard — changes MUST survive page scroll, panel interactions, and filter changes.
- **SC-005**: A batch save of up to 50 staged changes completes with full per-cell success/failure reporting; no staged change is silently lost without user-visible feedback.
- **SC-006**: CSV export for up to 24 months of data across all categories produces a correctly structured downloadable file within 3 seconds.
- **SC-007**: CSV import of a file with up to 500 rows completes parsing, category matching, and preview generation within 5 seconds.
- **SC-008**: Envelope-mode category transfers and next-month hold actions are inaccessible (not rendered) to tracking-mode users, and tracking-mode income-category editing is always available without workflow interruption.
- **SC-009**: Immediate envelope actions (transfers, holds) complete or visibly fail within 3 seconds of user confirmation; the grid updates to reflect the result without requiring a full page reload.

---

## Assumptions

- The active budget mode (envelope or tracking) is known from the application's connection context before the user reaches this page; the page does not handle mode detection or switching.
- Month availability is determined entirely by `GET /budgets/{budgetSyncId}/months`; the page does not create or initialize months.
- Category and category group data (names, IDs, hierarchy) is available from the month-scoped Budget Months API responses and does not require a separate categories endpoint.
- Monetary amounts from the Budget Months API are integers in minor units (e.g., cents); the UI converts to and from a human-readable decimal representation.
- Carryover editing is out of scope for v1; carryover is displayed as a read-only value in the context panel only.
- Actual-spend trend analysis, historical multi-year averages, and scheduled-expense projections are out of scope for v1 and treated as optional future enrichments.
- Budget template or goal metadata is out of scope unless it becomes available through an existing application capability; no template editor is included in this page.
- The page is accessed by users who are already authenticated and connected to a specific budget.
- Average historical budget actions (copy month, apply percentage) provide sufficient bulk-action coverage for v1; rolling-average and forward-scaling actions are deferred.
- The page does not include a budget reporting or diagnostics surface; it is strictly a budget data management tool.
- Category transfers in v1 are strictly category-to-category; routing money to or from the available-to-budget pool by omitting source or destination is not supported and is explicitly deferred.

---

## Clarifications

### Session 2026-04-16

- Q: Is carryover an editable field in v1? → A: Read-only in v1 — shown in context panel only; editing deferred to a later iteration.
- Q: Should income-category budget cells be hard-blocked or warning-only in envelope mode? → A: Hard-blocked — income-category cells are read-only in envelope mode; no editing possible in v1.
- Q: What does a single budget cell display? → A: Budget amount only; balance and spent appear in the context panel when the cell is selected.
- Q: Does v1 include category transfers to/from the available-to-budget pool? → A: Category-to-category transfers only; pool routing (omitting source or destination) explicitly deferred to a later iteration.
