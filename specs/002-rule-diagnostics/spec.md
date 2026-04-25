# Feature Specification: Rule Diagnostics / Linting

**Feature Branch**: `feat/002-rule-diagnostics`
**Created**: 2026-04-23
**Status**: Draft
**Input**: User description: "Build RD-023 — Rule Diagnostics / Linting, as described in agents/rd-023-rule-diagnostics-linting-idea.md"

## Clarifications

### Session 2026-04-23

- Q: Should the Rule Diagnostics view be its own route, a drawer on the Rules page, or a tab on the Rules page? → A: Dedicated route (`/rules/diagnostics`) — full-page view, bookmarkable, jump-to-rule navigates to `/rules` with the rule selected.
- Q: When the working set changes, should diagnostics re-evaluate live on every edit, or only on view entry + manual Refresh with a stale indicator? → A: On view entry + manual Refresh, with a visible "stale" indicator when the working set has changed since the last run.
- Q: How should each finding identify its rule — raw UUID, index in stage order, or a generated human-readable summary? → A: Generated short summary (stage + first condition + first action) as the primary identifier, with the internal rule UUID available on hover or copy.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Surface high-confidence rule problems at a glance (Priority: P1)

A power user who maintains a large rule set opens a dedicated Rule Diagnostics view and immediately sees a prioritized list of rules that are definitely broken or unreachable — rules that reference payees, categories, accounts, or category groups that no longer exist, rules whose actions can never run because they are fully shadowed by an earlier rule in the same stage, and rules that have no actions at all. Each finding explains in plain language what is wrong and which rule it refers to, grouped by severity so the worst issues are visible first.

**Why this priority**: This is the core value of the feature. Power users with hundreds of rules currently have no way to audit their rule set; broken references and shadowed rules silently fail without any warning from Actual Budget itself. Delivering just this tier of checks already produces a usable MVP that prevents real data-processing bugs.

**Independent Test**: Load a connection with a rule set that deliberately contains (a) a rule referencing a deleted payee, (b) two rules where the second is strictly shadowed by the first in the same stage, and (c) a rule with zero actions. Open the Rule Diagnostics view and verify that exactly those three findings appear, each with the correct severity, correct rule identifier, and a human-readable explanation.

**Acceptance Scenarios**:

1. **Given** a connected budget with rules that reference at least one deleted payee, category, account, or category group, **When** the user opens the Rule Diagnostics view, **Then** every such rule appears as an `error`-severity finding that names the missing entity and the field it was referenced on.
2. **Given** two rules in the same stage where the second rule's conditions are a superset (strictly narrower match) of the first rule's conditions and the first rule's actions fully overwrite the same fields the second rule would write, **When** the user opens diagnostics, **Then** the second rule appears as a `warning`-severity "shadowed rule" finding that identifies the shadowing rule by its generated rule summary (with the UUID accessible via hover).
3. **Given** a rule with an empty action list (or only no-op actions), **When** the user opens diagnostics, **Then** that rule appears as a `warning`-severity "no-op rule" finding.
4. **Given** a working set that contains at least one finding, **When** the view renders, **Then** a severity summary is visible at the top showing counts of `error`, `warning`, and `info` findings.
5. **Given** a working set with zero findings, **When** the view renders, **Then** an unambiguous "No issues found" empty state is shown instead of an empty table.

---

### User Story 2 - Jump from a finding directly to the offending rule (Priority: P1)

After reviewing a finding, the user can click through to open the offending rule in the existing rule management experience so they can inspect, edit, merge, or delete it. The diagnostics view itself never modifies a rule.

**Why this priority**: Surfacing findings without a way to act on them forces users to manually copy a rule ID and hunt for it in the rules page. The jump-to-rule affordance is what turns diagnostics from a report into a workflow. Keeping editing in the existing rules UI avoids duplicating complex builder logic and keeps diagnostics purely advisory.

**Independent Test**: From the Rule Diagnostics view, activate the "open rule" affordance on any finding. Verify the rules page opens with that rule selected/highlighted and its editor/drawer open for inspection, without any rule having been changed.

