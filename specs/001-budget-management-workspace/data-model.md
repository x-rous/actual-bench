# Data Model: Budget Management Workspace

All types live in `src/features/budget-management/types.ts` unless noted.

---

## Core domain types

### `BudgetMode`

```ts
type BudgetMode = "envelope" | "tracking" | "unidentified";
```

Lowercase canonical form for the feature. Mapped from the overview's
`"Envelope" | "Tracking" | "Unidentified"` at the hook boundary.

---

### `BudgetCellKey`

```ts
type BudgetCellKey = `${string}:${string}`; // `${month}:${categoryId}`
// e.g. "2026-03:106963b3-ab82-4734-ad70-1d7dc2a52ff4"
```

Composite key used to address individual budget cells. Uniquely identifies
a category-month intersection.

---

### `LoadedMonthSummary`

Source: `GET /months/{month}` → `data` object.

```ts
type LoadedMonthSummary = {
  month: string;                // "2026-03"
  incomeAvailable: number;      // minor units
  lastMonthOverspent: number;
  forNextMonth: number;
  totalBudgeted: number;
  toBudget: number;             // envelope: available to assign; tracking: informational
  fromLastMonth: number;
  totalIncome: number;
  totalSpent: number;
  totalBalance: number;
};
```

**Validation rules**:
- `month` must match `/^\d{4}-\d{2}$/`
- All numeric fields are integers in minor units (100ths of currency unit)

---

### `LoadedBudgetCategory`

Source: nested inside `GET /months/{month}/categorygroups` → `categories[]`,
or flattened from `GET /months/{month}/categories`.

```ts
type LoadedBudgetCategory = {
  id: string;
  name: string;
  groupId: string;
  groupName: string;        // denormalised at load time from the parent group
  isIncome: boolean;
  hidden: boolean;
  budgeted: number;         // minor units
  spent: number;            // minor units (negative for expenses)
  balance: number;          // minor units
  carryover: boolean;       // read-only in v1
};
```

---

### `LoadedCategoryGroup`

Source: `GET /months/{month}/categorygroups` → `data[]`.

```ts
type LoadedCategoryGroup = {
  id: string;
  name: string;
  isIncome: boolean;
  hidden: boolean;
  budgeted: number;         // group totals
  spent: number;
  balance: number;
  categories: LoadedBudgetCategory[];
};
```

---

### `LoadedMonthData`

Assembled client-side from a `GET /months/{month}/categorygroups` response.

```ts
type LoadedMonthData = {
  month: string;
  summary: LoadedMonthSummary;
  groups: LoadedCategoryGroup[];
  categories: LoadedBudgetCategory[];   // flat list, derived from groups at load time
};
```

**Identity**: `month` is the unique key.
**Lifecycle**: loaded on page mount and on month-range changes; invalidated after any
successful save or envelope immediate action affecting that month.

---

### `StagedBudgetEdit`

Stored in `src/store/budgetEdits.ts` as `Record<BudgetCellKey, StagedBudgetEdit>`.

```ts
type StagedBudgetEdit = {
  month: string;
  categoryId: string;
  nextBudgeted: number;          // minor units — the proposed new value
  previousBudgeted: number;      // minor units — the loaded value being replaced
  source: "manual" | "paste" | "bulk-action" | "import";
  saveError?: string;            // set if last save attempt for this cell failed
};
```

**Validation rules**:
- `nextBudgeted` must be an integer (arithmetic expressions resolved before staging)
- A `StagedBudgetEdit` must not exist for a cell whose category is income AND the active
  budget mode is `"envelope"` (hard-blocked by the UI before staging)

**Lifecycle**:
- Created by: manual cell edit, paste, bulk action confirm, import confirm
- Cleared by: discard all, successful individual save, undo past the edit
- Persisted to: `PATCH /months/{month}/categories/{categoryId}` during save

---

### `BudgetEditSnapshot`

Used by undo/redo in `budgetEditsStore`.

```ts
type BudgetEditSnapshot = Record<BudgetCellKey, StagedBudgetEdit>;
```

---

### `BudgetCellSelection`

Local state within the workspace — not persisted.

```ts
type BudgetCellSelection = {
  anchorMonth: string;
  anchorCategoryId: string;
  focusMonth: string;
  focusCategoryId: string;
};
```

Resolved to a rectangular set of `(month, categoryId)` pairs by comparing positions
in the month column list and category row list.

---

### `BudgetSelectionSummary`

Derived from `BudgetCellSelection` + `StagedBudgetEdit` map.

```ts
type BudgetSelectionSummary = {
  selectedMonths: string[];
  selectedCategoryIds: string[];
  totalCellsInSelection: number;
  affectedCellCount: number;         // cells in selection that have a staged edit
  totalStagedDelta: number;          // Σ(nextBudgeted − previousBudgeted) for staged cells in selection
};
```

---

### `BudgetSaveResult`

Returned by `useBudgetSave` after a save attempt.

```ts
type BudgetSaveResult = {
  month: string;
  categoryId: string;
  status: "success" | "error";
  message?: string;
};
```

---

### `CategoryTransferInput`

Input for `POST /months/{month}/categorytransfers`.

```ts
type CategoryTransferInput = {
  fromCategoryId: string;   // required in v1 (pool routing deferred)
  toCategoryId: string;     // required in v1 (pool routing deferred)
  amount: number;           // minor units, must be > 0
};
```

---

### `NextMonthHoldInput`

Input for `POST /months/{month}/nextmonthbudgethold`.

```ts
type NextMonthHoldInput = {
  amount: number;           // minor units, must be > 0
};
```

---

## Budget edits store shape (`src/store/budgetEdits.ts`)

Not a generic `StagedMap` — standalone Zustand store.

```ts
type BudgetEditsState = {
  edits: Record<BudgetCellKey, StagedBudgetEdit>;
  undoStack: BudgetEditSnapshot[];
  redoStack: BudgetEditSnapshot[];
};

type BudgetEditsActions = {
  stageEdit: (edit: StagedBudgetEdit) => void;
  stageBulkEdits: (edits: StagedBudgetEdit[]) => void;  // atomic undo
  discardAll: () => void;
  clearEditsForMonths: (months: string[]) => void;      // called after successful save
  setSaveError: (key: BudgetCellKey, message: string) => void;
  clearSaveError: (key: BudgetCellKey) => void;
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
  hasPendingEdits: () => boolean;
};
```

Key design rules:
- `stageEdit` pushes undo **automatically** for manual single-cell edits
- `stageBulkEdits` pushes undo **once** before applying all edits (bulk ops are one undo step)
- Import confirm uses `stageBulkEdits`
- Paste uses `stageBulkEdits`

---

## State ownership summary

| State | Owner | Notes |
|---|---|---|
| Available months list | TanStack Query `["budget-months", connectionId]` | From `GET /months` |
| Loaded month data | TanStack Query `["budget-month-data", connectionId, month]` | Per month, from `GET /months/{month}/categorygroups` |
| Staged budget edits | `budgetEditsStore` | Local only until save |
| Budget mode | TanStack Query `["budget-mode", connectionId]` | Derived from ActualQL query |
| Active month range | Local state in `BudgetManagementView` | User-controlled |
| Cell selection | Local state in `BudgetWorkspace` | Ephemeral UI |
| Import/export state | Local state in dialog components | Ephemeral UI |
