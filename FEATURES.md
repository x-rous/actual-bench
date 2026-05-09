# Actual Bench — Feature Reference

## Connection Management

- Two-step connect flow: validate server credentials (URL + API key), then pick from the list of budgets returned by the server
- Save multiple server connections and switch between them with one click from the top bar
- Optional encryption password for end-to-end encrypted budgets
- Remove saved connections individually
- Per-connection query cache and staged data scoping — switching connections never leaks data between sessions
- Connections are stored in session storage and cleared automatically when the tab is closed

## Global Search

- `Ctrl/Cmd+K` or the top-bar Search button opens a global search modal across accounts, payees, categories, rules, schedules, and tags
- Results are grouped by entity type, capped per group, and ranked by exact, prefix, word-boundary, and substring matches
- Selecting a result navigates to the matching entity page with the row highlighted; search runs against already-loaded in-memory state without server writes

## Budget Overview

- `/overview` is the default landing page after connecting or reconnecting to a budget
- Compact snapshot row showing live saved-state metrics for transactions, accounts, payees, categories, schedules, and rules
- Derived snapshot context includes **Budget Mode** (`Envelope`, `Tracking`, or `Unidentified`) and **Budgeting since** from the oldest transaction date
- Manual refresh button with loading state and last-refreshed status
- Snapshot values switch to loading placeholders immediately during budget switching or manual refresh
- Main navigation hub for the connected budget with direct links to the core entity pages and ActualQL Queries
- Budget Diagnostics opens a read-only exported-snapshot workspace for inspecting budget health and raw SQLite data locally in the browser

## Budget Diagnostics

- Read-only diagnostics workspace for the active budget export; snapshot processing happens locally in the browser and no diagnostics changes are written back to the budget
- Top-level tabs for Overview, Diagnostics, and Data Browser keep the workspace full-width and focused on one task at a time
- Snapshot opening shows a staged progress rail with retry on export/open failures, plus a persistent privacy reminder that exported contents stay local but may include personal budget data
- Overview tab summarizes export metadata, snapshot counts, ZIP/database sizes, and source details, with a download action for the exported ZIP
- Diagnostics tab runs deterministic snapshot checks, summarizes finding severity, supports a long-running full SQLite integrity check, and exports findings to CSV
- Data Browser tab lists SQLite tables, views, indexes, and triggers grouped by Actual Budget domain; `v_transactions` is selected by default when present
- Paginated row browser fetches table/view rows through the SQLite worker with bounded page sizes, sticky headers, horizontal scrolling, worker-side sorting, and URL state for object, page, page size, sort column, and sort direction
- Full table/view CSV export streams rows through worker-owned cursors, preserves UTF-8 for Excel, neutralizes formula-like text values, keeps numeric negatives raw, and caps BLOB cells as base64 previews
- Schema tab shows object type, parent table where available, row count, inferred row key, columns, table indexes, and raw `CREATE ...` SQL from the exported SQLite schema
- Cell rendering keeps raw money-like integers, formats transaction dates and obvious budget months, displays boolean-ish integer fields compactly, marks BLOBs as binary with a hex preview tooltip, and preserves raw values in titles
- Row actions copy JSON to the clipboard, serializing BLOB fields as base64, and open a stackable row details panel in the side pane
- Relationship-aware drill-in turns known linked cells into navigable references, using the same relationship map as diagnostics; raw storage rows and featured-view rows are labeled separately in the details panel
- Indexes and triggers are listed as schema objects but clearly marked as not row-browsable

## Rules

- Create, edit, and delete rules with a full condition/action builder
- Rule editor starts new rules with a guided default condition (`Payee is`) and a default action row, but keeps validation neutral (no immediate error banners); required fields validate when rows are edited or save is attempted, with inline warnings for risky catch-all and destructive rule combinations
- Closing the rule drawer with unsaved edits prompts for confirmation instead of silently discarding the draft
- Deleting a rule from the drawer now uses the same confirmation flow as deleting from the rules table
- Three execution stages: `pre`, `default`, `post`
- Conditions support AND / OR logic across fields: payee, imported payee, category, account, amount, notes, and more
- Operators include `is`, `is not`, `contains`, `matches`, `lt`, `lte`, `gt`, `gte`, `oneOf`, and others; the `matches` operator shows a regex syntax hint
- Actions include set payee, set category, set account, set amount, set notes, link schedule, and more
- Action template mode: toggle the `{}` button on any action to enter a Handlebars expression (e.g. `{{regex imported_payee 'foo' 'bar'}}`); templates are displayed in an amber monospace chip in the rules table
- Merge multiple selected rules into one via a dedicated merge dialog
- Merge dialog now shares the same editor sections, row identity model, and validation behavior as the main rule drawer, avoiding combobox state jumps when rows are added or removed
- Duplicate a rule with one click
- Filter the rules list by stage, payee, or category
- Search resolves entity names in condition values — searching "Groceries" finds rules where a `oneOf` condition references that payee or category by ID
- Links from Payees and Categories pages filter the rules list to that entity automatically
- Resolved entity names displayed throughout (no raw IDs shown)
- Entity-reference chips (payee, category, account) are visually distinct from plain string value chips — blue for entity references, green for string values
- Category dropdowns group categories under their parent group, preserving server order; hidden categories and groups remain visible so rules referencing them can still be edited; search matches group names (shows all children) or category names
- CSV import and export

