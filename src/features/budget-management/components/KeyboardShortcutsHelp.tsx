"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ACTION_META, type ActionCategory, type ActionId } from "../keyboard/actions";
import { DEFAULT_KEYMAP } from "../keyboard/keymap";
import { chordToLabel } from "../keyboard/chordLabel";

// Explicit two-column distribution. Heights balance roughly: Navigation
// (~14 rows) + View (~7) + History (~2) + Help (~1) ≈ 24 on the left;
// Editing (~7) + Range (~10) + Selection (~7) ≈ 24 on the right. History
// and Help live in the left column per the latest UX pass.
const LEFT_COLUMN: ActionCategory[]  = ["navigation", "view", "history", "help"];
const RIGHT_COLUMN: ActionCategory[] = ["editing", "range", "selection"];

const CATEGORY_TITLES: Record<ActionCategory, string> = {
  navigation: "Navigation",
  editing: "Editing",
  range: "Range extension",
  selection: "Selection actions",
  view: "View & visibility",
  history: "History",
  help: "Help",
};

type ShortcutRow = {
  id: ActionId;
  label: string;
  description?: string;
  chordLabels: string[];
};

function buildRows(): Record<ActionCategory, ShortcutRow[]> {
  const grouped: Record<ActionCategory, ShortcutRow[]> = {
    navigation: [],
    editing: [],
    range: [],
    selection: [],
    view: [],
    history: [],
    help: [],
  };

  // Aggregate every binding for an action so the modal shows aliases together
  // (e.g. Ctrl+Y and Ctrl+Shift+Z both render under "Redo").
  const bindings = new Map<ActionId, string[]>();
  for (const b of DEFAULT_KEYMAP) {
    const labels = bindings.get(b.action) ?? [];
    const label = chordToLabel(b.chord);
    if (!labels.includes(label)) labels.push(label);
    bindings.set(b.action, labels);
  }

  for (const [id, meta] of Object.entries(ACTION_META) as [ActionId, typeof ACTION_META[ActionId]][]) {
    const chordLabels = bindings.get(id) ?? [];
    if (chordLabels.length === 0) continue;
    grouped[meta.category].push({
      id,
      label: meta.label,
      description: meta.description,
      chordLabels,
    });
  }
  return grouped;
}

function ColumnGroup({
  categories,
  rows,
}: {
  categories: ActionCategory[];
  rows: Record<ActionCategory, ShortcutRow[]>;
}) {
  return (
    <div className="space-y-3">
      {categories.map((cat) => {
        const items = rows[cat];
        if (items.length === 0) return null;
        return (
          <section key={cat} aria-labelledby={`shortcut-cat-${cat}`}>
            <h3
              id={`shortcut-cat-${cat}`}
              className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 px-0.5"
            >
              {CATEGORY_TITLES[cat]}
            </h3>
            <ul className="divide-y divide-border/40 border border-border/40 rounded-md overflow-hidden">
              {items.map((row) => (
                <li
                  key={row.id}
                  title={row.description}
                  className="flex items-center justify-between gap-2 px-2 py-1 text-xs hover:bg-muted/30"
                >
                  <span className="text-foreground truncate">{row.label}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {row.chordLabels.map((label) => (
                      <kbd
                        key={label}
                        className="px-1 py-0 rounded border border-border text-[10px] font-mono bg-muted text-foreground whitespace-nowrap"
                      >
                        {label}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Cheatsheet modal — generated from `ACTION_META` joined with `DEFAULT_KEYMAP`
 * at render time. Adding a shortcut anywhere in the keymap surfaces it here
 * automatically.
 *
 * Layout: ~3× wider than a stock 2xl dialog and laid out as a CSS-columns
 * masonry, so two sections sit side-by-side and short groups (History, Help)
 * tuck efficiently under taller ones (Navigation, Range).
 */
export function KeyboardShortcutsHelp({ open, onOpenChange }: Props) {
  const rows = useMemo(() => buildRows(), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ~40% of viewport width, with a sensible floor so small screens
          don't get a sliver. Both unprefixed and sm:-prefixed forms are
          set because `DialogContent`'s baseline (`sm:max-w-sm`) is also
          responsive and tailwind-merge tracks them separately. */}
      <DialogContent className="max-w-[max(28rem,40vw)] sm:max-w-[max(28rem,40vw)] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-[11px]">
            Press <kbd className="px-1 py-0 rounded border border-border text-[10px] bg-muted font-mono">?</kbd>{" "}
            anytime to reopen. Most shortcuts are inactive while a cell is being edited.
            Hover a row for extra notes.
          </DialogDescription>
        </DialogHeader>

        {/* Two explicit columns so History + Help can be pinned to the
            left side regardless of the natural masonry flow. */}
        <div className="grid grid-cols-2 gap-x-6 mt-2">
          <ColumnGroup categories={LEFT_COLUMN} rows={rows} />
          <ColumnGroup categories={RIGHT_COLUMN} rows={rows} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