**Acceptance Scenarios**:

1. **Given** the diagnostics view is displayed with at least one finding, **When** the user activates the "open rule" affordance on a finding, **Then** the browser navigates to the Rules route (`/rules`) with the referenced rule selected and its editor open, and the user can return to the diagnostics report via the browser back action or the same entry point.
2. **Given** the user is reviewing diagnostics, **When** they open a rule from a finding, **Then** no rule data has been written to the server and no mutation has been staged as a side effect of opening the finding.
3. **Given** a finding references a rule that has since been deleted in the user's unsaved working set, **When** the user clicks through, **Then** the system communicates that the rule no longer exists in the current working set instead of navigating to a missing record.

---

### User Story 3 - Inspect broad and risky match criteria (Priority: P2)

Beyond outright breakage, the user wants to identify rules that are technically valid but likely to match too broadly — for example, a rule using `contains` with a one- or two-character value, or impossibly conflicting conditions on the same field (e.g. `amount is 10` AND `amount is 20` on an `and` rule). These appear as `warning` or `info` findings so the user can decide whether to tighten them.

**Why this priority**: These are "code smell" style checks. They are high value for keeping a rule set maintainable but do not block real data processing; an MVP without them is still useful. They build on the P1 foundation and re-use the same view, so they are natural to add second.

**Independent Test**: Seed the connection with (a) a rule containing `imported_payee contains "a"`, (b) a rule whose `and`-grouped conditions can never all be true simultaneously, and (c) a plausibly-correct rule. Open diagnostics and verify that only (a) and (b) surface as findings, with severity below `error` for (a) and at `error` for (b), and that each explains why the condition is risky or contradictory.

**Acceptance Scenarios**:

1. **Given** a rule with a `contains`-style operator whose value length is below a defined minimum-suspicion threshold, **When** diagnostics runs, **Then** a `warning`-severity "broad match" finding is produced for that rule with the offending field and value quoted in the message.
2. **Given** a rule whose `and`-combined conditions are mutually exclusive on the same field (e.g. two equality conditions on the same field with different literal values), **When** diagnostics runs, **Then** an `error`-severity "impossible conditions" finding is produced for that rule.
3. **Given** a rule that uses a deprecated or unsupported field/operator combination detectable from the current entity and operator catalogs, **When** diagnostics runs, **Then** a `warning`-severity "unsupported combination" finding is produced.

---

### User Story 4 - Detect duplicate and near-duplicate rules (Priority: P2)

The user wants to see which rules in their rule set are duplicates or near-duplicates of each other, so they can merge or delete redundant rules. Two rules are considered duplicates when they live in the same stage, use the same condition operator (`and`/`or`), and — ignoring ordering and pure formatting differences — express the same set of conditions and the same set of actions. Near-duplicates share the same stage and condition operator but differ by at most one or two parts across their conditions and actions combined, and are flagged so the user can compare them side by side.

**Why this priority**: Over time, rule sets grow copies of the same logic. Finding these is valuable, but it is a cleanup concern rather than a correctness concern, which is why it ranks below breakage and broad-match warnings. It reuses the same view and the same output model as the earlier stories.

**Independent Test**: Seed two rules with identical conditions and identical actions, and a third rule with the same conditions but one extra action. Open diagnostics. Verify a `warning`-severity "duplicate rules" finding lists the two identical rules as a group, and a separate `info`-severity "near-duplicate rules" finding lists the pair that differs by only one action.

**Acceptance Scenarios**:

1. **Given** two or more rules whose stage, condition operator, normalized condition set, and normalized action set are identical, **When** diagnostics runs, **Then** a single `warning`-severity "duplicate rules" finding is produced that references every rule in the duplicate group and identifies the group as a cluster rather than emitting one finding per member.
2. **Given** two rules that differ by at most one or two conditions or actions (but agree on stage and condition operator), **When** diagnostics runs, **Then** an `info`-severity "near-duplicate rules" finding is produced for that pair.
3. **Given** a duplicate finding, **When** the user views it, **Then** the finding lets the user open each rule in the group via the same jump-to-rule affordance as other findings.

