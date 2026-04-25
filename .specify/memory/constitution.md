<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.0.1
Bump type: PATCH

Modified principles:
  VI. User Clarity, Reviewability, and Trust
      — Strengthened "reasonably accessible" (vague) to MUST with explicit
        assistive-technology requirements (ARIA labels, keyboard navigation,
        screen reader support). The prior wording did not prevent a category
        of accessibility omissions caught in review on 2026-04-16.

Added sections: none
Removed sections: none

Templates reviewed:
  ✅ .specify/templates/plan-template.md       — aligned (no principle-name refs)
  ✅ .specify/templates/spec-template.md       — aligned
  ✅ .specify/templates/tasks-template.md      — aligned
  ✅ .specify/templates/checklist-template.md  — aligned (generic scaffolding)
  ✅ .specify/templates/agent-file-template.md — aligned (generic scaffolding)
  ✅ .specify/templates/commands/              — empty; no files to review

Follow-up TODOs: none — all placeholders resolved, no deferred items.
-->

# Actual Bench Constitution

## Purpose

This constitution defines the durable product and engineering principles that govern Actual Bench.

It exists to keep specs, plans, tasks, and implementation decisions aligned with the product's core promises: staged safety, connection integrity, disciplined scope, and contributor-friendly consistency.

This document is intentionally principle-focused. It should remain stable as tooling, libraries, workflows, and internal structure evolve.

When this constitution conflicts with convenience, habit, or local preference, this constitution prevails.

---

## Core Principles

### I. Staged-First Safety

Actual Bench MUST preserve its staged-editing model as a core product guarantee.

Requirements:
- User mutations MUST remain local until the user explicitly chooses to save or apply them.
- Browsing, filtering, selecting, previewing, opening drawers, or inspecting data MUST NOT trigger upstream writes.
- New mutation flows MUST integrate cleanly with staged review, save, discard, and visibility patterns already established by the product.
- Destructive actions MUST require impact-aware confirmation before they are staged.
- Refresh, reconnect, and navigation flows MUST NOT silently discard staged work.
- Any intentional bypass of staged editing MUST be explicitly justified in the plan and clearly disclosed in the UI.

Rationale: Actual Bench's core trust model is review first, persist intentionally second.

### II. Controlled Connection Integrity

All browser-to-server communication MUST pass through an approved app-controlled boundary. Direct ad hoc browser access to upstream APIs is forbidden.

Requirements:
- Requests MUST use the approved application mediation path, not direct browser calls to upstream services.
- Credentials, connection details, and sensitive request context MUST remain inside the controlled application boundary.
- Per-connection isolation MUST be preserved at all times.
- Switching servers, budgets, or connection contexts MUST NOT leak staged data, cache state, or UI state across unrelated contexts.
- Server-scoped and budget-scoped behavior MUST remain explicit and safe.
- New networking behavior MUST respect sequencing and MUST avoid race-prone concurrency patterns.

Rationale: Architectural convenience must never override connection safety or data isolation.

### III. Workbench Scope Before Product Drift

Actual Bench MUST remain a power-user workbench for maintenance, diagnostics, inspection, imports/exports, rules, and advanced administration.

Requirements:
- New features MUST reinforce Actual Bench's role as an administrative and analytical workbench.
- Each feature SHOULD answer a clear product-fit question: why does this belong in Actual Bench?
- Admin workflows, bulk maintenance, diagnostics, and inspection SHOULD be favored over re-creating everyday budgeting flows already served elsewhere.
- Expansion into broader budgeting or transaction-management experiences MUST require explicit product justification.

Rationale: Clear scope boundaries preserve coherence, reduce drift, and keep the product strategically focused.

### IV. Brownfield Evolution Over Reinvention

Actual Bench is a brownfield codebase. Changes MUST begin from existing behavior, patterns, and documented intent rather than greenfield assumptions.

Requirements:
- Existing patterns, flows, and shared building blocks MUST be reused where they already solve the problem adequately.
- New abstractions, dependencies, architectural layers, or competing patterns MUST be justified in the plan.
- Product consistency, staged safety, and connection integrity MUST take precedence over convenience-driven shortcuts.
- Changes SHOULD evolve the codebase in place rather than introducing parallel ways of solving the same class of problem.

Rationale: Brownfield quality comes from restraint, reuse, and deliberate evolution.

### V. Clear Boundaries and Consistent Domain Modeling

Actual Bench MUST maintain clear boundaries between upstream data, internal domain models, staged edits, and ephemeral UI state.

Requirements:
- Translation of upstream contracts into app-facing models MUST occur at approved integration boundaries.
- Internal models SHOULD be stable, readable, and oriented toward product behavior rather than upstream quirks.
- State ownership MUST remain clear: server-derived state, staged state, and local UI state MUST not blur together without strong justification.
- Shared conventions that improve predictability and maintainability MUST be followed consistently.
- Detailed procedural or structural conventions SHOULD live in CONTRIBUTING and repository documentation unless they rise to the level of constitutional governance.

