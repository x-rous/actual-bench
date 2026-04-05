# Actual Bench — Feature Reference

## Connection Management

- Two-step connect flow: validate server credentials (URL + API key), then pick from the list of budgets returned by the server
- Save multiple server connections and switch between them with one click from the top bar
- Optional encryption password for end-to-end encrypted budgets
- Remove saved connections individually
- Per-connection query cache and staged data scoping — switching connections never leaks data between sessions
- Connections are stored in session storage and cleared automatically when the tab is closed

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
- Links from Payees and Categories pages filter the rules list to that entity automatically
- Resolved entity names displayed throughout (no raw IDs shown)
- Category dropdowns group categories under their parent group, preserving server order; hidden categories and groups remain visible so rules referencing them can still be edited; search matches group names (shows all children) or category names
- CSV import and export

## Accounts

- Create, rename, and delete accounts
- Toggle on-budget / off-budget status per account
- Open and close accounts
- Inline editing: double-click, Enter, or F2 to edit; Escape to cancel
- Bulk select with bulk close, reopen, and delete
- Filter by name, status (open / closed / all), and budget type (on / off / all)
- Sort by name, status, or budget type
- Paste tab-separated data directly from Excel or Google Sheets
- CSV import and export
- Duplicate name detection with visual warning

## Payees

- Create, rename, and delete payees
- Transfer payees (auto-generated for inter-account transfers) shown as a separate filterable type
- Rules count displayed per payee — click it to jump to the rules list filtered to that payee
- Filter by name, type (regular / transfer / all), and whether a payee has associated rules
- Bulk delete
- Inline editing with keyboard navigation
- CSV import and export
- Duplicate name detection with visual warning

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

## Staged Editing

- All changes (creates, updates, deletes) are held locally until explicitly saved — nothing touches the server until you confirm
- Colour-coded rows: green = new, amber = updated, strikethrough = deleted, red = validation error
- Save all staged changes to the server in one action from the top bar
- Discard all staged changes to revert to the last server state
- Full undo / redo history for all staged edits within a session
- Refresh reloads data from the server — if unsaved changes exist, a confirmation prompt lets you choose to discard them and continue, or cancel

## CSV Import / Export

- Every entity page (Rules, Accounts, Payees, Categories) has Export and Import buttons
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

### CSV Formats

**Accounts** — columns: `name` (required), `offBudget`, `closed`

**Payees** — columns: `name` (required)

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
- Fill-down: select multiple rows and fill the same value across all of them
- Bulk-add: add multiple empty rows at once with a configurable count

## Navigation & Layout

- Collapsible sidebar with navigation links to all sections; collapse state persists across reloads
- Top bar shows the active connection with a switcher dropdown, undo/redo, discard, save, and a refresh button — refresh prompts for confirmation when unsaved changes exist
- Toast notifications for all success, error, and warning states
- Entity counts shown in page headers
- Help menu in the sidebar with links to the GitHub repository, issue tracker, and changelog
- Server version info shown at the bottom of the connection dropdown — displays `actual-http-api` and Actual Budget server versions when available

---

> Planned features and improvements are tracked in [`agents/future-roadmap.md`](agents/future-roadmap.md).
> When a roadmap item ships, add it to the relevant section above and log it in [`CHANGELOG.md`](CHANGELOG.md).
