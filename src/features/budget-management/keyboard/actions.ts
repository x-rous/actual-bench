/**
 * Catalogue of every keyboard-triggered action in the Budget Management
 * Workspace. Phase 0 includes only the shortcuts that were already wired
 * before the keymap migration; later phases extend this union.
 *
 * Action IDs are scope-shared where it makes sense: `cell.move-up` runs in
 * both `cell` and `group-cell` scopes via per-scope handler maps.
 */
export type ActionId =
  // ─── Cell navigation (cell, group-cell, row-label) ──────────────────────
  | "cell.move-up"
  | "cell.move-down"
  | "cell.move-left"
  | "cell.move-right"
  | "cell.tab-forward"
  | "cell.tab-backward"
  // ─── Tier 1 viewport / section nav (cell, group-cell, row-label) ────────
  | "cell.move-page-up"
  | "cell.move-page-down"
  | "cell.move-row-start"
  | "cell.move-row-end"
  | "cell.move-grid-start"
  | "cell.move-grid-end"
  | "cell.move-section-up"
  | "cell.move-section-down"
  // ─── Range extension (cell only) ────────────────────────────────────────
  | "cell.extend-up"
  | "cell.extend-down"
  | "cell.extend-left"
  | "cell.extend-right"
  | "cell.extend-page-up"
  | "cell.extend-page-down"
  | "cell.extend-row-start"
  | "cell.extend-row-end"
  | "cell.extend-grid-start"
  | "cell.extend-grid-end"
  // ─── Cell editing entry (cell) ──────────────────────────────────────────
  | "cell.start-edit"
  | "cell.start-edit-with-char"
  | "cell.clear-value"
  // ─── Inside the input (cell-edit) ───────────────────────────────────────
  | "edit.commit-down"
  | "edit.commit-tab"
  | "edit.commit-shift-tab"
  | "edit.cancel"
  // ─── Group collapse toggle (group-cell, row-label) ──────────────────────
  | "group.toggle-collapse"
  // ─── Workspace ──────────────────────────────────────────────────────────
  | "history.undo"
  | "history.redo"
  | "selection.copy"
  | "selection.zero"
  // ─── Tier 2 range-edit (workspace) ──────────────────────────────────────
  | "selection.fill-from-active"
  | "selection.fill-down"
  | "selection.fill-right"
  | "selection.fill-prev-month"
  | "selection.fill-avg-3"
  // ─── Tier 3 view & visibility (workspace) ───────────────────────────────
  | "view.cycle-cell-view"
  | "view.toggle-show-hidden"
  | "view.expand-all"
  | "view.collapse-all"
  | "view.pan-months-prev"
  | "view.pan-months-next"
  | "view.open-category-search"
  | "view.open-spending-details"
  // ─── Tier 4 selection actions (workspace) ───────────────────────────────
  | "selection.toggle-carryover"
  // ─── Discoverability ────────────────────────────────────────────────────
  | "help.open-shortcuts";

export type ActionCategory =
  | "navigation"
  | "range"      // shift-* range extension
  | "editing"
  | "selection"  // copy / zero / fill-* / carryover
  | "view"
  | "history"
  | "help";

export type ActionMeta = {
  id: ActionId;
  label: string;
  category: ActionCategory;
  description?: string;
};

/**
 * Single source of truth for human-readable shortcut metadata. The future
 * cheatsheet renders directly from this map joined with `DEFAULT_KEYMAP`,
 * so adding a new action here + a binding in `keymap.ts` is enough to
 * surface it in the help modal.
 */
