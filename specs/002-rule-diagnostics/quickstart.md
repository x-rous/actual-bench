# Quickstart: Rule Diagnostics / Linting

**Feature**: `feat/002-rule-diagnostics`
**Audience**: Reviewers, future maintainers, and anyone validating the feature before merging.

This walkthrough exercises every v1 check against a live connection. It assumes you have:

- A running `actual-http-api` pointed at a test Actual Budget instance (see `README.md → Quick Start`).
- A local `actual-bench` dev server: `npm run dev`, then open `http://localhost:3000`.

If you want to skip the setup and just verify the engine logic, jump to **Unit-test quickstart** at the bottom.

---

## 1. Seed the test budget

On the fresh connection, use the Rules page (`/rules`) to stage the following rules. You can use the CSV importer with `public/samples csv/sample-rules.csv` as a starting point and then edit the drawer for each of the below.

### Fixture A — broken entity references (expect `RULE_MISSING_PAYEE`, `RULE_MISSING_CATEGORY`)

1. Create rule **A1**: stage `default`, condition `Payee is <some payee>`, action `set Category → <some category>`.
2. Save.
3. Delete that payee from the Payees page (stage only — do NOT save).
4. Keep the staged deletion.

### Fixture B — empty actions (expect `RULE_EMPTY_ACTIONS`)

Create rule **B1**: stage `default`, one condition (`Notes contains "subscription"`), and **remove all actions**. The rule editor will reject saving this, so stage it and keep it unsaved.

### Fixture C — impossible conditions (expect `RULE_IMPOSSIBLE_CONDITIONS`)

Create rule **C1**: stage `default`, `conditionsOp = and`, conditions `Amount is 10.00` **and** `Amount is 20.00`, action `set Category → X`. Save.

### Fixture D — shadowed rule (expect `RULE_SHADOWED`)

1. Create rule **D1** first: stage `default`, condition `Imported Payee contains "Amazon"`, action `set Payee → Amazon`.
2. Then rule **D2**: stage `default`, conditions `Imported Payee contains "Amazon"` AND `Amount gt 100`, action `set Payee → Amazon Big`.
3. Save both. D2's payee write is fully overridden by D1 because every transaction D2 matches, D1 also matches and sets Payee first.

### Fixture E — broad match (expect `RULE_BROAD_MATCH`)

Create rule **E1**: stage `default`, condition `Imported Payee contains "a"`, action `set Category → Misc`. Save.

### Fixture F — duplicate group (expect `RULE_DUPLICATE_GROUP`)

Create rule **F1** and **F2**, both with stage `pre`, `conditionsOp = and`, condition `Imported Payee contains "Netflix"`, action `set Payee → Netflix` + `set Category → Entertainment`. Save.

### Fixture G — near-duplicate pair (expect `RULE_NEAR_DUPLICATE_PAIR`)

Create rule **G1** and **G2**, both stage `pre`, `and`, condition `Imported Payee contains "Spotify"`, but G1 has action `set Payee → Spotify` and G2 has `set Payee → Spotify` + an extra `set Category → Music`. Save.

### Fixture H — unsupported combination (expect `RULE_UNSUPPORTED_CONDITION_OP`)

Using CSV import, import a rule row with `field=amount`, `op=contains` (which is a string op not valid for number fields). Stage only; expect the lint flag.

### Fixture I — schedule-linked rule (expect it to be silently excluded)

Create a Schedule on `/schedules`. The API auto-creates a rule with a `link-schedule` action for it. Confirm this rule is NOT flagged for any of the above codes even if it superficially resembles one.

---

## 2. Open the diagnostics view

1. Navigate to `/rules`.
2. Click the new **Open Diagnostics** button in the toolbar (next to Export).
3. The browser URL changes to `/rules/diagnostics`.
4. The page renders a loading skeleton, then shows:
   - Three summary cards: `Errors 3 · Warnings 6 · Info 1` (counts depend on exact fixtures).
   - The severity-grouped findings table.
5. Verify each fixture has produced exactly one expected finding with:
   - Correct severity badge.
   - A plain-language explanation under the title.
   - A clickable rule summary (e.g. `If Imported Payee contains "Amazon" → set Payee → "Amazon"`).

