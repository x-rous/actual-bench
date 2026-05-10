"use client";

import { useEffect } from "react";
import { useStagedStore } from "@/store/staged";
import { useGlobalSearchStore } from "@/features/global-search/store/useGlobalSearchStore";
import { useQuickCreateStore } from "@/features/quick-create/store/useQuickCreateStore";

/**
 * Wires global keyboard shortcuts for the staged store and app-wide actions.
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
  const undo = useStagedStore((s) => s.undo);
  const redo = useStagedStore((s) => s.redo);
  const openSearch = useGlobalSearchStore((s) => s.open);
  const openQuickCreate = useQuickCreateStore((s) => s.open);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
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

      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, openSearch, openQuickCreate]);
}
