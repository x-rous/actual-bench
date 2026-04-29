import type { KeyChord } from "./chord";
import { matchChord } from "./chord";
import type { ActionId } from "./actions";
import type { Scope } from "./scopes";

export type KeymapBinding = {
  action: ActionId;
  chord: KeyChord;
  scopes: Scope[];
};

/**
 * Single source of truth for every shortcut. Adding a binding here + a
 * handler in the relevant per-scope handler map is all that's needed to
 * make a new shortcut work — components do not need to be touched.
 *
 * Phase 0 mirrors the previously-inlined shortcuts 1:1.
 */
export const DEFAULT_KEYMAP: KeymapBinding[] = [
  // ── Navigation: arrows ─────────────────────────────────────────────────
  { action: "cell.move-up",     chord: { key: "ArrowUp" },                  scopes: ["cell", "group-cell", "row-label"] },
  { action: "cell.extend-up",   chord: { key: "ArrowUp", shift: true },     scopes: ["cell"] },
  { action: "cell.move-down",   chord: { key: "ArrowDown" },                scopes: ["cell", "group-cell", "row-label"] },
  { action: "cell.extend-down", chord: { key: "ArrowDown", shift: true },   scopes: ["cell"] },
  { action: "cell.move-left",   chord: { key: "ArrowLeft" },                scopes: ["cell", "group-cell", "row-label"] },
  { action: "cell.extend-left", chord: { key: "ArrowLeft", shift: true },   scopes: ["cell"] },
  { action: "cell.move-right",  chord: { key: "ArrowRight" },               scopes: ["cell", "group-cell", "row-label"] },
  { action: "cell.extend-right",chord: { key: "ArrowRight", shift: true },  scopes: ["cell"] },

  // ── Navigation: tab ────────────────────────────────────────────────────
  { action: "cell.tab-forward",  chord: { key: "Tab" },                     scopes: ["cell", "group-cell", "row-label"] },
  { action: "cell.tab-backward", chord: { key: "Tab", shift: true },        scopes: ["cell", "group-cell", "row-label"] },

  // ── Tier 1: viewport / section nav ─────────────────────────────────────
  { action: "cell.move-page-up",   chord: { key: "PageUp" },                scopes: ["cell", "group-cell", "row-label"] },
  { action: "cell.move-page-down", chord: { key: "PageDown" },              scopes: ["cell", "group-cell", "row-label"] },
  { action: "cell.extend-page-up",   chord: { key: "PageUp", shift: true }, scopes: ["cell"] },
  { action: "cell.extend-page-down", chord: { key: "PageDown", shift: true },scopes: ["cell"] },

  // Home / End — jump to first / last month in row.
  { action: "cell.move-row-start", chord: { key: "Home" },                  scopes: ["cell", "group-cell"] },
  { action: "cell.move-row-end",   chord: { key: "End" },                   scopes: ["cell", "group-cell"] },
  { action: "cell.extend-row-start", chord: { key: "Home", shift: true },   scopes: ["cell"] },
  { action: "cell.extend-row-end",   chord: { key: "End",  shift: true },   scopes: ["cell"] },
  // Ctrl+Left / Ctrl+Right are aliases for Home / End — list more-specific
  // chord (mod) before the generic ArrowLeft / ArrowRight binding so
  // first-match still picks the right thing in cell scope.
  { action: "cell.move-row-start", chord: { key: "ArrowLeft",  mod: true }, scopes: ["cell", "group-cell"] },
  { action: "cell.move-row-end",   chord: { key: "ArrowRight", mod: true }, scopes: ["cell", "group-cell"] },
  { action: "cell.extend-row-start", chord: { key: "ArrowLeft",  mod: true, shift: true }, scopes: ["cell"] },
  { action: "cell.extend-row-end",   chord: { key: "ArrowRight", mod: true, shift: true }, scopes: ["cell"] },

  // Ctrl+Home / Ctrl+End — jump to first / last cell of the entire grid.
  { action: "cell.move-grid-start", chord: { key: "Home", mod: true },      scopes: ["cell", "group-cell", "row-label"] },
  { action: "cell.move-grid-end",   chord: { key: "End",  mod: true },      scopes: ["cell", "group-cell", "row-label"] },
  { action: "cell.extend-grid-start", chord: { key: "Home", mod: true, shift: true }, scopes: ["cell"] },
  { action: "cell.extend-grid-end",   chord: { key: "End",  mod: true, shift: true }, scopes: ["cell"] },

  // Ctrl+Up / Ctrl+Down — jump to next section (group boundary).
  { action: "cell.move-section-up",   chord: { key: "ArrowUp",   mod: true }, scopes: ["cell", "group-cell", "row-label"] },
  { action: "cell.move-section-down", chord: { key: "ArrowDown", mod: true }, scopes: ["cell", "group-cell", "row-label"] },

  // ── Cell editing entry ─────────────────────────────────────────────────
  { action: "cell.start-edit",  chord: { key: "Enter" },                    scopes: ["cell"] },
  { action: "cell.start-edit",  chord: { key: "F2" },                       scopes: ["cell"] },
  { action: "cell.clear-value", chord: { key: "Delete" },                   scopes: ["cell"] },
  { action: "cell.clear-value", chord: { key: "Backspace" },                scopes: ["cell"] },
  // Digits / decimal / signs / opening paren — start edit and feed the
  // character into the input. Modifiers are forbidden so browser shortcuts
  // (e.g. quick-find) and assistive tech aren't intercepted.
  { action: "cell.start-edit-with-char", chord: { key: /^[0-9.+\-(]$/ },    scopes: ["cell"] },

  // ── Inside the input ───────────────────────────────────────────────────
  { action: "edit.commit-down",      chord: { key: "Enter" },               scopes: ["cell-edit"] },
  { action: "edit.cancel",           chord: { key: "Escape" },              scopes: ["cell-edit"] },
  { action: "edit.commit-tab",       chord: { key: "Tab" },                 scopes: ["cell-edit"] },
  { action: "edit.commit-shift-tab", chord: { key: "Tab", shift: true },    scopes: ["cell-edit"] },

  // ── Group collapse ─────────────────────────────────────────────────────
  { action: "group.toggle-collapse", chord: { key: " " },                   scopes: ["group-cell", "row-label"] },

  // ── Workspace ──────────────────────────────────────────────────────────
  { action: "history.undo",   chord: { key: "z", mod: true },               scopes: ["workspace"] },
  { action: "history.redo",   chord: { key: "z", mod: true, shift: true },  scopes: ["workspace"] },
  { action: "history.redo",   chord: { key: "y", mod: true },               scopes: ["workspace"] },
  { action: "selection.copy", chord: { key: "c", mod: true },               scopes: ["workspace"] },
  { action: "selection.zero", chord: { key: "Delete" },                     scopes: ["workspace"] },
  { action: "selection.zero", chord: { key: "Backspace" },                  scopes: ["workspace"] },

  // ── Tier 2 range-edit ──────────────────────────────────────────────────
  { action: "selection.fill-from-active", chord: { key: "Enter", mod: true }, scopes: ["workspace"] },
  { action: "selection.fill-down",        chord: { key: "d", mod: true },     scopes: ["workspace"] },
  { action: "selection.fill-right",       chord: { key: "r", mod: true },     scopes: ["workspace"] },
  { action: "selection.fill-prev-month",  chord: { key: "l", alt: true },     scopes: ["workspace"] },
  { action: "selection.fill-avg-3",       chord: { key: "a", alt: true },     scopes: ["workspace"] },

  // ── Tier 3 view & visibility ───────────────────────────────────────────
  // Bare-alpha bindings are workspace-only — `cell-edit` scope (input
  // focused) doesn't include the workspace, so typing in an input is safe.
  { action: "view.cycle-cell-view",    chord: { key: "v" },                   scopes: ["workspace"] },
  { action: "view.toggle-show-hidden", chord: { key: "h" },                   scopes: ["workspace"] },
  // E (lowercase) → expand all; Shift+E delivers `key === "E"` (uppercase).
  { action: "view.expand-all",         chord: { key: "e" },                   scopes: ["workspace"] },
  { action: "view.collapse-all",       chord: { key: "E", shift: true },      scopes: ["workspace"] },
  // Pan visible months one month back / forward. Bare brackets on US layout.
  { action: "view.pan-months-prev",    chord: { key: "[" },                   scopes: ["workspace"] },
  { action: "view.pan-months-next",    chord: { key: "]" },                   scopes: ["workspace"] },
  { action: "view.open-category-search", chord: { key: "f" },                 scopes: ["workspace"] },

  // ── Tier 4 selection actions ───────────────────────────────────────────
  { action: "selection.toggle-carryover", chord: { key: "c", alt: true },     scopes: ["workspace"] },

  // ── Discoverability ────────────────────────────────────────────────────
  // `?` typically requires Shift on US layout — `event.key` is "?", which is
  // what we match. F1 and Cmd/Ctrl+/ are common alternates.
  { action: "help.open-shortcuts", chord: { key: "?", shift: true },          scopes: ["workspace"] },
  { action: "help.open-shortcuts", chord: { key: "F1" },                      scopes: ["workspace"] },
  { action: "help.open-shortcuts", chord: { key: "/", mod: true },            scopes: ["workspace"] },
];

type EventLike = Parameters<typeof matchChord>[0];

/**
 * Resolve a keyboard event to an action ID for the given scope. Returns
 * `null` when no binding matches. First-match wins, so order in
 * `DEFAULT_KEYMAP` is meaningful — the more-specific chord (e.g. Shift+Tab)
 * must be listed before the more-general one (Tab).
 */
export function matchAction(
  e: EventLike | { nativeEvent: EventLike },
  scope: Scope,
  keymap: KeymapBinding[] = DEFAULT_KEYMAP
): ActionId | null {
  const native: EventLike = "nativeEvent" in e ? e.nativeEvent : e;
  for (const b of keymap) {
    if (!b.scopes.includes(scope)) continue;
    if (matchChord(native, b.chord)) return b.action;
  }
  return null;
}