---

### User Story 5 - Filter and organize findings to review a large report (Priority: P3)

When a diagnostics run returns many findings, the user wants to slice the report by severity, by finding type, and (optionally) by text search so they can focus on one class of issue at a time without scrolling through an undifferentiated list.

**Why this priority**: Pure quality-of-life for large rule sets. The feature is still usable without filters when the report is small. Included last because it is strictly additive and depends on the output of earlier stories.

**Independent Test**: With a diagnostics report containing at least two severities and at least three distinct finding codes, toggle each severity filter and each code filter independently, and verify the visible list updates to exactly the matching findings; clear filters and verify the full report returns.

**Acceptance Scenarios**:

1. **Given** a diagnostics report with findings of more than one severity, **When** the user enables a severity filter, **Then** only findings of that severity remain visible and the summary reflects the filtered count.
2. **Given** a diagnostics report with more than one finding code, **When** the user enables a code filter, **Then** only findings with that code remain visible.
3. **Given** any active filter, **When** the user clears filters, **Then** the full unfiltered report is restored.

---

### Edge Cases

- **Empty rule set**: diagnostics runs and shows an explicit empty state; no findings, no errors.
- **Connection not ready / rules not yet loaded**: the view shows a loading indicator until the rule snapshot is available; it does not run diagnostics against a partial snapshot.
- **Unsaved working set**: diagnostics reflects the user's current working set, so rules that the user has staged for deletion are excluded, staged updates are analyzed in their new form, and staged-new rules are included. This is what users expect — they want to lint what they are about to save.
- **Stale entity references**: when a referenced entity (payee, category, account, category group) is deleted in the staged working set, a referencing rule is flagged as an "entity missing" finding even though the server still knows about the entity.
- **Very large rule sets**: diagnostics must complete in a short, bounded time and must not block the UI thread long enough to freeze scrolling or typing.
- **Rule with action but no matching field in the condition schema**: flagged as an unsupported-combination warning rather than crashing the analyzer.
- **Rule whose conditions reference a field the analyzer does not recognize**: the finding explains that it could not fully analyze the rule, rather than silently skipping it.
- **Entry point when user has no connection selected**: the diagnostics entry point is either hidden or disabled with a tooltip; it never offers to analyze a non-existent dataset.
- **Switching connections mid-review**: navigating to a different connection invalidates the current report and triggers a fresh diagnostics run against the new working set.
- **Working set changes while the view is open**: the last completed report remains visible with a "stale" indicator until the user activates Refresh or leaves and returns; the report is never silently recomputed underneath the user while they are reviewing findings.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose a dedicated Rule Diagnostics view at its own route (`/rules/diagnostics`) that is reachable from the existing Rules page via a clearly labelled entry point; the view MUST be directly linkable and bookmarkable.
- **FR-002**: System MUST run diagnostics against the user's current rule working set, meaning the server snapshot merged with any unsaved staged changes (new, updated, deleted rules).
- **FR-003**: System MUST produce deterministic findings: given the same working set, repeated diagnostics runs MUST produce the same findings with the same codes and messages.
- **FR-004**: System MUST, for each finding, include (a) the internal rule identifier (UUID) of the affected rule or rules, (b) a generated short human-readable rule summary for display — composed of the rule's stage plus its first condition and first action — used as the primary visible identifier, (c) a severity level of exactly one of `error`, `warning`, or `info`, (d) a stable machine-readable code, (e) a short human-readable finding title, and (f) a plain-language explanation of why the finding was raised. The raw UUID MUST remain accessible to the user (for example, via hover or copy) for debugging and cross-referencing.
- **FR-005**: System MUST detect rules that reference an entity (payee, category, account, category group) which does not exist in the current working set and report each as an `error`-severity finding that identifies the missing entity (by ID when a name is unavailable) and names the field it was referenced on.
- **FR-006**: System MUST detect rules whose action list is empty or consists only of no-op actions — where a "no-op action" is defined as a `set` action whose target field is missing, or a `prepend-notes`/`append-notes` action whose value is empty or whitespace-only — and report each as a `warning`-severity finding.
- **FR-007**: System MUST detect rules whose conditions are logically impossible to satisfy together (for example, two `and`-combined equality conditions on the same field with different literal values) and report each as an `error`-severity finding.
- **FR-008**: System MUST detect rules that are strictly shadowed by an earlier rule in the same stage — that is, a rule whose matches are fully absorbed by a preceding rule that writes the same output fields — and report each as a `warning`-severity finding that names the shadowing rule.
- **FR-009**: System MUST detect rules that use broad match criteria (for example, a `contains`-style operator with a value whose length is at or below a defined suspicion threshold) and report each as a `warning`-severity finding that quotes the offending field and value.
- **FR-010**: System MUST detect groups of duplicate rules — rules sharing the same stage, the same condition operator, the same normalized condition set, and the same normalized action set, ignoring ordering — and emit exactly one `warning`-severity finding per duplicate group that references every rule in the group.
- **FR-011**: System MUST detect pairs of near-duplicate rules (same stage, same condition operator, with a combined symmetric difference of exactly one or two parts across conditions and actions — i.e. the pair differs by 1–2 conditions, or 1–2 actions, or any split totalling 1–2 parts) and report each pair as an `info`-severity finding.
- **FR-012**: System MUST detect rules whose field/operator combinations are not supported by the current entity and operator catalogs and report each as a `warning`-severity finding.
- **FR-013**: System MUST provide a summary of the current report that shows, at minimum, the total count of findings broken down by severity.
- **FR-014**: System MUST group findings by severity in the default view so that `error` findings appear before `warning` findings, and `warning` findings appear before `info` findings.
- **FR-015**: Users MUST be able to open the rule referenced by any finding in the existing rule management experience via a jump-to-rule affordance.
- **FR-016**: System MUST NOT, under any circumstance in v1, automatically modify, stage, create, or delete any rule, entity, or configuration as a side effect of running diagnostics or interacting with a finding.
- **FR-017**: System MUST NOT call or depend on any diagnostics-only backend endpoint; diagnostics runs entirely against the already-loaded rule and entity snapshots available to the app.
- **FR-018**: Users MUST be able to manually re-run diagnostics against the current working set via a Refresh affordance on the diagnostics view.
- **FR-019**: System MUST, when no findings are produced, render an explicit "No issues found" empty state in place of an empty table.
- **FR-020**: System MUST, when rules or entities are still loading, display a loading state rather than produce a partial or misleading report.
- **FR-021**: System MUST recompute the diagnostics report automatically each time the user enters the diagnostics view, and MUST NOT re-run continuously in response to individual staged edits while the view is already open. When the working set changes while the user is on the diagnostics view (for example, via undo/redo or any cross-view state mutation), the system MUST display a visible "results are stale" indicator and keep the last completed report visible until the user activates the Refresh affordance (FR-018) or leaves and re-enters the view.
- **FR-022**: Users MUST be able to filter the displayed findings at least by severity and by finding code.
- **FR-023**: System MUST produce human-readable explanations for each finding that can stand on their own without requiring the reader to open the rule editor to understand the issue.
- **FR-024**: System MUST NOT freeze, block, or visibly stall the UI for any working set within the realistic size expected on this product (see Success Criteria SC-003).