export const ACTION_META: Record<ActionId, ActionMeta> = {
  "cell.move-up":     { id: "cell.move-up",     label: "Move up",     category: "navigation" },
  "cell.move-down":   { id: "cell.move-down",   label: "Move down",   category: "navigation" },
  "cell.move-left":   { id: "cell.move-left",   label: "Move left",   category: "navigation" },
  "cell.move-right":  { id: "cell.move-right",  label: "Move right",  category: "navigation" },
  "cell.tab-forward": { id: "cell.tab-forward", label: "Next cell (wraps to next row)",     category: "navigation" },
  "cell.tab-backward":{ id: "cell.tab-backward",label: "Previous cell (wraps to prev row)", category: "navigation" },

  "cell.move-page-up":     { id: "cell.move-page-up",     label: "Page up",                   category: "navigation" },
  "cell.move-page-down":   { id: "cell.move-page-down",   label: "Page down",                 category: "navigation" },
  "cell.move-row-start":   { id: "cell.move-row-start",   label: "Jump to first month",       category: "navigation" },
  "cell.move-row-end":     { id: "cell.move-row-end",     label: "Jump to last month",        category: "navigation" },
  "cell.move-grid-start":  { id: "cell.move-grid-start",  label: "Jump to top-left of grid",  category: "navigation" },
  "cell.move-grid-end":    { id: "cell.move-grid-end",    label: "Jump to bottom-right of grid", category: "navigation" },
  "cell.move-section-up":  { id: "cell.move-section-up",  label: "Previous section (group)",  category: "navigation" },
  "cell.move-section-down":{ id: "cell.move-section-down",label: "Next section (group)",      category: "navigation" },

  "cell.extend-up":    { id: "cell.extend-up",    label: "Extend up",    category: "range" },
  "cell.extend-down":  { id: "cell.extend-down",  label: "Extend down",  category: "range" },
  "cell.extend-left":  { id: "cell.extend-left",  label: "Extend left",  category: "range" },
  "cell.extend-right": { id: "cell.extend-right", label: "Extend right", category: "range" },
  "cell.extend-page-up":   { id: "cell.extend-page-up",   label: "Extend page up",            category: "range" },
  "cell.extend-page-down": { id: "cell.extend-page-down", label: "Extend page down",          category: "range" },
  "cell.extend-row-start": { id: "cell.extend-row-start", label: "Extend to first month",     category: "range" },
  "cell.extend-row-end":   { id: "cell.extend-row-end",   label: "Extend to last month",      category: "range" },
  "cell.extend-grid-start":{ id: "cell.extend-grid-start",label: "Extend to top-left",        category: "range" },
  "cell.extend-grid-end":  { id: "cell.extend-grid-end",  label: "Extend to bottom-right",    category: "range" },

  "cell.start-edit":           { id: "cell.start-edit",           label: "Start editing cell",         category: "editing" },
  "cell.start-edit-with-char": { id: "cell.start-edit-with-char", label: "Start editing with typed character", category: "editing" },
  "cell.clear-value":          { id: "cell.clear-value",          label: "Clear cell value (zero)",    category: "editing" },

  "edit.commit-down":      { id: "edit.commit-down",      label: "Commit and move down",  category: "editing" },
  "edit.commit-tab":       { id: "edit.commit-tab",       label: "Commit and move right", category: "editing" },
  "edit.commit-shift-tab": { id: "edit.commit-shift-tab", label: "Commit and move left",  category: "editing" },
  "edit.cancel":           { id: "edit.cancel",           label: "Cancel edit",           category: "editing" },

  "group.toggle-collapse": { id: "group.toggle-collapse", label: "Collapse / expand group", category: "view" },

  "history.undo":     { id: "history.undo",     label: "Undo",                 category: "history" },
  "history.redo":     { id: "history.redo",     label: "Redo",                 category: "history" },
  "selection.copy":   { id: "selection.copy",   label: "Copy selection",       category: "selection" },
  "selection.zero":   { id: "selection.zero",   label: "Zero selected cells",  category: "selection" },

  "selection.fill-from-active": {
    id: "selection.fill-from-active",
    label: "Fill selection with active cell's value",
    category: "selection",
  },
  "selection.fill-down":  { id: "selection.fill-down",  label: "Fill down (per column)",  category: "selection" },
  "selection.fill-right": { id: "selection.fill-right", label: "Fill right (per row)",    category: "selection" },
  "selection.fill-prev-month": {
    id: "selection.fill-prev-month",
    label: "Fill with previous month's value (per row)",
    category: "selection",
  },
  "selection.fill-avg-3": {
    id: "selection.fill-avg-3",
    label: "Fill with 3-month average (per row)",
    category: "selection",
  },

  "view.cycle-cell-view":  { id: "view.cycle-cell-view",  label: "Cycle view: Budgeted → Spent → Balance", category: "view" },
  "view.toggle-show-hidden": { id: "view.toggle-show-hidden", label: "Toggle hidden categories",         category: "view" },
  "view.expand-all":   { id: "view.expand-all",   label: "Expand all groups",   category: "view" },
  "view.collapse-all": { id: "view.collapse-all", label: "Collapse all groups", category: "view" },
  "view.pan-months-prev": { id: "view.pan-months-prev", label: "Pan visible months one earlier", category: "view" },
  "view.pan-months-next": { id: "view.pan-months-next", label: "Pan visible months one later",   category: "view" },
  "view.open-category-search": {
    id: "view.open-category-search",
    label: "Jump to category",
    category: "navigation",
  },
  "view.open-spending-details": {
    id: "view.open-spending-details",
    label: "Open spending details",
    category: "view",
  },

  "selection.toggle-carryover": {
    id: "selection.toggle-carryover",
    label: "Toggle carryover (rollover) on selected months",
    category: "selection",
    description: "Anchor category only — multi-category selections fall back to the anchor's category",
  },

  "help.open-shortcuts": {
    id: "help.open-shortcuts",
    label: "Show keyboard shortcuts",
    category: "help",
  },
};