## Rule Diagnostics

- Dedicated `/rules/diagnostics` workspace, reachable via a Diagnostics button on the Rules page toolbar; bookmarkable URL
- Read-only and advisory: never modifies, stages, creates, or deletes any rule, entity, or configuration as a side effect of running diagnostics or interacting with a finding
- Runs against the user's current working set (server snapshot + unsaved staged edits) — lints the rules you are about to save
- Severity-grouped findings list with summary cards for `error`, `warning`, and `info` counts; severity- and code-based filtering with a "clear filters" affordance
- v1 checks: missing payee / category / account / category-group references, empty or no-op actions, impossibly contradictory conditions on `and`-rules, strictly shadowed rules within a stage, broad match criteria (very short `contains`/`matches`/`doesNotContain` values), duplicate rule groups, near-duplicate pairs (combined symmetric diff of 1–2 parts), and unsupported field/operator combinations
- Schedule-generated rules (those with a `link-schedule` action) are excluded from editor-relevant checks but still surface missing-entity findings
- Each finding includes a plain-language explanation, the affected rule's generated summary (stage + first condition + first action), and a copy-UUID button; clicking the rule summary jumps to `/rules?highlight=<id>` and the existing rule editor
- One-click Merge button on duplicate-group and near-duplicate findings opens the existing rule merge dialog pre-filled with the relevant rules; the "Delete originals" checkbox is pre-ticked for full duplicates and left unchecked for near-duplicates; on successful merge the user is returned to the diagnostics report so cleanup flows naturally; cancelling the merge leaves the user on the rules page
- Stale-results banner appears when the working set changes while the view is open; results stay visible until the user activates Refresh or returns to the route
- Deterministic and reproducible: repeated runs against the same working set produce identical findings, codes, and grouping
- Runs entirely in the browser against already-loaded data — no new backend endpoint, no network calls

## Accounts

- Create, rename, and delete accounts
- Budget type (on-budget / off-budget) is set at creation time via a toggle switch and displayed as a read-only badge thereafter — reflecting Actual Budget's constraint that account type cannot be changed after creation
- Current balance column shows the live account balance fetched via ActualQL aggregation, refreshed every 60 seconds; negative balances are highlighted in red
- Open and close accounts
- Inline editing: double-click, Enter, or F2 to edit; Escape to cancel
- Bulk select with bulk close, reopen, and delete
- Filter by name, status (open / closed / all), budget type (on / off / all), and whether an account has associated rules
- Sort by name, status, or budget type; staged (unsaved) rows are kept at the top of the list regardless of selected sort until saved
- Paste tab-separated data directly from Excel or Google Sheets
- CSV import and export
- Duplicate name detection with visual warning
- Rules count displayed per account — click it to jump to the rules list filtered to that account
- Accounts with notes show a note indicator beside the name; click it to open the read-only note text without leaving the table
- Every delete and close action (single and bulk) shows a confirmation dialog pre-populated with the account's outstanding balance, transaction count, and rule reference count before staging the mutation; accounts with non-zero balances receive an explicit warning about budget consistency
- Info button on each row opens the Usage Inspector drawer (see below)

## Payees

- Create, rename, and delete payees
- Transfer payees (auto-generated for inter-account transfers) shown as a separate filterable type
- Transfer payees show a disabled selection checkbox in the bulk-select column to make their non-selectable status explicit
- Rules count displayed per payee — click it to jump to the rules list filtered to that payee
- Filter by name, type (regular / transfer / all), and whether a payee has associated rules
- Bulk delete and bulk merge — select 2 or more regular payees, click Merge; the **first payee you check** becomes the merge target (survives) regardless of table sort order, the rest are absorbed; the operation is staged and shown in the Draft Changes panel as "Merge Deleted" before being sent to the server on Save; supports Ctrl+Z undo
- Inline editing with keyboard navigation
- CSV import and export
- Duplicate name detection with visual warning
- Every delete action (single and bulk) always confirms, showing the payee's transaction count and rule reference count — previously single deletes with no rule references skipped the confirmation entirely; transfer payees are excluded from bulk delete and counted separately in the dialog
- Info button on each regular payee row opens the Usage Inspector drawer (see below)

## Categories

