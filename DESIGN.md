# Actual Bench — UI/UX Design Guidelines

> **Purpose:** Help designers and coding agents build Actual Bench interfaces that are visually cohesive, efficient, understandable, and safe for financial work.
>
> **Applies to:** New features and intentionally redesigned UI. **Not:** a feature roadmap, architecture document, or a mandate to redesign existing screens.
>
> **Verified references:** [x-rous/actual-bench](https://github.com/x-rous/actual-bench), `main` at [`f9d1fc65`](https://github.com/x-rous/actual-bench/commit/f9d1fc65ac623bb3115772325d54ac102fee087c), checked 18 October 2026 (package v1.3.7). Recheck source before relying on measurements or behavior.

**Read this first — agent contract**

1. **The user request and approved feature-specific requirements define scope.** This document guides the design, not the feature's business behavior.
2. **Preserve capabilities, not poor layouts.** Keep required information, actions, keyboard flows, financial meaning, and save boundaries; freely improve hierarchy and ergonomics within the requested scope.
3. **Inspect existing code and nearby screens.** Reuse established components; do not blindly copy an existing weakness.
4. **Choose the smallest effective pattern.** A compact inspector, editor drawer, modal, and full workspace serve different purposes.
5. **Design the states, not just the happy path.** Include empty, loading, selected, changed, invalid, partial failure, and read-only states as applicable.
6. **Do not expand scope silently.** Propose unrelated improvements separately rather than implementing them while redesigning one feature.

**Reading key:** **Current** = verified behavior at the above commit (not necessarily ideal); **Standard** = design guidance for new or changed UI; **Proposal** = option requiring product approval. Unqualified rules in this document are **Standards**. Product decisions and active feature specifications take precedence; highlight conflicts instead of guessing.

## Contents

1. [Experience principles](#1-experience-principles)
2. [Visual language](#2-visual-language)
3. [Layout and component selection](#3-layout-and-component-selection)
4. [Data tables and grids](#4-data-tables-and-grids)
5. [Interactions and financial trust](#5-interactions-and-financial-trust)
6. [Keyboard, focus and accessibility](#6-keyboard-focus-and-accessibility)
7. [Financial data, charts and localization](#7-financial-data-charts-and-localization)
8. [Responsive behavior](#8-responsive-behavior)
9. [Canonical design examples](#9-canonical-design-examples)
10. [Agent workflow and review checklist](#10-agent-workflow-and-review-checklist)
11. [Reference map and maintenance](#11-reference-map-and-maintenance)

---

## 1. Experience principles

Actual Bench is a **desktop-first, data-dense companion to Actual Budget**. It is a workbench for reviewing, configuring, modelling and safely operating on financial data — not a marketing dashboard or a replacement for routine transaction entry.

### 1.1 Design priorities (in order)

1. **Correctness and trust:** Make provenance, financial meaning, assumptions, changed state, and consequences unmistakable.
2. **Task clarity:** The user should know *where they are*, *what needs attention*, and *what action comes next*.
3. **Efficiency:** Optimize repeated work with scanning, keyboard use, fast filters, bulk operations and minimal context switching.
4. **Useful density:** Show enough information to decide, without scattering related facts across cards and dialogs.
5. **Polish:** Use deliberate hierarchy, spacing, alignment, typography, and restrained accent colors; sophistication comes from composition, not decoration.
6. **Consistency:** Similar jobs should feel familiar, while genuinely different jobs may use different layouts.

### 1.2 Visual decision test

Before adding any element, ask:

- Does it help users **orient**, **compare**, **decide**, **act**, or **verify**?
- Is its information important *now*, or better disclosed contextually?
- Does its size/contrast reflect actual importance, or merely make the interface louder?
- Could a user scan the screen in five seconds and identify the primary task?
- Can an experienced user complete repetitive work without unnecessary pointer movement?

**Avoid:** oversized marketing headings, unrelated KPI cards, decorative gradients, five competing actions, dense paragraphs explaining every control, and empty space achieved by hiding necessary information.

### 1.3 Improvement, not mechanical uniformity

- Match the **visual language**, but adapt layout to the job: a loan simulator is not an accounts table.
- Don't preserve a confusing interaction solely because another screen also uses it.
- Keep meaningful detail visible; use progressive disclosure for advanced configuration, not for information required to make a correct decision.
- Distinguish **saved**, **staged**, **suggested**, **projected** and **applied** everywhere these states appear.

---

## 2. Visual language

### 2.1 Personality and hierarchy

**Quiet, precise, modern, professional.** Neutral surfaces, subtle separators, compact controls, strong text alignment, and a small number of purposeful accents. Let financial data and the next action carry visual weight.

Use three levels of emphasis:

| Level | Use | Treatment |
|---|---|---|
| Primary | Task title, critical value, main action | Clear foreground, semibold, strongest contrast |
| Secondary | Section label, relevant metadata, control label | Normal weight / muted foreground, restrained size |
| Tertiary | Auxiliary help, timestamps, less relevant detail | Muted but readable; not the sole location for critical facts |

Build **rhythm**: align headings with table columns, group related fields, and separate sections with spacing or a thin border. Avoid placing every subsection inside a bordered card.

### 2.2 Tokens and existing primitives

**Current:** Light/dark semantic variables in `src/app/globals.css`; primitives in `src/components/ui/`; Tailwind CSS 4, Base UI/shadcn, Lucide icons. Use the live variables rather than copying raw color values into new components.

| Need | Preferred existing token / pattern |
|---|---|
| Background and core text | `bg-background`, `text-foreground` |
| Supporting text | `text-muted-foreground` |
| Surface emphasis / selection | `bg-muted`, `bg-accent` |
| Borders and divisions | `border-border`, subtle opacity variants |
| Primary controls | `bg-primary`, `text-primary-foreground` |
| Feature-specific action accent | Existing `--action` tokens where the feature uses them |
| Errors or destructive actions | `text-destructive`, `bg-destructive/10` |
| Pending changes | `--staged-new`, `--staged-updated`, `--staged-deleted` |
| Chart series | `--chart-1` through `--chart-5` |

**Current:** Shared badge meanings include `status-active`, `status-inactive`, `status-warning`, and `status-error`. Status means workflow state, **not** whether an amount is financially good or bad. Pair color with explicit text or an icon.

### 2.3 Typography, spacing and controls

| Role | Starting point | Notes |
|---|---|---|
| Record/workspace title | 16px, semibold | Name and current state should be easy to locate |
| Entity-page title | 14px, semibold | Compact when the table dominates |
| Body / form / toolbar | 12–14px | Prefer 13–14px for sustained reading |
| Dense table | 12–13px | Legibility and alignment before row-count optimization |
| Section labels / metadata | 11–12px | Never rely on tiny text for essential instructions |
| Key outcome figure | 20–28px | Only when it genuinely deserves emphasis |

- Prefer spacing increments **4 / 8 / 12 / 16 / 24px**; keep related controls close and unrelated groups clearly separated.
- Use `tabular-nums` for money, rates, counts and numeric comparisons; align amounts right, text left.
- Prefer subtle `rounded-md`/`rounded-lg` and 1px dividers; avoid excessive pill-shaped containers and shadows.
- Lucide icons: ~14–16px for controls, decorative icons only when they improve comprehension.
- **Current button heights:** `xs` 24px, `sm` 28px, default 32px, `lg` 36px. Use tiny controls sparingly; aim for comfortable interactive targets and adequate spacing.
- Design for both themes and 200% browser zoom. Don't assume a token automatically guarantees readable contrast.

### 2.4 Polished composition

- Establish a **single visual anchor**: usually the table/grid, comparison, or results area.
- Put the page's one primary action in a stable, predictable location; subordinate other actions visually.
- Use **whitespace around groups** rather than padding each individual row excessively.
- Prefer **labels and alignment** over repeated boxes and heavy backgrounds.
- Highlight exceptions without making ordinary data look alarming. A sparse screen and a 500-row screen should feel like the same product.

---

## 3. Layout and component selection

### 3.1 Application shell

**Current:** `AppShell`, `TopBar`, `Sidebar`, `PageLayout`, and a contextual draft panel provide the shared frame. The sidebar is **208px expanded**, **48px manually collapsed**; no verified automatic collapse breakpoint exists.

**Standard anatomy:** App-wide top bar → sidebar navigation → compact page title/action row → local filters/tools → dominant work region → optional context panel.

- The **top bar** owns app-wide connection, search and shared save context. Avoid duplicate global controls inside each feature.
- The **page header** establishes task identity and one next step. Do not stack redundant large titles and toolbars.
- The **toolbar** holds local search, filters, view switching and secondary actions.
- Let the **work region own scrolling**; keep important headers, selection context and commit actions accessible.
- Keep navigation understandable as features grow; new top-level entries must represent a real user job.

### 3.2 Which surface to use

| User need | Choose | Avoid |
|---|---|---|
| Browse many comparable records | Dense table | Large cards replacing a productive list |
| Inspect a selected row without leaving it | **Inline/docked inspector** | Drawer that obscures the row/table |
| Edit several fields of one entity | **Editing drawer/sheet** | Oversized popover or whole new workflow |
| Choose a small option | Select, popover, combobox | Full-screen modal |
| Confirm irreversible/consequential action | Dialog with consequence | Generic “Are you sure?” |
| Review many potential writes | Dedicated review screen/panel | Success toast or tiny modal summary |
| Perform rich multi-step work | Focused workspace, local tabs | Nested dialogs/drawers |
| Explain a brief term | `InfoHint` or inline hint | Long permanent explanatory block |

**Important:** A docked inspector is **not** a sheet. A docked inspector shares the desktop canvas with the content it explains; a sheet temporarily overlays the canvas to edit something.

### 3.3 Inline inspectors

**Current example:** reconciliation `Inspector.tsx` uses `w-96` (**384px**). Typical new inspectors may be ~360–420px on roomy desktops; this is a starting range, not a global fixed width.

- Header: record/decision title, relevant status, labeled close action.
- Content: compact `label → value` rows; two/three-column comparison only when identity is established.
- Show raw source data, interpreted data, evidence and restrictions as needed; don't delete fields to achieve compactness.
- Preserve visible selected-row context and table scroll position as the inspector opens or changes selection.
- Only the panel's **body** should scroll when possible; preserve essential controls/identity.
- Closing returns focus to the originating control/row where it still exists.
- On constrained screens, a focused details view/sheet can be **proposed**; it is not the desktop default.

### 3.4 Forms, editors and dialogs

- Persistent labels; placeholders are examples, not replacements for labels. Show currency, unit, period and rate basis.
- Group related short inputs; prefer full-width notes and explanations.
- Validate after meaningful input/blur and at submit; don't show errors on untouched fields. Preserve values after failure.
- Put field errors adjacent to fields; summarize multiple failures with navigation to the invalid fields.
- Distinguish read-only derived values from editable controls, and say **why** a protected value cannot change.
- Editor sheets: stable title, body scroll, visible Cancel/Save or Stage footer. Guard unsaved changes on close.
- Modal dialogs: specific decision and impact, sane focus entry/return, no unintended background keyboard actions.
- Labels should describe real behavior: **Stage**, **Save**, **Preview**, **Apply**, **Run now**, **Discard** are not interchangeable.

---

## 4. Data tables and grids

Tables and grids are Actual Bench's primary working surfaces. Optimize **scan speed, selection clarity, predictable movement and data accuracy** before adding customization.

### 4.1 Baseline table behavior

- Put the identifying column first; keep essential identity visible during horizontal scroll when practical.
- Use a clear header, restrained row separators, readable selection/hover/focus states, and stable column alignment.
- Numeric columns are right-aligned, tabular, and sorted by underlying values — never by formatted text.
- Use shared tri-state sorting (ascending → descending → original/default) where the existing sortable header applies; expose direction with `aria-sort`.
- Preserve the meaning of missing data: `-` does **not** mean `0`.
- Truncation is acceptable only if the identifying content remains recoverable (wrap, expansion, accessible detail, tooltip).
- Keep destructive row actions restrained in an action menu/cluster; don't turn every row into a set of colorful buttons.
- For large lists, show total and matching counts when known; avoid inventing totals from partial data.
- **Table rows are one line.** Don't stack a muted second line under a value; give a secondary fact its own column, a tooltip, or put it in the row's inspector. Don't stack lines just to fit more in: if a fact deserves a place in the row, give it its own column. The one exception is an **entity summary list** (Loans, All cards), where each row is a record the user opens: rows may be two lines when line 1 is the figure to scan and line 2 a related, self-labelled figure ("minimum 100.00", "verified 08 Oct"), the same kind of fact on every row of that column. A badge never has text under it.
- **Missing values use a plain hyphen (`-`)**, never an em dash; `-` means unknown or not applicable, never `0`.
- **Cleared status (app-wide):** use `ClearedStatus` / `ClearedHeader` from `src/components/ui/cleared-status.tsx`, matching Actual: a filled green circle with a check for cleared, an empty circle for not cleared, a question mark when unknown. The column header is a check icon (with "Cleared" for screen readers), centred in a narrow column.

### 4.2 Selection, filters and bulk operations

| Decision | Required UX |
|---|---|
| Selection | Distinguish focused cell, selected row/range and changed/staged value |
| Select all | Specify whether **visible page**, **filtered results** or **all records** are selected |
| Bulk action | Show action, affected count, and selection scope before consequential writes |
| Search | Clarify scope: local table, current budget, or global entities |
| Filters | Clearly display active filters, matching count, **Clear filters** and no-results state |
| Persistence | Preserve filters through transient detail views where useful; cross-session persistence is feature-specific |
| Pagination / virtualization | Choose by task: continuous/virtual scroll for spreadsheet-like editing, pagination for independent records or server-limited listings |
| Columns / density | Resizing, reordering, hiding and density toggles are **optional**, not mandatory features |

- Wide grids should preserve column/row identity without breaking keyboard order or obscuring financial values.
- Virtualization must retain usable focus, copy, selected state and keyboard navigation when rows move offscreen.
- Empty-filter results should say **“No results match your filters”** with a Clear action, not imply the source is empty.
- Don't impose search debounce on cheap local datasets; use it where expensive queries demand it.

### 4.3 Spreadsheet interactions

For Budget Management and similarly dense editors:

- **Selection**, **edit mode** and **staged state** are distinct. Each needs a distinct visual treatment.
- Define how `Enter`, `Escape`, `Tab`, arrow keys, typing, paste, fill and range extension behave in the active mode.
- Keep row/group identity visible while months scroll; don't reset selection on harmless view changes.
- Paste/fill must identify skipped, protected or invalid cells without claiming complete success.
- If an action affects multiple months/rows, make its scope visible before committing.
- Never replace the primary spreadsheet with disconnected cards merely to make it look modern.

---

## 5. Interactions and financial trust

### 5.1 Explicit action boundaries

| State / operation | User meaning | Interface obligation |
|---|---|---|
| Suggested / simulated | A prediction, candidate or calculation | Label source, evidence or assumption; **not saved** |
| Staged edit | Local pending change | Visible pending state, review/discard and context-appropriate Undo |
| Immediate write | Persisted as soon as changed | Make immediacy clear; don't imply global Save or post-save Undo |
| Save | Commit staged entity/budget changes | Specific outcome; successful rows clear, failed rows remain discoverable |
| Apply | Execute a reviewed financial workflow | Preview writes and limits; itemized verified/failed outcome |
| Run now | Trigger an operational job | Run identity, progress, outcome and safe retry rules |

**Current:** most entity and budget changes are staged; notes and some carryover actions are intentional immediate-write exceptions. Preserve the feature's real persistence behavior unless its scope explicitly changes.

### 5.2 Feedback surfaces

- **Toast:** small, transient acknowledgement; never the only evidence of a failed or partly applied financial batch.
- **Inline field error:** invalid value with a fix next to the control.
- **Banner:** persistent non-blocking warning, stale data, offline/connection state, or required attention.
- **Review screen:** consequence and affected records before Apply.
- **Result panel/history:** durable evidence for long-running, multi-item and partially completed operations.
- **Dialog:** user decision is required now (discard, destructive operation, high-impact conflict).
- **Skeleton:** initial structured loading; mirror likely content, keep the header stable.
- **Spinner/progress:** short localized operations or countable long-running tasks; show processed/total when known.

Include empty, filtered-empty, offline, read-only, validation, conflict and failure states where relevant. Don't disable a critical action without communicating why.

### 5.3 Partial success and error recovery

A 50-item batch with 47 successes and 3 failures is **partial success**, not success or total failure.

- Display **attempted / succeeded / failed / skipped / unknown** counts as applicable, plus identifiable affected records.
- Keep failed items in a persistent discoverable list with a **Failures** filter and actionable reason.
- Keep confirmed successes visibly distinct so users don't retry them accidentally.
- **Retry only confirmed safe failures.** An indeterminate write outcome may have happened; require verification/reconciliation before retry.
- For stale data or conflicting edits, state what changed, whether user input is preserved, and how to refresh/review safely.
- Ensure buttons count actual writes, not unrelated rows (e.g. **Apply 12 changes**, not **Import 248 transactions**).

### 5.4 Undo, navigation and preserved work

- Undo belongs to the **active editing context**; text input Undo, budget grid Undo and global staged-history Undo must not unexpectedly override one another.
- Don't promise Undo for a saved/server operation unless the feature explicitly supports a safe reversal.
- Following a successful save, avoid presenting obsolete staged-history entries as reversible pending edits.
- Partial failures preserve the unsuccessful edits and their context; discard requires clear intent.
- If leaving the feature, switching budgets or closing an editor would lose unsaved work, warn with a meaningful action choice.
- When the same data may be changed elsewhere, surface known conflicts rather than silently overwriting; don't claim complete cross-tab coordination unless implemented.

---

## 6. Keyboard, focus and accessibility

Keyboard efficiency is a product feature, not a later optimization. **Current:** global bindings live in `src/hooks/useKeyboardShortcuts.ts`; Budget Management has its own keymap/action definitions; reconciliation has local row-decision shortcuts. There is no verified single runtime registry.

### 6.1 Shortcut ownership and precedence

| Scope (highest relevant first) | Principle |
|---|---|
| Active modal / popup | Owns relevant keys; suppresses background grid commands |
| Focused editor / text input | Native typing and edit shortcuts take precedence |
| Active grid / workbench | Owns navigation, range selection and row decisions while active |
| App-wide command | May run only when higher-priority context permits |
| Browser / OS | Don't casually steal reserved navigation/accessibility keys |

- Scope shortcuts by feature and active focus; avoid duplicate bindings for different actions.
- Existing global actions include Search (`Ctrl/Cmd+K`) and Quick Create (`N`, `Ctrl/Cmd+Shift+N`) with context-dependent guards. Check current code before assigning shortcuts.
- Show shortcuts in feature help and accessible tooltips; Mac/Windows modifier labels should be accurate.
- Don't let a row command execute behind a dialog, during composition/typing, or when a combobox is processing keys.
- Opening an overlay moves focus deliberately; closing restores focus to the opener or a surviving logical target.

### 6.2 Accessibility baseline

Target **WCAG 2.2 AA** on new/changed interfaces; this document does **not** certify current compliance.

- Keyboard-only completion, visible focus, logical tab order, correctly labeled controls and accessible table/grid semantics.
- Text contrast normally **4.5:1**; qualifying large text **3:1**; relevant UI boundaries/focus cues **3:1** where required.
- Target size/spacing should satisfy WCAG 2.2 AA (**24×24px or applicable spacing/exception**); prefer larger targets for common actions.
- Use `role="status"` for meaningful routine updates, `role="alert"` for important errors; avoid an announcement for every recalculated cell.
- Don't rely on color or hover alone. Test light/dark, 200% zoom, reduced motion and narrow layouts.
- Respect `prefers-reduced-motion`; don't animate financial numbers through misleading intermediate values.

**Verification:** Use existing Jest/React Testing Library tests for behavior; check keyboard and focus manually; test representative flows with a screen reader. **Proposal:** introduce `axe-core`/`@axe-core/playwright` checks and CI coverage where the project adopts that tooling. Do not claim automated accessibility checks are already configured.

---

## 7. Financial data, charts and localization

### 7.1 Financial display

- **Money:** currency identity and locale-appropriate precision; avoid assuming USD or two decimal places. Keep calculation precision separate from display rounding.
- **Signs:** explicitly distinguish inflow, outflow, debt, outstanding, variance and balance; a negative amount is not automatically an error.
- **Null vs zero:** `-` is not `0.00`. Unknown, not applicable, and known zero have distinct meanings.
- **Dates:** use unambiguous locale-aware formatting; distinguish transaction, posting, statement, due and effective dates.
- **Rates:** show basis (APR, annual/monthly, fixed/variable, day count where relevant) and estimated vs observed status.
- **Totals:** reconcile visibly with included parts; explain excluded rows and rounding where important.
- **Comparisons:** when users must decide between values, show *both*, plus meaningful difference and units.
- **Actual vs forecast:** differentiate with labels, style and/or annotations, not just color.
- **Coloured amounts (credit-card transaction tables):** money back to the user (payments, refunds, cashback, interest or fee reversals) is green; interest and fees charged are amber; everything else uses the default text colour. Red stays reserved for errors and overdue. Colour supplements the Type column; it never carries meaning on its own.

### 7.2 Charts

- Every chart should answer a question; otherwise use a table or concise metric.
- Lines show trends, bars show comparisons, stacked visuals show meaningful composition; use a table for audit-level precision.
- Give titles, units, legend, exact-value tooltips, and a readable text/table alternative for decisions.
- Missing observations are **gaps**, not zeros; don't invent future or historical readings.
- Make assumptions and limitations visible near projections. Avoid dramatic truncated axes or unexplained financial color semantics.

### 7.3 Localization and export

- Format numbers, currencies and dates consistently for the active locale; sort strings locale-aware when applicable, numbers by numeric values.
- **Proposal:** Arabic/RTL adaptation requires deliberate layout and keyboard testing; don't imply full localization/RTL support already exists.
- When export is present, state its scope: full data, filtered results, selection, saved state or pending edits. Do not imply staged values are saved.
- CSV should preserve unambiguous, machine-readable values; print/PDF layouts should retain headings, totals and context while removing app chrome.
- Universal printing, export centers and advanced saved views are **not** required merely because they are mentioned here.

---

## 8. Responsive behavior

**Actual Bench is desktop-first.** Its primary experience is a usable full-width workbench; mobile parity is **not** assumed or required unless approved in the feature scope.

| Environment | Design expectation |
|---|---|
| Wide desktop (roughly ≥1280px) | Main data region plus optional docked inspector; full keyboard workflow |
| Medium desktop / landscape (roughly 768–1279px) | Protect main task width; allow horizontal grid scroll; reduce optional chrome |
| Narrow (<768px) | Best effort: critical actions and data reachable; one meaningful region at a time; no silently hidden capability |

These are **testing bands**, not existing global breakpoints. The current sidebar has a *user-controlled* collapse; don't invent an automatic breakpoint.

- Don't force large tables into tiny card grids on desktop or shrink comparisons until labels become illegible.
- A dedicated narrow-screen details view or sheet is a **Proposal** for constrained inspectors, not permission to replace desktop inline panels.
- Keep Save/Apply reachable, dialogs usable with the on-screen keyboard, and financial identity visible.
- Don't add a full mobile redesign as a side effect of a desktop-only refinement.

---

## 9. Canonical design examples

These examples communicate **hierarchy and behavior**, not pixel-perfect mockups or claims that every feature already uses them. Use nearby implemented components as the styling reference.

### Example A — Dense entity table

```text
 Accounts   18 total                                              [+ Account]
 ───────────────────────────────────────────────────────────────────────────
 [Search accounts…]  [Class ▾] [Status ▾]          12 matching  [Clear]
 ───────────────────────────────────────────────────────────────────────────
 [ ] ACCOUNT                 GROUP           CLASS           BALANCE     ⋯
 [ ] Current Account         Personal        Bank            8,250.00     ⋯
 [ ] Credit Card             Credit          Credit Card    -2,930.50     ⋯
 [ ] Investment Portfolio    Assets          Investment    45,600.00     ⋯
 ───────────────────────────────────────────────────────────────────────────
 2 selected · visible page only                [Change class] [More actions ▾]
```

**Why this works:** Title and count orient; filters stay compact; money aligns; selection scope is explicit; one dominant table; bulk controls appear in context rather than cluttering every row. Values are illustrative.

**Implementation reference:** `PageLayout.tsx`, `AccountsTable.tsx`, `sortable-header.tsx`.

### Example B — Compact reconciliation inspector

```text
 BANK / MATCH / ACTUAL GRID                │ Match details                 ×
 Statement row A   245.00  [Selected]      │ Suggested · Needs review
 Statement row B    91.20                  │ Based on date and amount
 Statement row C   800.00                  │ ───────────────────────────
                                          │               BANK    ACTUAL
                                          │ Date          10 Oct  11 Oct
                                          │ Amount        245.00  245.00
                                          │ ───────────────────────────
                                          │ Statement: Imported payee…
                                          │ Actual: Payee, category…
                                          │ Evidence / references…
                                          │ [Choose match] [Ignore]
```

**Why this works:** The table remains visible, comparison is aligned and compact, evidence sits next to action, and the user keeps row context. **Important:** Only show a Bank/Actual comparison as confirmed when one Actual transaction is actually selected; ambiguous rows show candidate options instead. Illustrative example, not a universal field inventory.

**Implementation reference:** `Workbench.tsx`, `Inspector.tsx`, `ApplyResultPanel.tsx`.

### Example C — Loan modelling workspace

```text
 ← Loans & Debt    Home Loan   [Draft]                 [Save] [More ▾]
 [Activity] [Calculation] [Setup]
 ──────────────────────────────────────────────────────────────────────
 INPUTS (~396px current rail)    │ RESULTS
 Principal    [500,000]         │ Monthly payment         3,411
 Rate         [5.40%]           │ Total interest        318,600
 Term         [20 years]        │ [Balance / interest chart]
 Offset       [Enabled]         │ [Schedule with dated rows]
 [Extra payments…]             │ Assumptions / calculation method
```

**Why this works:** The left rail owns inputs, the right region owns outcomes, and one record header owns identity/save. Results update without stealing input focus. These example amounts are **illustrative, not calculated figures**.

**Implementation reference:** `WorkspaceFrame.tsx`, `SimulatorView.tsx`.

---

## 10. Agent workflow and review checklist

### 10.1 When asked to design or redesign UI

1. **Understand the job.** State the user task, important data, decisions and constraints — not just “make it modern.”
2. **Inspect reality.** Read the target component, nearby pages, shared primitives, current tests, and approved feature spec.
3. **Choose the surface.** Table, inspector, editor, dialog, or workspace. Explain a departure from an established pattern.
4. **Sketch hierarchy first.** Identify primary visual anchor, header, filters, important values, actions, panel behavior and scroll ownership.
5. **Design interactions.** Keyboard/focus, selection, staging, success/partial failure, read-only, empty and loading states.
6. **Implement narrowly.** Improve layout and clarity without silently changing business behavior or related features.
7. **Verify.** Compare realistic dense and sparse examples, both themes, keyboard and relevant widths; report any unresolved discrepancy.

**Fallback:** When this document is silent, follow the closest successful existing pattern; when existing patterns conflict, prefer the one serving the *same user job*. Surface a material ambiguity rather than inventing a universal standard.

### 10.2 Before requesting review

- [ ] The primary task and one next action are obvious; visual hierarchy reads cleanly.
- [ ] Necessary fields, calculations, context and actions are preserved.
- [ ] The chosen surface suits the task; no gratuitous modal, drawer, card or extra toolbar.
- [ ] Numbers, states and labels are precise; suggested/staged/saved/applied are distinguishable.
- [ ] Data and selected context remain usable in a **dense case** (~500 rows or representative real load), an empty case and an exception case.
- [ ] Keyboard, focus, panel opening/closing and scroll behavior are accounted for.
- [ ] Light/dark and readable zoom are considered; relevant narrow behavior is documented.

### 10.3 Before merging implementation

- [ ] Current behavior and feature-specific acceptance criteria are preserved or deliberately revised.
- [ ] Tests cover changed interaction logic, validation, save boundaries and important error outcomes.
- [ ] Real browser checks cover relevant viewport, keyboard/focus, theme, and accessibility behavior.
- [ ] Changes use semantic tokens and shared primitives where suitable.
- [ ] No unrelated visual system or business-logic refactor slipped in.
- [ ] New reusable patterns or approved exceptions are reflected in this guide if they change product-wide conventions.

### 10.4 Agent reporting format

Summarize **What changed · What was preserved · Why the UX is better · How it was verified · Any remaining proposals**. Be precise: don't call a mockup implemented, a suggestion confirmed, or an unverified write successful.

---

## 11. Reference map and maintenance

| Pattern | Existing starting point |
|---|---|
| Shell, sidebar, app-wide actions | `src/components/layout/{AppShell,Sidebar,TopBar}.tsx` |
| Entity page frame and status | `src/components/layout/PageLayout.tsx` |
| Controls, dialogs, editing sheets | `src/components/ui/` |
| Colors and theme | `src/app/globals.css` |
| Entity list | `src/features/accounts/components/AccountsTable.tsx` |
| Budget spreadsheet and keyboard | `src/features/budget-management/components/`, `keyboard/` |
| Reconciliation grid, inspector, results | `src/features/reconciliation/components/{Workbench,Inspector,ApplyResultPanel}.tsx` |
| Rules table and rich editor | `src/features/rules/components/{RulesTable,RuleDrawer}.tsx` |
| Loan modelling workspace | `src/features/assets-debt/components/{workspace,simulator}/` |
| Global keyboard shortcuts | `src/hooks/useKeyboardShortcuts.ts` |

**Maintenance:** These references describe the checked baseline, not permanent paths. Verify them when editing. Update this file when an approved **shared design convention** changes — not for every feature tweak. Keep feature-specific specifications with their features, and keep implementation/architecture rules outside this design guide.

**North star:** Actual Bench should make complicated financial work feel **clear, fast, controlled and visually polished**, without hiding the information required for a correct decision.
