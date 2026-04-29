import type { ActionId } from "./actions";
import type {
  CellContext,
  CellEditContext,
  GroupCellContext,
  RowLabelContext,
  WorkspaceContext,
} from "./context";

/**
 * Per-scope handler maps. Each handler returns:
 *   - `true` / `void`  → action ran; dispatcher will `preventDefault`.
 *   - `false`          → action was a no-op (skip preventDefault, let the
 *                        event continue / fall through to other handlers).
 *
 * This is only used for Phase 0 shortcuts. New shortcuts add a row in
 * `keymap.ts` and a function here.
 */
export type ActionHandler<Ctx> = (
  e: React.KeyboardEvent,
  ctx: Ctx
) => boolean | void;

// ─── Cell scope ───────────────────────────────────────────────────────────

export const CELL_HANDLERS: Partial<Record<ActionId, ActionHandler<CellContext>>> = {
  "cell.move-up":     (_e, ctx) => ctx.navigate("up"),
  "cell.move-down":   (_e, ctx) => ctx.navigate("down"),
  "cell.move-left":   (_e, ctx) => ctx.navigate("left"),
  "cell.move-right":  (_e, ctx) => ctx.navigate("right"),
  "cell.extend-up":   (_e, ctx) => ctx.navigate("shift-up"),
  "cell.extend-down": (_e, ctx) => ctx.navigate("shift-down"),
  "cell.extend-left": (_e, ctx) => ctx.navigate("shift-left"),
  "cell.extend-right":(_e, ctx) => ctx.navigate("shift-right"),
  "cell.tab-forward": (_e, ctx) => ctx.navigate("tab"),
  "cell.tab-backward":(_e, ctx) => ctx.navigate("shift-tab"),
  "cell.move-page-up":     (_e, ctx) => ctx.navigate("page-up"),
  "cell.move-page-down":   (_e, ctx) => ctx.navigate("page-down"),
  "cell.move-row-start":   (_e, ctx) => ctx.navigate("row-start"),
  "cell.move-row-end":     (_e, ctx) => ctx.navigate("row-end"),
  "cell.move-grid-start":  (_e, ctx) => ctx.navigate("grid-start"),
  "cell.move-grid-end":    (_e, ctx) => ctx.navigate("grid-end"),
  "cell.move-section-up":  (_e, ctx) => ctx.navigate("section-up"),
  "cell.move-section-down":(_e, ctx) => ctx.navigate("section-down"),
  "cell.extend-page-up":    (_e, ctx) => ctx.navigate("shift-page-up"),
  "cell.extend-page-down":  (_e, ctx) => ctx.navigate("shift-page-down"),
  "cell.extend-row-start":  (_e, ctx) => ctx.navigate("shift-row-start"),
  "cell.extend-row-end":    (_e, ctx) => ctx.navigate("shift-row-end"),
  "cell.extend-grid-start": (_e, ctx) => ctx.navigate("shift-grid-start"),
  "cell.extend-grid-end":   (_e, ctx) => ctx.navigate("shift-grid-end"),
  "cell.start-edit": (_e, ctx) => {
    if (ctx.blocked || ctx.viewBlocked) return false;
    ctx.enterEdit();
  },
  "cell.start-edit-with-char": (e, ctx) => {
    if (ctx.blocked || ctx.viewBlocked) return false;
    ctx.enterEdit(e.key);
  },
  "cell.clear-value": (_e, ctx) => {
    // Old behavior: Delete/Backspace is always swallowed in cell scope —
    // even on blocked cells, the event must not fall through to browser
    // defaults (e.g. Backspace → history.back) or to the workspace
    // multi-cell zero. Return void in both branches to ensure preventDefault.
    if (ctx.blocked || ctx.viewBlocked) return;
    ctx.clearValue();
  },
};

// ─── Cell-edit scope (input focused) ──────────────────────────────────────

export const CELL_EDIT_HANDLERS: Partial<Record<ActionId, ActionHandler<CellEditContext>>> = {
  "edit.commit-down": (_e, ctx) => {
    if (ctx.commitEdit()) ctx.navigate("down");
  },
  "edit.commit-tab": (_e, ctx) => {
    if (ctx.commitEdit()) ctx.navigate("tab");
  },
  "edit.commit-shift-tab": (_e, ctx) => {
    if (ctx.commitEdit()) ctx.navigate("shift-tab");
  },
  "edit.cancel": (_e, ctx) => {
    ctx.cancelEdit();
  },
};

// ─── Group-cell scope (group month aggregate) ─────────────────────────────