- Create and manage category groups (income or expense type)
- Create categories within groups
- Category group reassignment opens an on-demand editor instead of rendering every group dropdown up front, keeping large category tables responsive when many groups are expanded
- Income categories stay locked to the single income parent group; only expense categories can be moved between groups
- Rename groups and categories inline
- Toggle visibility (hidden / visible) per category or per entire group
- Collapsible group rows — expand or collapse all groups with a single button
- Filter by name, type (income / expense / all), and visibility (visible / hidden / all)
- Sort by name
- CSV import and export with full group hierarchy preserved
- Duplicate group name prevention
- Categories and category groups with notes show a note indicator beside the name; click it to open the read-only note text inline from the table
- Every delete action confirms with an impact dialog: single category shows transaction count and rule references; group delete additionally shows the child category count and aggregated transaction count across all children with a cascade warning; bulk delete computes effective group and category sets, deduplicates implicit deletions, and aggregates totals
- Info button on each category and group row opens the Usage Inspector drawer (see below)

## Schedules

- Create, edit, and delete one-time and recurring schedules
- Saving an unchanged schedule closes the drawer without staging a draft update, and successfully saved schedule edits remain visible in the table while the background refresh reconciles server data
- Schedule amount editing always uses three modes only: Approx, Exact, and Range; missing/null server amounts are treated as approximate zero in the drawer and table
- Closing the schedule drawer with unsaved edits prompts for confirmation instead of silently discarding the draft
- Deleting a schedule from the drawer now uses the same impact-aware confirmation flow as deleting from the schedules table
- Recurring schedules support daily, weekly, monthly, and yearly frequencies with a configurable interval
- Monthly schedules support pattern-based targeting: specific day of the month (including "last day"), or a weekday-of-week position (e.g. "2nd Friday")
- Weekend adjustment: when a scheduled date falls on a weekend, choose to move it to the nearest Friday (before) or Monday (after)
- End conditions: run forever, end after N occurrences, or end on a specific date
- Amount modes: exact (`is`), approximate (`is approx.`), or range (`is between`) with full amount and operator support
- The schedules table uses a richer `Repeats` summary that includes inferred weekday/day anchors from the schedule start date (for example `Every 2 weeks on Wednesday` or `Monthly on the 1st`), and a compact `Recurring` column shows a checkmark for repeating schedules
- The schedule `completed` flag is retained in the data model for round-tripping server state, but the schedules UI no longer shows a visible Status column, status filter, or completed badge because that flag does not represent a reliable paid/completed business state
- Payee and account assignment per schedule (both optional)
- Auto-add toggle: when enabled, Actual Budget automatically posts a transaction when the schedule is due
- Linked rule display: each schedule has an underlying rule managed by the server; open it directly in the Rules editor via the "Edit as Rule" button in the schedule drawer
- Rules linked to schedules are shown read-only in the Rules table — the `link-schedule` action displays the resolved schedule name and cannot be created or edited manually
- Opening a schedule-linked rule in the drawer keeps a single editable `Payee is` row and a single editable `Account is` row (plus the schedule-managed conditions), and changes to those values stay in sync with the linked schedule draft
- Schedule-generated rules are excluded from bulk selection and cannot be merged; manage them from the Schedules page instead
- Filter schedules by name, payee, account, frequency, auto-add state, and completion status
- Bulk select with bulk delete
- CSV import and export
- Every delete action confirms with an impact dialog showing the schedule's linked rule status, auto-post flag, and transaction count; bulk delete aggregates totals across all selected schedules
- Info button on each row opens the Usage Inspector drawer (see below)

## Tags

- Create, rename, and delete tags (available since Actual Budget v26.3.0)
- Assign an optional color to each tag using a native color picker — click the color swatch to open the picker; hover the row to reveal a clear button
- Add an optional description per tag
- Inline editing: click any name or description cell to edit in place; Enter or Escape to confirm or cancel
- Filter by name or description, and by color presence (All / Has Color / No Color) with live counts per pill
- Bulk select with bulk delete
- Duplicate name detection with visual warning
- CSV import and export
- Info button on each row opens the Usage Inspector drawer; tags show the rules badge and a note that transaction data is not available for tags

## Budget Management Workspace

URL: `/budget-management`

A multi-month budget editing workspace with staged cell editing, a draft review panel, right-click bulk actions, CSV import/export, and envelope-mode immediate actions.

### Toolbar
- Budget mode badge (`Envelope`, `Tracking`, or `Unknown`) always visible at the left
- 12-month window navigator: back/forward by 1 month (`‹ ›`) or 1 year (`«»`), plus a "go to current year" calendar button; range label displays as "Jan '26 – Dec '26"
- Cell-view toggle: **Budget** / **Actuals** / **Balance** — switches what value each month cell displays
- Expand all / Collapse all group buttons
- Show / Hide hidden categories toggle
- Import and Export buttons (UTF-8 CSV with BOM)
- **Shortcuts** button (keyboard icon) opens the keyboard cheatsheet modal; also bound to `?`, `F1`, and `Ctrl/Cmd+/`

