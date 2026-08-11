"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * What the keyboard can do here.
 *
 * The workbench has had row navigation since it was built, and almost nobody
 * would have found it: the only hint was a single badge on one button. Deciding
 * a few hundred rows without touching the mouse is the difference between this
 * screen being pleasant and being a chore, so the bindings need somewhere to be
 * announced.
 */

const GROUPS: { title: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    title: "Moving",
    rows: [
      { keys: ["j", "↓"], label: "Next row" },
      { keys: ["k", "↑"], label: "Previous row" },
      { keys: ["n"], label: "Next row still undecided" },
      { keys: ["Esc"], label: "Close the details panel" },
    ],
  },
  {
    title: "Deciding",
    rows: [
      { keys: ["Enter"], label: "Accept what this row is for - confirm, create, or keep" },
      { keys: ["c"], label: "Create in Actual" },
      { keys: ["d"], label: "Delete from Actual" },
      { keys: ["i"], label: "Ignore this row" },
      { keys: ["u"], label: "Undo the decision" },
    ],
  },
];

export type ShortcutsHelpProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Deciding advances to the next undecided row, so a clean statement can be worked through
            without leaving the keyboard.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              <dl className="space-y-1.5">
                {group.rows.map((row) => (
                  <div key={row.label} className="flex items-baseline gap-2">
                    <dt className="flex shrink-0 gap-1">
                      {row.keys.map((key) => (
                        <kbd
                          key={key}
                          className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium"
                        >
                          {key}
                        </kbd>
                      ))}
                    </dt>
                    <dd className="text-xs text-muted-foreground">{row.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Keys are ignored while you are typing in a search box or a field, and a decision a row
          does not offer - deleting a transfer, say - is refused here exactly as its button is.
        </p>
      </DialogContent>
    </Dialog>
  );
}