### Key Entities *(include if feature involves data)*

- **Diagnostic Finding**: A single advisory entry produced by the diagnostics engine about one rule (or one group of rules, in the case of duplicates). Attributes: affected rule identifier(s) as internal UUIDs, a generated short display summary per affected rule (stage + first condition + first action) used as the primary visible identifier, severity (`error` / `warning` / `info`), stable machine-readable code, short title, plain-language message, optional supporting detail lines, and — where relevant — a reference to the shadowing, duplicating, or conflicting counterpart rule(s).
- **Diagnostic Report**: The full collection of findings produced by a single diagnostics run against the current working set. Carries summary counts by severity and the timestamp (or equivalent freshness marker) of the run.
- **Rule Working Set**: The view of rules the user is currently operating on — the last server snapshot with the user's unsaved staged changes applied (staged deletions excluded, staged updates in their new form, staged-new rules included). Diagnostics always evaluates this set, not the raw server snapshot.
- **Entity Catalog Snapshot**: The view of referenceable entities (payees, categories, accounts, category groups) at the time of the diagnostics run, used to detect references to missing entities. Matches the same working-set rules: staged deletions are treated as removed, staged new entities are treated as present.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a working set that contains at least one rule for each v1 check (missing entity reference, no-op action, impossible conditions, shadowed rule, broad-match criteria, duplicate rules, unsupported field/operator), the first diagnostics run surfaces every one of those issues with the correct severity; 100% coverage of the v1 check list is verifiable by seeded test fixtures.
- **SC-002**: From opening the diagnostics view to producing the initial report on a typical power-user rule set (up to 500 rules), the user sees results in under 2 seconds on a standard desktop browser.
- **SC-003**: On a stress rule set of 2,000 rules, diagnostics completes and renders the initial report in under 5 seconds and does not block UI interactions (scrolling, clicking elsewhere) for more than 100 ms at a time during the run.
- **SC-004**: Every finding the user can see in the report includes a one-sentence explanation that stands on its own; in usability review, reviewers correctly describe the issue a finding refers to from its message alone in at least 90% of randomly sampled findings.
- **SC-005**: Zero rules are created, updated, or deleted as a side effect of running diagnostics or of interacting with any finding in the diagnostics view; this is observable by taking a full rule-set diff before and after an end-to-end diagnostics session that does not involve the rule editor.
- **SC-006**: Users who previously relied on the rules page to find broken or redundant rules report that they can now identify the same issues in at least 50% less time, measured as wall-clock time from "start looking" to "have a list of rules to fix".
- **SC-007**: The diagnostics run is reproducible: running diagnostics twice in a row without changing the working set produces identical reports (same finding codes, same affected rules, same grouping), verifiable by a deterministic equality check.