### Multi-Month Grid
- CSS-grid layout: category label column (flexible width) and one fixed-width column per visible month (12 columns); category and group name cells show a small inline `StickyNote` icon when a note exists for that entity
- Category and month header row is sticky — stays visible while scrolling down; category name column is sticky — stays visible while scrolling right; all sticky cells use solid opaque backgrounds to prevent bleed-through
- Group rows show aggregate totals per month; collapsed groups hide their category rows but keep the group total visible
- Mode-specific summary section above the category groups:
  - **Envelope mode**: Available Funds (+), Overspent Last Month (−), Budgeted (−), Hold for next month (−), and a **To Budget / Overbudget** (=) total row
  - **Tracking mode**: compact status rows for Result, Spending vs Budgeted, and Income. Past months show actual performance, the current month is marked partial, and future months show budgeted context instead of zero-actual performance.
- The 12-month window defaults to January of the current year; the user can navigate freely to any period

### Staged Cell Editing
- Click, double-click, Enter, or F2 to enter edit mode; blur or Enter to commit; Escape to cancel
- Accepts numeric amounts and arithmetic expressions (`+`, `-`, `*`, `/`, parentheses)
- Staged edits displayed in amber; reverting a cell back to its original server value automatically removes the staged edit (no phantom dirty state)
- Cells with a save error are highlighted in red with a red dot indicator; cells with a staged delta exceeding $5,000 show an orange dot indicator in the top-right corner
- Income categories are hard-blocked (non-interactive) in envelope mode
- Undo / Redo with Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; up to 50 undo steps
- Delete or Backspace on a focused cell sets it to zero; if the original value is already zero the staged edit is removed
- **Pre-save balance cascade** — staging a budget edit in month M immediately updates the *effective* per-category balance for all visible and future months (M+1, M+2, …) without writing to the server. In envelope mode this applies to every spending category (the server always chains `balance(M) = budgeted(M) + actuals(M) + balance(M−1)`); in tracking mode only categories with `carryover = true` cascade. Any month fetched later by scrolling forward automatically receives the correct cascade delta because it is derived purely from the in-memory staged edits map.

### Selection & Keyboard Shortcuts

Spreadsheet-grade keyboard support — every shortcut is data-driven from a single keymap table, surfaced in a `?`-triggered cheatsheet modal, and scope-aware so editing a cell never collides with workspace shortcuts.

**Selection (mouse + click):**
- Click a cell to select it; Shift+click to extend a rectangular multi-cell selection
- Drag from cell to cell to select a rectangle; the first column (category / group label) is also selectable for row-aggregate views in the details panel
- Clicking outside the grid (toolbar, sidebar, top bar), or clicking non-interactive areas inside the grid (summary rows, section headers, group row gutters, column headers), clears the current selection and shows the period summary in the details panel

**Navigation:**
- Arrow keys move the cursor between cells; Tab / Shift+Tab move forward / backward and wrap across rows
- `PageUp` / `PageDown` move ten rows at a time
- `Home` / `End` (or `Ctrl/Cmd+←` / `Ctrl/Cmd+→`) jump to the first / last month in the current row
- `Ctrl/Cmd+Home` / `Ctrl/Cmd+End` jump to the top-left / bottom-right cell of the grid
- `Ctrl/Cmd+↑` / `Ctrl/Cmd+↓` jump to the previous / next group section header

**Range extension:**
- `Shift+Arrow`, `Shift+PageUp/Down`, `Shift+Home/End`, `Ctrl/Cmd+Shift+Arrow`, `Ctrl/Cmd+Shift+Home/End` — same jumps as the cursor moves above, but extend the selection rectangle instead of moving the cursor

**Editing:**
- `Enter`, `F2`, or any digit / `+` / `-` / `.` / `(` enters edit mode (the typed character pre-fills the input)
- Inside the input: `Enter` commits and moves down, `Tab` / `Shift+Tab` commit and move sideways, `Escape` cancels
- `Delete` / `Backspace` zeroes the focused cell (multi-cell selection zeroes every selected cell as one bulk edit)

**Range-edit (workspace):**
- `Ctrl/Cmd+Enter` — fill the entire selection with the anchor cell's value
- `Ctrl/Cmd+D` — fill down: copy the top row of the selection into all rows below
- `Ctrl/Cmd+R` — fill right: copy the leftmost column of the selection across to the right
- `Alt+L` — fill the selection with each row's previous-month value (wraps the existing copy-previous-month bulk action; uses TanStack Query cache for prior months outside the visible window)
- `Alt+A` — fill the selection with each row's 3-month average

**Clipboard:**
- `Ctrl/Cmd+C` — copy the selection rectangle as tab-delimited text (round-trips cleanly via Excel / Google Sheets)
- `Ctrl/Cmd+V` paste — fills the selection from a single value, or expands a multi-cell paste from the anchor

**View & visibility:**
- `V` — cycle Budget → Actuals → Balance
- `F` — open Jump to Category search; selecting a match scrolls and focuses that category in the current month, including hidden categories and collapsed groups
- `H` — toggle hidden categories
- `E` / `Shift+E` — expand all / collapse all groups
- `[` / `]` — pan the visible 12-month window backward / forward by one month
- `Space` (on a group label or group month aggregate) — toggle that group's collapse state

