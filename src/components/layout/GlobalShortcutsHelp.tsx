"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type ShortcutRow = {
  label: string;
  keys: string[];
};

type ShortcutSection = {
  title: string;
  rows: ShortcutRow[];
};

const SECTIONS: ShortcutSection[] = [
  {
    title: "Global",
    rows: [
      { label: "Quick Create",   keys: ["N", "Ctrl+Shift+N"] },
      { label: "Global Search",  keys: ["Ctrl+K"] },
    ],
  },
  {
    title: "History",
    rows: [
      { label: "Undo",  keys: ["Ctrl+Z"] },
      { label: "Redo",  keys: ["Ctrl+Shift+Z", "Ctrl+Y"] },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
      {children}
    </kbd>
  );
}

export function GlobalShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs" aria-describedby="shortcuts-desc">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription id="shortcuts-desc" className="text-[11px]">
            App-wide shortcuts. The Budget workspace has additional shortcuts — press{" "}
            <Kbd>?</Kbd> there to see them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.title}
              </h3>
              <ul className="overflow-hidden rounded-md border border-border/40 divide-y divide-border/40">
                {section.rows.map((row) => (
                  <li
                    key={row.label}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs hover:bg-muted/30"
                  >
                    <span className="text-foreground">{row.label}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {row.keys.map((key, i) => (
                        <span key={key} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className="text-[10px] text-muted-foreground">or</span>
                          )}
                          <Kbd>{key}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
