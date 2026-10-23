"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { getFeatureForPath } from "@/lib/features/catalogue";
import { getFeatureEntryState } from "@/lib/features/pendingChanges";
import { useStagedStore, selectHasChanges } from "@/store/staged";
import { useGlobalSearchStore } from "@/features/global-search/store/useGlobalSearchStore";
import { useQuickCreateStore } from "@/features/quick-create/store/useQuickCreateStore";

/**
 * Wires global shortcuts to the same draft owner as the panel controls.
 * Must be called once, inside a client component (AppShell).
 *
 * Ctrl/Cmd+Z        → undo
 * Ctrl/Cmd+Shift+Z  → redo
 * Ctrl/Cmd+Y        → redo (Windows convention)
 * Ctrl/Cmd+K        → open global search modal
 * Ctrl/Cmd+Shift+N  → open quick-create dialog (fires from anywhere)
 * N                 → open quick-create dialog (only when no input/dialog is focused)
 *
 * Undo/redo are suppressed inside text inputs so native browser undo is not
 * broken. Ctrl/Cmd+K and Ctrl/Cmd+Shift+N intentionally fire from anywhere,
 * including text inputs, consistent with standard modal-trigger conventions.
 */
export function useKeyboardShortcuts() {
  const pathname = usePathname();
  const openSearch = useGlobalSearchStore((s) => s.open);
  const openQuickCreate = useQuickCreateStore((s) => s.open);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      // `key` is absent on synthetic keydowns — browser autofill and some
      // password managers dispatch them — and this handler is bound to the
      // window on every page, so an unguarded read throws for the whole app.
      if (!e.key || e.defaultPrevented) return;
      const key = e.key.toLowerCase();

      // Bare "N" — open quick-create only when no input/dialog is focused
      if (!mod && !e.shiftKey && !e.altKey && key === "n") {
        const target = e.target as HTMLElement;
        const tag = target.tagName;
        const dialogOpen = !!document.querySelector('[role="dialog"]');
        if (!dialogOpen && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && !target.isContentEditable) {
          e.preventDefault();
          openQuickCreate();
          return;
        }
      }

      if (!mod) return;

      // Ctrl/Cmd+Shift+N — open quick-create from anywhere, including inside inputs
      if (e.shiftKey && key === "n") {
        e.preventDefault();
        openQuickCreate();
        return;
      }

      // Ctrl/Cmd+K — open global search (fires from anywhere, including inputs)
      if (key === "k") {
        e.preventDefault();
        openSearch();
        return;
      }

      // Don't steal Ctrl+Z from text inputs — let the browser handle it.
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) return;

      // Resolve at keypress time: drafts can change before React re-renders.
      const entities = useStagedStore.getState();
      const budget = useBudgetEditsStore.getState();
      const { usesBudgetActions } = getFeatureEntryState(
        getFeatureForPath(pathname), selectHasChanges(entities), budget.hasPendingEdits(),
      );
      const owner = usesBudgetActions ? budget : entities;
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        owner.undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        owner.redo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pathname, openSearch, openQuickCreate]);
}