**Selection actions:**
- `Alt+C` — toggle carryover (rollover) on the anchor's category across the selected month range; opens the same progress dialog as the right-click menu

**History:**
- `Ctrl/Cmd+Z` — undo
- `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` — redo

**Help:**
- `?` (or `F1`, `Ctrl/Cmd+/`, or the toolbar Shortcuts button) opens a two-column cheatsheet modal generated directly from the keymap — adding a future shortcut surfaces it here automatically. Renders `⌘`/`⌥`/`⇧` glyphs on macOS and `Ctrl`/`Alt`/`Shift` text elsewhere

Bare-letter shortcuts (`V`, `F`, `H`, `E`, `[`, `]`) are scoped so they never fire while typing in a cell input or modal search field.

### Right-Click Context Menu
- Right-clicking any category budget cell opens a compact context menu with two sections:
  - **Cell actions** (mode-aware):
    - **Tracking mode only**: Enable / Disable Rollover (carryover) — applies from the right-clicked month forward
    - **Envelope mode only**: Cover Overspending (when the category balance is negative) or Transfer to Another Category (when positive) — opens the staged transfer dialog
  - **Set Budget**: inline bulk actions — Copy previous month, Copy specific month…, Set to zero, Set to fixed amount…, Apply % change…, Avg. 3-month budget, Avg. 6-month budget, Avg. 12-month budget
- No-input actions (copy previous, set to zero, the three averages) execute immediately and are staged as one undo step; input-required actions (copy specific month, set fixed, apply %) open a two-step dialog (parameters → preview)
- Average actions use the **budgeted** amount from each prior month (not actual spending); they look back N months using TanStack Query cache — pre-window months are included if previously loaded
- Selecting a new cell or group dismisses the context menu

### Budget Details Panel (right side)
- **Staged changes badge**: when one or more edits are pending, an amber "N changes" / "1 change" badge appears in the panel header next to "Budget Details". Clicking it opens a panel-anchored overlay listing all staged changes grouped by month — transfer pairs appear as a single linked row; standalone edits show category name, month, and signed delta. The badge disappears automatically when all changes are saved or discarded. Category names are resolved from the TanStack Query cache; no new network requests are made when opening the overlay.
- **Period Summary** (default, when no category or group is selected): shows the active 12-month range, budget mode, coverage split between actualized/current/future months, one mode-aware primary status, and one compact trend. Tracking mode separates Actuals to date, Budget to date, and Full 12-month plan; future months are muted as plan-only and never counted as zero-actual savings. Envelope mode shows current/ending To Budget or Overbudget status, end-of-visible-plan To Budget when future months exist, and period values such as Assigned / Budgeted, Spent to date, Income received to date, and Hold for next month.
- **Category or group label selected**: the panel switches to the selected row across the visible 12-month period. Tracking mode uses planning language (over/under plan, actual vs budget to date, full-period budget, averages to date) and does not use Balance as the primary group/category concept. If rollover/carryover applies, Tracking adds Current, Ending, or Planned Rollover Balance without summing balances across months. Tracking also shows a **Monthly average** (full 12-month budgeted ÷ 12) beneath the full-period budget figure. Envelope mode uses allocation language (Current Balance, Planned Balance, Assigned / Budgeted, Spent to date, Carryover where available) and never sums balances across months. If a note exists for the selected category or group, a **Note** section is shown at the bottom of the panel.
- **Category or group month cell selected**: the panel switches to compact selected-month details. Tracking shows month status, budgeted, actuals, variance, rollover balance when applicable, and previous month budget when available; future months are plan-only and do not show fake under-plan results. Envelope shows Current Balance for actualized/current months, Planned Balance for future months, selected-month assigned/spent/balance, and carryover where available. If a note exists for the selected category × month combination, a **Note** section is shown at the bottom of the panel.
- **Staged Changes** appears only when staged edits affect the visible period and current selection. Month-cell selections scope staged impact to the selected month and row. Tracking shows budget plan impact; Envelope shows Estimated To Budget impact and notes that final balances recalculate after save.
- All notes are fetched in a single bulk ActualQL `SELECT *` from the `notes` table and cached for 5 minutes — no per-entity network calls are made when selecting cells or row labels.

### Clipboard Paste
- Paste tab-delimited data from spreadsheets into the grid starting from the top-left selected cell; fills the corresponding rectangle without requiring pre-selection of exact dimensions

### Save Flow
- Clicking Save first opens a compact review summary grouped by month with total change count, affected month count, and net budget delta; users can skip this review on future saves
- Confirming the review opens a non-dismissable progress dialog that processes edits sequentially (never in parallel) to avoid server race conditions: complete transfer pairs are sent first via the atomic `POST /months/{month}/categorytransfers` endpoint (one request per pair); remaining standalone edits and any incomplete transfer legs are sent as individual `PATCH /months/{month}/categories/{id}` requests
  - In-progress state: "Saving budget changes — N of M cells saved…" with a live progress bar
  - All-success state: cell count and affected months; dialog auto-closes after 3 seconds (manual close also available)
  - Partial or full failure state: amber header with a scrollable list of failed cells (month / category ID / error message); "Retry Failed" button re-reads only the still-failed keys from the store and re-sends them
