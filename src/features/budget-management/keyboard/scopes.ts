/**
 * Scope = which surface the keyboard event originated from. Determines which
 * subset of the keymap is active. A digit pressed in `cell-edit` types into
 * the input; the same digit in `cell` opens edit mode — encoded by scope,
 * not by branching logic.
 */
export type Scope =
  | "cell"          // budget cell, selected but not editing
  | "cell-edit"     // budget cell, input focused
  | "group-cell"    // group month aggregate (first column of a group row's data)
  | "row-label"     // first-column label cell (group or category name)
  | "workspace";    // outermost workspace container — global shortcuts