---

## 3. Exercise the interactions

- **Severity filter**: Toggle `Warning` off → only `error` and `info` findings remain. Toggle it back on → report restored.
- **Code filter**: Filter to only `RULE_DUPLICATE_GROUP` → only Fixture F's finding is visible. Clear → all findings return.
- **Refresh**: Edit rule F2 (change its category) in another browser tab (or undo/redo). Return to `/rules/diagnostics`. A "Results are out of date — Refresh" banner appears. Click Refresh. The finding list updates and the banner clears.
- **Jump-to-rule**: Click the rule summary on Fixture A's finding. The Rules page opens with rule A1 highlighted and scrolled into view (`?highlight=<id>`). Press browser back to return to `/rules/diagnostics`.
- **Empty state**: Discard all changes and delete every broken rule. Re-enter diagnostics. The "No issues found" empty state is shown.
- **Keyboard navigation**: Tab through the filter bar, refresh button, and each finding's jump-to-rule link. Each interactive control announces its role and label to a screen reader.

---

## 4. Non-mutation verification (SC-005)

1. From the diagnostics view, click through 5 findings (open-rule, then use back). Use the severity and code filters. Use Refresh.
2. Go to `/rules`. Open DevTools → Network → clear. Go back to `/rules/diagnostics`. Confirm ZERO requests go to `/api/proxy` (or anywhere else) during diagnostics loading — the engine runs entirely client-side.
3. Go to the Draft Panel (top-right). Confirm the pending-change count is unchanged from before you opened diagnostics (+ whatever you staged explicitly in §1). No side-effect stagings.

---

## 5. Performance smoke test (SC-002, SC-003)

For the 500-rule target and the 2 000-rule stress case, use the seeded fixtures script (see below) instead of hand-creating rules.

Create `scripts/seed-rules.ts` (local helper, not committed) that uses the CSV importer to stage N deterministic rules of mixed shapes, then:

```bash
npm run dev  # if not already running
# Open DevTools → Performance
# Load /rules/diagnostics with the seeded set
# Record the "rendered" timestamp vs the navigation-start timestamp
```

Acceptance:
- 500-rule set: report visible in **< 2 s** from navigation.
- 2 000-rule set: report visible in **< 5 s** from navigation.
- Long-task audit (DevTools → Performance → Long Tasks): no single task **> 100 ms**.

If either budget is exceeded, investigate: most likely culprits are (a) a missing `await setTimeout(0)` between checks, or (b) the near-duplicate partition cap is not being applied.

---

## 6. Reproducibility check (SC-007)

With a seeded working set, open `/rules/diagnostics` twice in quick succession (refresh the page). Both reports must contain identical findings in the same order. (Manual spot check: scroll down the list and compare; or use the developer console: `JSON.stringify(document.querySelector('…').dataset)` patterns — the engine does not log the report by default, so if you need full-output equality, temporarily `console.log(report)` in `useRuleDiagnostics` during testing.)

---

## Unit-test quickstart

Without a running budget:

```bash
npm test -- src/features/rule-diagnostics
```

Expected: every check has its own test file with at least:
- one "produces the expected finding for the matching pattern" case, and
- one "does not produce a finding when the pattern is absent" negative case.

`runDiagnostics.test.ts` includes:
- A deterministic-output test that runs the engine twice and `expect`s `JSON.stringify(a)` to equal `JSON.stringify(b)`.
- A "schedule-linked rules are excluded from editor-relevant checks" test.

`RuleDiagnosticsView.test.tsx` (React Testing Library):
- Renders the view with a mocked `useRuleDiagnostics` returning a canned report and asserts on rendered severity counts, filter behavior, empty state, and jump-to-rule `href`.

---

## Out-of-scope verifications (explicitly NOT in v1)

Do NOT test or expect any of the following; they're planned follow-ups:

- CSV export of the diagnostics report.
- "Ignore / snooze" individual findings.
- Cross-stage action-override warnings.
- Heuristic overlap or fuzzy-overlap detection beyond the narrow near-duplicate definition.
- Template or grouped-category suggestions.
- Auto-fix buttons on any finding.
