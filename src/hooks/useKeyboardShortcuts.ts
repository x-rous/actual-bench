"use client";

import { useEffect } from "react";
import { useStagedStore } from "@/store/staged";
import { useGlobalSearchStore } from "@/features/global-search/store/useGlobalSearchStore";

/**
 * Wires global keyboard shortcuts for the staged store and app-wide actions.
 * Must be called once, inside a client component (AppShell).
 *
 * Ctrl/Cmd+Z        → undo
 * Ctrl/Cmd+Shift+Z  → redo
 * Ctrl/Cmd+Y        → redo (Windows convention)
 * Ctrl/Cmd+K        → open global search modal
 *
 * Undo/redo are suppressed inside text inputs so native browser undo is not
 * broken. Ctrl/Cmd+K intentionally fires from anywhere, including text inputs,
 * consistent with standard search-modal conventions.
 */
export function useKeyboardShortcuts() {
  const undo = useStagedStore((s) => s.undo);
  const redo = useStagedStore((s) => s.redo);
  const openSearch = useGlobalSearchStore((s) => s.open);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      // Ctrl/Cmd+K — open global search (fires from anywhere, including inputs)
      if (e.key === "k") {
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

      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, openSearch]);
}