- Failed cells always remain in the store with their `saveError` set — only cells that received a 200 response are cleared; TanStack Query cache is invalidated per succeeded month

### CSV Export
- Three month-selection modes in the export dialog:
  - **Quick Range**: preset buttons — Current View, This Month, Last 3 Months, This Year, Last Year, All — each showing a live count badge; Current View is pre-selected on open
  - **Date Range**: From / To dropdowns constrained to available months; auto-corrects if From > To
  - **Select**: searchable multi-select combobox (same component as Rules payee picker) — search and pick individual months as chips; only existing months are selectable
- Always-visible resolution summary: "N months selected: Jan '26 – Dec '26" updates live as the selection changes
- Options: include hidden categories, include income groups, export with staged (unsaved) values
- Download blank CSV template (same structure, all amount cells empty)
- Exported files include a UTF-8 BOM for correct rendering in Excel and Google Sheets

### CSV Import
- Upload a CSV file → parser strips UTF-8 BOM if present → review exact / suggested / unmatched rows with approval checkboxes → preview proposed changes with before/after values → confirm → all changes staged in the grid as one undo step
- Levenshtein-distance fuzzy matching (distance ≤ 2) offers suggestions for near-miss category names
- Out-of-range months (exist in budget but outside the current 12-month window) shown with an "Extend visible range" option; absent months (not in `GET /months`) rejected with a clear error

### Envelope-Mode Immediate Actions
- **Hold toggle**: each "To Budget" cell in the summary section has a hold toggle button (arrow icon, left of the amount). Clicking it when no hold is active opens the "Next Month Hold for YYYY-MM" dialog to set an amount; the dialog closes immediately on save. Clicking it when a hold is active shows a confirmation dialog ("Free the hold for YYYY-MM?") before clearing. Both actions are immediate and bypass the staged save panel
- Hold is only available in envelope mode; it does not appear in tracking mode