Rationale: Clear boundaries make the app safer to extend and easier to reason about.

### VI. User Clarity, Reviewability, and Trust

Actual Bench is user-facing in both product behavior and project hygiene. What ships MUST be understandable, predictable, and explainable.

Requirements:
- UI behavior SHOULD prefer meaningful, human-readable labels over raw internal identifiers wherever practical.
- Dense administrative workflows MUST remain operationally clear and accessible, including to users of assistive
  technologies: interactive controls MUST carry programmatically associated labels (e.g. `aria-label`, `htmlFor`/`id`
  pairings, or visually hidden text), and keyboard navigation MUST remain functional for all primary workflows.
- User-facing changes MUST be documented in the appropriate project documentation.
- Pull requests and release-facing summaries SHOULD be user-facing, reviewable, and easy to understand.
- Simplicity SHOULD be preferred over novelty unless added complexity brings clear user value.

Rationale: "Technically works" is not enough; the standard is clear, safe, trustworthy, and usable by everyone.

---

## Operating Constraints

Actual Bench operates under the following enduring constraints:

- It is a workbench for Actual Budget workflows, not a standalone budgeting backend.
- The staged-editing model is the default mutation model and MUST remain foundational.
- Live queries, diagnostics, and inspections SHOULD be treated as read-only unless explicitly designed otherwise.
- Where live results do not reflect unsaved staged changes, the UI MUST make that distinction clear.
- Multi-connection support MUST preserve isolation of staged state, cache state, and connection context.
- Maintenance-oriented interfaces SHOULD favor safe bulk actions, discoverable filtering, and reviewer-friendly workflows.
- Features that process or render large in-memory datasets MUST consider performance, failure modes, and user clarity.
- Read-only diagnostics for exported data SHOULD remain read-only unless the product explicitly expands that stance.

---

## Spec-Kit Artifact Contract

Spec-Kit artifacts MUST maintain strict separation of concerns.

### `spec.md`
- MUST define **what** is changing and **why** it matters.
- MUST stay focused on outcomes, requirements, constraints, and user value.
- MUST remain technology-agnostic except for unavoidable domain terminology.
- MUST NOT prescribe implementation details unless those details are themselves requirements.

### `plan.md`
- MUST define **how** the approved spec will be implemented.
- MUST document architecture decisions, data flow, reuse decisions, risks, tradeoffs, and file or system impact where relevant.
- MUST explicitly call out any exception to this constitution.

### `tasks.md`
- MUST convert the approved plan into executable work.
- MUST NOT introduce new requirements or expand scope beyond the approved spec and plan.
- SHOULD sequence work in a way that preserves safety, reviewability, and incremental validation.

### General Rule
Each artifact MUST refine the previous one, not replace it or contradict it.

Rationale: Clear separation improves decision quality and reduces requirement drift.

---

## Delivery Expectations

All implementation work MUST follow a disciplined delivery flow.

Requirements:
- Work MUST originate from an issue, roadmap item, approved spec, or clearly documented product need.
- Contributions MUST follow the current repository contribution process and quality gates defined in CONTRIBUTING and enforced by CI.
- Architectural deviations or intentional exceptions MUST be made explicit in the plan or PR description.
- User-facing changes MUST update relevant documentation before completion or release.
- Changes SHOULD remain reviewable, focused, and proportional to the problem being solved.
- Reviewer-friendly evidence, such as screenshots or concise behavioral notes, SHOULD be included where helpful.

Rationale: Good governance is not only about code quality; it is also about reviewability and operational clarity.

---

## Governance

This constitution supersedes informal habits and ad hoc implementation choices.

Governance rules:
- Specs, plans, tasks, pull requests, and reviews SHOULD be evaluated against this constitution.
- Non-compliant work MUST either be revised or explicitly approved as an exception.
- Each exception MUST record:
  - the affected principle or section
  - why compliance was not followed
  - the risk being accepted
  - any intended follow-up or cleanup
- Amendments to this constitution MUST be documented in-repo.
- Amendments SHOULD also identify which templates, workflows, or project documents must be updated as a result.
- The roadmap remains the source of truth for planned work.
- The feature reference remains the source of truth for shipped user-facing capability.
- When governance priorities conflict, prefer:
  1. user safety and trust
  2. staged integrity
  3. connection integrity
  4. clear product scope
  5. architectural consistency
  6. local convenience

---

## Amendment Versioning

This constitution uses semantic versioning:

- **MAJOR**: incompatible removals or redefinitions of governing principles
- **MINOR**: new principles, new sections, or materially expanded guidance
- **PATCH**: wording clarifications, examples, or non-semantic refinements

**Version**: 1.0.1 | **Ratified**: 2026-04-13 | **Last Amended**: 2026-04-16
