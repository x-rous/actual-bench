# Quickstart: Budget Management Workspace

## What this feature adds

A new page at `/budget-management` that provides a multi-month budget editing grid with staged-safe cell edits, bulk actions, CSV import/export, and envelope-mode category transfers. This is an advanced power-user workbench layered on top of the Budget Months API.

---

## Prerequisites

- A running `actual-http-api` instance with at least one budget open.
- An active connection in Actual Bench (server URL + password + sync ID configured).
- Budget Months API available (all endpoints listed in `contracts/budget-months-api.ts`).

---

## New files introduced by this feature

```
src/
├── app/(app)/budget-management/
│   └── page.tsx                              # Route entry point
│
├── features/budget-management/
│   ├── components/
│   │   ├── BudgetManagementView.tsx          # Top-level page shell
│   │   ├── BudgetWorkspace.tsx               # Grid + toolbar composite
│   │   ├── BudgetGrid.tsx                    # Category × month cell grid
│   │   ├── BudgetCell.tsx                    # Individual editable cell
│   │   ├── BudgetToolbar.tsx                 # Month range picker + action buttons
│   │   ├── BudgetContextPanel.tsx            # Side panel: spent, balance, carryover
│   │   ├── BudgetSavePanel.tsx               # Staged review + save confirmation
│   │   ├── BulkActionDialog.tsx              # Bulk edit modal
│   │   ├── BudgetExportDialog.tsx            # CSV export modal
│   │   ├── BudgetImportDialog.tsx            # CSV import + preview modal
│   │   ├── CategoryTransferDialog.tsx        # Envelope-only transfer modal
│   │   └── NextMonthHoldDialog.tsx           # Envelope-only hold modal
│   │
│   ├── hooks/
│   │   ├── useBudgetMode.ts                  # ActualQL → BudgetMode
│   │   ├── useAvailableMonths.ts             # GET /months
│   │   ├── useMonthData.ts                   # GET /months/{month}/categorygroups
│   │   ├── useBudgetSave.ts                  # Sequential PATCH pipeline
│   │   ├── useBulkAction.ts                  # Bulk staging logic
│   │   ├── useCategoryTransfer.ts            # Immediate POST /categorytransfers
│   │   └── useNextMonthHold.ts               # Immediate POST/DELETE /nextmonthbudgethold
│   │
│   ├── lib/
│   │   ├── budgetMath.ts                     # Arithmetic expression parser
│   │   ├── budgetValidation.ts               # Large-change threshold, income-block guard
│   │   ├── budgetCsv.ts                      # CSV serialize/deserialize + import matching
│   │   └── budgetSelectionUtils.ts           # Rect selection → cell set resolution
│   │
│   └── types.ts                              # All domain types (see data-model.md)
│
└── store/
    └── budgetEdits.ts                        # Zustand store: edits + undo/redo
```

---

## Key architectural boundaries

| Concern | Location | Pattern |
|---|---|---|
| Available months | `useAvailableMonths` | TanStack Query `["budget-months", connectionId]` |
| Per-month category data | `useMonthData(month)` | TanStack Query `["budget-month-data", connectionId, month]` |
| Pending cell edits | `budgetEditsStore` | Zustand — local until save |
| Budget mode | `useBudgetMode` | TanStack Query `["budget-mode", connectionId]` |
| Save pipeline | `useBudgetSave` | Feature-local; sequential PATCH loop |
| Envelope actions | `useCategoryTransfer`, `useNextMonthHold` | Immediate API call; bypass staged pipeline |

---

## Running locally

```bash
npm run dev          # starts Next.js with Turbopack
```

Navigate to `http://localhost:3000/budget-management` after connecting a budget.

---

## Testing

```bash
npm run lint         # 0 errors required
npx tsc --noEmit     # 0 type errors required
npm test             # all suites must pass
```

Unit test entry points live alongside each module:
- `src/features/budget-management/lib/budgetMath.test.ts`
- `src/features/budget-management/lib/budgetCsv.test.ts`
- `src/features/budget-management/lib/budgetValidation.test.ts`
- `src/store/budgetEdits.test.ts`

---

## Envelope-mode awareness

The page reads budget mode via `useBudgetMode`. When mode is `"envelope"`, transfer and hold UI elements are rendered. When mode is `"tracking"` or `"unidentified"`, those elements are hidden entirely. Income category cells are hard-blocked from editing in envelope mode regardless of user action.

---

## Notes for reviewers

- Budget cell saves are **sequential** — the feature issues one `PATCH` at a time per cell, not a parallel flood. This is intentional per spec FR-019.
- Envelope actions (category transfers, next-month hold) are **immediate** — they do NOT go through the staged save panel. The UI makes this explicit with a confirm-then-persist modal.
- Carryover is **read-only** in v1 — shown in the context panel, not editable.