### Envelope-Mode Staged Transfers
- Right-click any spending category cell → **Cover Overspending** (negative balance) or **Transfer to Another Category** (positive balance) → opens the staged transfer dialog
- **Cover Overspending**: picks the destination automatically (the right-clicked, overspent category); user selects a source from a grouped category combobox filtered to categories with available balance, and enters the amount (pre-filled to the overspending amount, capped at the source's available balance)
- **Transfer to Another Category**: the right-clicked category is the source; user selects a destination from the full category combobox and enters an amount (pre-filled to the source's full balance, capped there)
- Both legs are staged together as a single undo step under a shared `transferGroupId`; the draft panel renders the pair as one linked row ("Transfer  From → To  +$amount")
- The effective balance shown in the combobox is staged-aware — if a prior edit already affects a category's budgeted amount, the displayed balance reflects that
- On save, complete transfer pairs are sent via the atomic `POST /months/{month}/categorytransfers` endpoint; standalone edits and incomplete legs use the existing `PATCH` path. This prevents "onFinish inside spreadsheet transaction" errors that occur when two PATCHes for the same transfer race the server's internal recalculation

### Navigation Safety
- Browser close / refresh prompts confirmation when staged changes exist (`beforeunload`)
- Browser back/forward navigation prompts confirmation when staged changes exist (`popstate`)
- Entry guard: if unsaved entity changes exist on another page, the workspace shows a blocking screen with a "Discard changes and continue" option rather than silently mixing two edit stores

### v1 Limitations
- Carryover is read-only in this release; shown in the context panel but not editable via the grid (toggle via the right-click menu in tracking mode)
- Category-to-pool transfers (omitting source or destination category) are not supported in v1
- No virtualization; very large category lists may scroll slowly in the grid

## ActualQL Queries

- Dedicated query workspace for running arbitrary ActualQL JSON queries against the open budget
- Resizable editor / results split — drag the divider to adjust the balance; position persists across reloads via session storage
- Syntax-highlighted JSON editor with line numbers, current-line highlight, and JetBrains Mono font; edit raw JSON directly with no normalization or auto-correction
- Action bar: Run (or Ctrl/Cmd+Enter), Format JSON, Save, Explain, and ActualQL Reference buttons
- Parse errors shown inline beneath the editor before any network request is made
- Lint warnings for risky query shapes — broad `transactions` queries with no `limit`, `groupBy`, or `calculate`; empty `$oneof`; `groupBy` with no aggregate; and more
- Four result views selectable via tabs:
  - **Table** — columns derived from the union of keys across all rows; nested values JSON-stringified; capped at 500 rows with a warning banner
  - **Raw JSON** — syntax-highlighted with line numbers; full returned payload
  - **Scalar** — large value card for `calculate` aggregate results
  - **Tree** — collapsible recursive JSON tree; auto-selected for plain-object results; nodes with more than 5 children start collapsed
- Smart cell formatting in the table view: ISO date strings displayed as human-readable dates (e.g. `Jan 15, 2024`); `amount` and `balance` integer columns formatted as decimal values (cents ÷ 100); raw value always accessible via hover tooltip
- Execution metadata bar: OK / Error status chip, elapsed time, row count, and payload size shown inline with the result actions
- Result actions: Copy result JSON, Copy query JSON, Copy sanitized cURL (secrets replaced with placeholders), and Copy full cURL (opt-in, clearly marked as containing real credentials)
- cURL is always generated from the last successfully executed request, not the current editor state
- **Explain this query** — one-click plain-English summary of what the current query does: target table, filters, grouping, aggregation, ordering, and whether the result is tabular or scalar
- **ActualQL Reference** dialog — six-section quick reference covering basics, filter operators, joined fields, aggregates, transactions-specific options, and copyable snippets
- Built-in example packs in four groups (Data inspection, Cleanup & validation, Aggregation, Targeted subset) — one-click insert into the editor
- Saved queries — name and save any query locally per budget; load, rerun, duplicate, rename, delete, and pin as favorite
- Query history — last 10 executed queries stored per budget in session storage; one-click reload into the editor; deduplicated (re-running the same query bumps it to the top rather than adding a duplicate)
- Favorites — pin saved queries for fast access; shown at the top of the saved queries panel
- Banner warns when unsaved staged changes exist — query results reflect saved server state, not pending local edits
- Results bypass the staged store entirely; no mutations are introduced by running a query

## Delete Safety & Usage Inspector

### Confirmation dialogs

Every destructive action across all entity tables — single delete, bulk delete, single close, and bulk close — is intercepted by a confirmation dialog before any staged mutation is applied. Dialog messages are context-aware and tiered based on the available impact data:

- **Transaction count**: how many existing transactions reference the entity being deleted or closed; fetched on demand via a single ActualQL `$oneof` query per action and cached for 30 seconds to avoid redundant network calls on rapid re-opens
- **Rule references**: how many non-deleted staged rules reference the entity via their conditions or actions; computed locally from the in-memory rule store
- **Balance** (accounts): outstanding balance at the time the action is triggered; non-zero balances produce an explicit consistency warning
- **Child count** (category groups): number of non-deleted child categories; group deletes always show a cascade warning

Loading states are reflected in the dialog message in real time — if the transaction count query is still in flight when the dialog opens, the copy shows "Checking usage…" and updates once the count arrives.

### Usage Inspector drawer

An Info button on every entity row opens a right-side drawer that displays a complete usage profile for that entity without triggering a delete flow:

- **Stats row**: Rules badge (always visible), Transactions badge (all types except tags; shows "…" during loading), Balance badge (accounts; amber when non-zero), Categories badge (category groups only)
- **Impact section**: pre-built warning strings describing the consequences of deletion, shown only when there is meaningful content to surface
- **Empty state**: "No known references found." when all counts are zero and no warnings apply — including category groups with no children
- **Quick links**: "View rules →" navigation shortcut for accounts, payees, and categories that have rule references, filtered to that entity on the rules page
- **Tags**: transaction data is not available for tags; the drawer shows the rules badge and an explanatory note

Transaction counts are fetched lazily when the drawer opens, gated by the same `enabled` flag used in confirm dialogs. Category groups query by child category IDs and aggregate the counts. New (unsaved) entities are excluded from the query since no server transactions exist for them yet.

## Staged Editing

- All changes (creates, updates, deletes) are held locally until explicitly saved — nothing touches the server until you confirm
- Colour-coded rows: green = new, amber = updated, strikethrough = deleted, red = validation error
- Save all staged changes to the server in one action from the top bar
- Discard all staged changes to revert to the last server state
- Full undo / redo history for all staged edits within a session
- Refresh reloads data from the server — if unsaved changes exist, a confirmation prompt lets you choose to discard them and continue, or cancel

## CSV Import / Export

- Every entity page (Rules, Accounts, Payees, Categories, Tags) has Export and Import buttons
- Exported files are UTF-8 CSV with BOM for correct Excel / Google Sheets rendering
- Imported rows are staged — nothing is saved until you click Save
- 5 MB file size limit with per-row validation and skip reporting on import
- Sample CSV files included in `public/samples csv/` for testing with a fresh Actual Budget setup:

| File | Contents |
|---|---|
| `sample-accounts.csv` | 7 accounts covering `offBudget` and `closed` flag combinations |
| `sample-payees.csv` | 15 common payees |
| `sample-categories.csv` | 8 groups and 25 categories across income, housing, food, transport, health, and more |
| `sample-rules.csv` | 10 rules demonstrating multi-condition, multi-action, `or` logic, stage filtering, and payee auto-creation |
| `sample-schedules.csv` | 6 schedules — one-time, monthly, weekly, yearly, and range-amount examples |
| `sample-tags.csv` | 8 tags with varied colors and descriptions |

### CSV Formats

**Accounts** — columns: `name` (required), `offBudget`, `closed`

**Payees** — columns: `name` (required)

**Tags** — columns: `name` (required), `color` (optional hex, e.g. `#FF5733`), `description` (optional)

**Schedules** — columns: `name` (optional), `date` (required — ISO date `YYYY-MM-DD` for one-time, or JSON-encoded RecurConfig for recurring), `amount` (optional, in cents — use `num1|num2` for `isbetween`), `amountOp` (optional: `is`, `isapprox`, `isbetween`), `payee` (optional name), `account` (optional name), `posts_transaction` (optional bool)
> The `completed` column is ignored on import — all imported schedules start as active.

**Categories** — columns: `type` (required: `group` or `category`), `name` (required), `group`, `is_income`, `hidden`
> Group rows must appear before the category rows that reference them.

**Rules** — long format, one condition/action per row:

| Column | Description |
|---|---|
| `rule_id` | Grouping key — all rows sharing the same ID form one rule |
| `stage` | `pre`, `default`, or `post` |
| `conditions_op` | `and` or `or` |
| `row_type` | `condition` or `action` |
| `field` | Field name (e.g. `imported_payee`, `payee`, `category`, `amount`) |
| `op` | Operator (e.g. `is`, `contains`, `lt`, `oneOf`) |
| `value` | Value — use `\|` as separator for multi-value `oneOf` operators |

## Bundle Export / Import

Available from the **Budget Overview** page (`Export` / `Import` buttons in the page header).

### Bundle Export

- Opens a dialog listing all six entity types — Accounts, Payees, Categories & Groups, Tags, Schedules, Rules — with checkboxes pre-selected; live entity counts displayed per type
- Entity data is loaded on demand when the dialog opens, so exporting from the Overview page (which intentionally skips preloading) always reflects current server state
- Inline dependency warnings appear dynamically as selections change:
  - Selecting **Rules** without Payees, Categories, or Accounts produces a portability warning
  - Selecting **Schedules** without Payees or Accounts produces a portability warning
- Download produces a single ZIP file named `budget-bundle-<label>-<YYYY-MM-DD>.zip`; each entity type is a separate UTF-8 CSV with BOM using the same format as the per-page exports

**ZIP contents:**
```
budget-bundle-<label>-<date>.zip
  ├── accounts.csv
  ├── payees.csv
  ├── category-groups-and-categories.csv
  ├── tags.csv
  ├── schedules.csv
  └── rules.csv
```

### Bundle Import

- Accepts a `.zip` file produced by Bundle Export (partial bundles with a subset of CSVs are valid)
- Preview step shows each detected entity type with its row count before any staging occurs
- Import processes entity types in dependency order — categories first, rules last — so that name→ID resolution for Schedules and Rules picks up Accounts and Payees staged earlier in the same operation
- All imported rows are staged; nothing is saved until the user clicks Save in the top bar
- Result summary shows staged count, skipped count, and any parse errors per entity type; quick-navigation links jump directly to each entity page to review the staged rows
- A single undo step covers the entire bundle import

## Keyboard & Table UX

- Inline cell editing triggered by double-click, Enter, or F2
- Accounts, Payees, Categories, and Tags now share one inline text editor with immediate focus-on-open and consistent commit/cancel keyboard behavior
- Full keyboard navigation: arrow keys move between cells, Tab moves forward, Escape cancels
- Multi-select rows with checkboxes; select-all / deselect-all toggle in the header
- Disabled bulk-selection checkboxes use dimmed styling with explanatory tooltips for system-managed rows
- Row action buttons appear on hover or keyboard focus, and remain visible on rows with save errors or delete/revert recovery actions
- Bulk-add: add multiple empty rows at once with a configurable count
- Global undo/redo keyboard shortcuts: Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo; suppressed inside text inputs so native browser undo is not interrupted
- Filter bars stay pinned to the top of each table when scrolling long lists (Payees, Accounts, Categories, Tags)

## Navigation & Layout

- Collapsible sidebar with a standalone `Overview` item and grouped `Data Management` / `Tools` sections; collapse state persists across reloads
- Top bar shows the active connection with a switcher dropdown, undo/redo, discard, save, and a refresh button — refresh prompts for confirmation when unsaved changes exist
- Toast notifications for all success, error, and warning states
- Entity counts shown in page headers
- Help menu in the sidebar with links to the GitHub repository, issue tracker, and changelog
- Top bar shows a compact version cluster beside the active connection with `API` and `Actual` version badges when available

---

> Planned features and improvements are tracked in [`agents/future-roadmap.md`](agents/future-roadmap.md).
> When a roadmap item ships, add it to the relevant section above and let the merged PR title feed the next GitHub Release draft.
