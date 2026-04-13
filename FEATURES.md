# Actual Bench — Feature Reference

## Connection Management

- Two-step connect flow: validate server credentials (URL + API key), then pick from the list of budgets returned by the server
- Save multiple server connections and switch between them with one click from the top bar
- Optional encryption password for end-to-end encrypted budgets
- Remove saved connections individually
- Per-connection query cache and staged data scoping — switching connections never leaks data between sessions
- Connections are stored in session storage and cleared automatically when the tab is closed

## Budget Overview

- `/overview` is the default landing page after connecting or reconnecting to a budget
- Compact snapshot row showing live saved-state metrics for transactions, accounts, payees, categories, schedules, and rules
- Derived snapshot context includes **Budget Mode** (`Envelope`, `Tracking`, or `Unidentified`) and **Budgeting since** from the oldest transaction date
- Manual refresh button with loading state and last-refreshed status
- Snapshot values switch to loading placeholders immediately during budget switching or manual refresh
- Main navigation hub for the connected budget with direct links to the core entity pages and ActualQL Queries
- Budget Diagnostics appears as a planned disabled tool card only — the diagnostics workspace is not implemented yet

## Rules

- Create, edit, and delete rules with a full condition/action builder
- Three execution stages: `pre`, `default`, `post`
- Conditions support AND / OR logic across fields: payee, imported payee, category, account, amount, notes, and more
- Operators include `is`, `is not`, `contains`, `matches`, `lt`, `lte`, `gt`, `gte`, `oneOf`, and others; the `matches` operator shows a regex syntax hint
- Actions include set payee, set category, set account, set amount, set notes, link schedule, and more
- Action template mode: toggle the `{}` button on any action to enter a Handlebars expression (e.g. `{{regex imported_payee 'foo' 'bar'}}`); templates are displayed in an amber monospace chip in the rules table
- Merge multiple selected rules into one via a dedicated merge dialog
- Duplicate a rule with one click
- Filter the rules list by stage, payee, or category
- Search resolves entity names in condition values — searching "Groceries" finds rules where a `oneOf` condition references that payee or category by ID
- Links from Payees and Categories pages filter the rules list to that entity automatically
- Resolved entity names displayed throughout (no raw IDs shown)
- Entity-reference chips (payee, category, account) are visually distinct from plain string value chips — blue for entity references, green for string values
- Category dropdowns group categories under their parent group, preserving server order; hidden categories and groups remain visible so rules referencing them can still be edited; search matches group names (shows all children) or category names
- CSV import and export

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
- Recurring schedules support daily, weekly, monthly, and yearly frequencies with a configurable interval
- Monthly schedules support pattern-based targeting: specific day of the month (including "last day"), or a weekday-of-week position (e.g. "2nd Friday")
- Weekend adjustment: when a scheduled date falls on a weekend, choose to move it to the nearest Friday (before) or Monday (after)
- End conditions: run forever, end after N occurrences, or end on a specific date
- Amount modes: exact (`is`), approximate (`is approx.`), or range (`is between`) with full amount and operator support
- Payee and account assignment per schedule (both optional)
- Auto-add toggle: when enabled, Actual Budget automatically posts a transaction when the schedule is due
- Linked rule display: each schedule has an underlying rule managed by the server; open it directly in the Rules editor via the "Edit as Rule" button in the schedule drawer
- Rules linked to schedules are shown read-only in the Rules table — the `link-schedule` action displays the resolved schedule name and cannot be created or edited manually
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

## Keyboard & Table UX

- Inline cell editing triggered by double-click, Enter, or F2
- Full keyboard navigation: arrow keys move between cells, Tab moves forward, Escape cancels
- Multi-select rows with checkboxes; select-all / deselect-all toggle in the header
- Bulk-add: add multiple empty rows at once with a configurable count
- Global undo/redo keyboard shortcuts: Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo; suppressed inside text inputs so native browser undo is not interrupted
- Filter bars stay pinned to the top of each table when scrolling long lists (Payees, Accounts, Categories, Tags)

## Navigation & Layout

- Collapsible sidebar with a standalone `Overview` item and grouped `Data Management` / `Tools` sections; collapse state persists across reloads
- Top bar shows the active connection with a switcher dropdown, undo/redo, discard, save, and a refresh button — refresh prompts for confirmation when unsaved changes exist
- Toast notifications for all success, error, and warning states
- Entity counts shown in page headers
- Help menu in the sidebar with links to the GitHub repository, issue tracker, and changelog
- Server version info shown at the bottom of the connection dropdown — displays `actual-http-api` and Actual Budget server versions when available

---

> Planned features and improvements are tracked in [`agents/future-roadmap.md`](agents/future-roadmap.md).
> When a roadmap item ships, add it to the relevant section above and let the merged PR title feed the next GitHub Release draft.
