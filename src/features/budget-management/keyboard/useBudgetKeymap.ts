"use client";

import { useCallback } from "react";
import { matchAction } from "./keymap";
import type { Scope } from "./scopes";
import type {
  CellContext,
  CellEditContext,
  GroupCellContext,
  RowLabelContext,
  WorkspaceContext,
} from "./context";
import {
  CELL_HANDLERS,
  CELL_EDIT_HANDLERS,
  GROUP_CELL_HANDLERS,
  ROW_LABEL_HANDLERS,
  WORKSPACE_HANDLERS,
  type ActionHandler,
} from "./handlers";

/**
 * Per-scope dispatch + hooks.
 *
 * `dispatch*` are plain functions safe to call inline from any `onKeyDown`
 * — useful when the context depends on per-row data (e.g. category id) so
 * a hook would need to be called inside a loop. The `use*Keymap` hooks
 * wrap the same dispatch in `useCallback` for the common single-instance
 * case (BudgetCell, GroupMonthAggregate, BudgetWorkspace).
 */

function dispatch<Ctx>(
  e: React.KeyboardEvent,
  scope: Scope,
  ctx: Ctx,
  handlers: Partial<Record<string, ActionHandler<Ctx>>>
) {
  const action = matchAction(e, scope);
  if (!action) return;
  const handler = handlers[action];
  if (!handler) return;
  const result = handler(e, ctx);
  if (result === false) return; // explicit no-op — let the event continue
  e.preventDefault();
}

// ─── Plain dispatchers (callable inline) ──────────────────────────────────

export function dispatchCell(e: React.KeyboardEvent, ctx: CellContext) {
  dispatch(e, "cell", ctx, CELL_HANDLERS);
}
export function dispatchCellEdit(e: React.KeyboardEvent, ctx: CellEditContext) {
  dispatch(e, "cell-edit", ctx, CELL_EDIT_HANDLERS);
}
export function dispatchGroupCell(e: React.KeyboardEvent, ctx: GroupCellContext) {
  dispatch(e, "group-cell", ctx, GROUP_CELL_HANDLERS);
}
export function dispatchRowLabel(e: React.KeyboardEvent, ctx: RowLabelContext) {
  dispatch(e, "row-label", ctx, ROW_LABEL_HANDLERS);
}
export function dispatchWorkspace(e: React.KeyboardEvent, ctx: WorkspaceContext) {
  dispatch(e, "workspace", ctx, WORKSPACE_HANDLERS);
}

// ─── Hooks (single-instance components) ───────────────────────────────────

export function useCellKeymap(ctx: CellContext) {
  return useCallback((e: React.KeyboardEvent) => dispatchCell(e, ctx), [ctx]);
}

export function useCellEditKeymap(ctx: CellEditContext) {
  return useCallback((e: React.KeyboardEvent) => dispatchCellEdit(e, ctx), [ctx]);
}

export function useGroupCellKeymap(ctx: GroupCellContext) {
  return useCallback((e: React.KeyboardEvent) => dispatchGroupCell(e, ctx), [ctx]);
}

export function useRowLabelKeymap(ctx: RowLabelContext) {
  return useCallback((e: React.KeyboardEvent) => dispatchRowLabel(e, ctx), [ctx]);
}

export function useWorkspaceKeymap(ctx: WorkspaceContext) {
  return useCallback((e: React.KeyboardEvent) => dispatchWorkspace(e, ctx), [ctx]);
}