export const GROUP_CELL_HANDLERS: Partial<Record<ActionId, ActionHandler<GroupCellContext>>> = {
  "cell.move-up":     (_e, ctx) => ctx.navigate("up"),
  "cell.move-down":   (_e, ctx) => ctx.navigate("down"),
  "cell.move-left":   (_e, ctx) => ctx.navigate("left"),
  "cell.move-right":  (_e, ctx) => ctx.navigate("right"),
  "cell.tab-forward": (_e, ctx) => ctx.navigate("tab"),
  "cell.tab-backward":(_e, ctx) => ctx.navigate("shift-tab"),
  "cell.move-page-up":     (_e, ctx) => ctx.navigate("page-up"),
  "cell.move-page-down":   (_e, ctx) => ctx.navigate("page-down"),
  "cell.move-row-start":   (_e, ctx) => ctx.navigate("row-start"),
  "cell.move-row-end":     (_e, ctx) => ctx.navigate("row-end"),
  "cell.move-grid-start":  (_e, ctx) => ctx.navigate("grid-start"),
  "cell.move-grid-end":    (_e, ctx) => ctx.navigate("grid-end"),
  "cell.move-section-up":  (_e, ctx) => ctx.navigate("section-up"),
  "cell.move-section-down":(_e, ctx) => ctx.navigate("section-down"),
  "group.toggle-collapse": (_e, ctx) => ctx.toggleCollapse(),
};

// ─── Row-label scope (first-column label cell) ────────────────────────────

export const ROW_LABEL_HANDLERS: Partial<Record<ActionId, ActionHandler<RowLabelContext>>> = {
  "cell.move-up":     (_e, ctx) => ctx.navigate("up"),
  "cell.move-down":   (_e, ctx) => ctx.navigate("down"),
  // Already in the leftmost column — match the binding but no-op.
  "cell.move-left":   () => false,
  "cell.move-right":  (_e, ctx) => ctx.navigate("right"),
  "cell.tab-forward": (_e, ctx) => ctx.navigate("tab"),
  "cell.tab-backward":(_e, ctx) => ctx.navigate("shift-tab"),
  "cell.move-page-up":     (_e, ctx) => ctx.navigate("page-up"),
  "cell.move-page-down":   (_e, ctx) => ctx.navigate("page-down"),
  "cell.move-grid-start":  (_e, ctx) => ctx.navigate("grid-start"),
  "cell.move-grid-end":    (_e, ctx) => ctx.navigate("grid-end"),
  "cell.move-section-up":  (_e, ctx) => ctx.navigate("section-up"),
  "cell.move-section-down":(_e, ctx) => ctx.navigate("section-down"),
  "group.toggle-collapse": (_e, ctx) => {
    if (!ctx.toggleCollapse) return false; // category rows don't toggle
    ctx.toggleCollapse();
  },
};

// ─── Workspace scope ──────────────────────────────────────────────────────

export const WORKSPACE_HANDLERS: Partial<Record<ActionId, ActionHandler<WorkspaceContext>>> = {
  "history.undo":   (_e, ctx) => ctx.undo(),
  "history.redo":   (_e, ctx) => ctx.redo(),
  "selection.copy": (_e, ctx) => {
    // Only swallow Ctrl+C when we actually copied something; otherwise
    // let the browser's default Ctrl+C behave normally.
    return ctx.copySelection();
  },
  "selection.zero": (_e, ctx) => ctx.zeroMultiCellSelection(),
  "selection.fill-from-active": (_e, ctx) => ctx.fillFromActive(),
  "selection.fill-down":        (_e, ctx) => ctx.fillDown(),
  "selection.fill-right":       (_e, ctx) => ctx.fillRight(),
  "selection.fill-prev-month":  (_e, ctx) => ctx.fillPrevMonth(),
  "selection.fill-avg-3":       (_e, ctx) => ctx.fillAvg3(),
  "view.cycle-cell-view":     (_e, ctx) => ctx.cycleCellView(),
  "view.toggle-show-hidden":  (_e, ctx) => ctx.toggleShowHidden(),
  "view.expand-all":          (_e, ctx) => ctx.expandAll(),
  "view.collapse-all":        (_e, ctx) => ctx.collapseAll(),
  "view.pan-months-prev":     (_e, ctx) => ctx.panMonthsPrev(),
  "view.pan-months-next":     (_e, ctx) => ctx.panMonthsNext(),
  "selection.toggle-carryover": (_e, ctx) => ctx.toggleCarryoverForSelection(),
  "help.open-shortcuts":        (_e, ctx) => ctx.openShortcutsHelp(),
};