## Assumptions

- Diagnostics is an advisory, read-only feature in v1. All fixes (edit, merge, delete) continue to happen through the existing rule management flows, and users accept the extra click to jump from a finding into the rule editor.
- The diagnostics view evaluates the user's working set (server snapshot + unsaved staged changes) rather than the raw server snapshot, matching user intent to lint what they are about to save.
- Duplicate detection is structural — it compares normalized condition and action sets for equality, ignoring ordering and cosmetic whitespace. It does not attempt semantic equivalence across different operators (for example, `is "X"` vs. `oneOf ["X"]` may be treated as non-equal in v1).
- "Near-duplicate" is defined narrowly as "differs by at most one or two conditions or actions" to avoid producing a noisy long tail of low-confidence suggestions.
- "Broad match" uses a small, fixed character-length threshold for suspicious `contains` values; the threshold is a product choice that can be tuned without changing the spec.
- Shadow detection is conservative: only strictly-shadowed rules (where the shadowing rule's conditions are a superset or equal and its actions fully overwrite the shadowed rule's outputs) are flagged in v1. Heuristic overlap detection is explicitly out of scope for v1.
- The v2 nice-to-haves listed in the roadmap (heuristic overlap detection, merge suggestions, action-override warnings across the same processing flow, template/grouped-category suggestions) are out of scope for this spec. A follow-up spec may add them once v1 is validated.
- Findings are surfaced in-app only; CSV export of the diagnostics report and persistent "ignore / snooze" of individual findings are out of scope for v1.
- Entity existence checks cover the entity types already referenceable from the rule builder today (payees, categories, accounts, category groups). New entity types added to the rule builder in the future will need corresponding check coverage.
- The feature depends on the rule working set, the entity catalogs, and the existing rule management entry point being available; it inherits the connection model used elsewhere in the product and does not introduce its own connection handling.
