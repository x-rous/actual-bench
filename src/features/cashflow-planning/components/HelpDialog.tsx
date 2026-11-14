"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = mac ? "⌘" : "Ctrl";

const GROUPS: { title: string; keys: [string, string][] }[] = [
  { title: "Moving", keys: [
    ["Arrow keys", "Move one cell; Left from the first month reaches the row label"],
    ["Shift + arrows", "Extend the selection"],
    [`${MOD} + arrows`, "Jump to the first or last month, or line"],
    ["Home / End", `First or last month of the line (${MOD} for the whole grid)`],
    ["Page Up / Page Down", "Move twelve lines"],
    ["Space or Enter on a label", "Collapse or expand a section or group"],
    ["Esc", "Clear the selection and show the plan overview"],
  ] },
  { title: "Amounts", keys: [
    ["Enter, F2 or typing", "Edit the selected month"],
    ["Enter / Tab", "Save and move down / right"],
    [`${MOD} + Enter`, "Type the amount into every selected cell"],
    ["Delete", "Clear typed amounts, so the months follow the forecast again"],
    [`${MOD} + C / ${MOD} + V`, "Copy and paste, also to and from a spreadsheet"],
    [`${MOD} + R / ${MOD} + D`, "Fill the selection to the right / down"],
    [`${MOD} + Z / ${MOD} + Y`, "Undo / redo changes to this plan"],
  ] },
  { title: "Rows", keys: [
    ["F2 on a label, or double-click", "Rename a row or group"],
    ["Insert", "Add a row below"],
    ["Alt + Up / Down", "Move a row or group"],
    ["Drag a label", "Move a row before another row, or onto a group or section to join it"],
    ["Right-click", "Fill, clear, show transactions, add, rename, move, delete"],
    ["?", "Show this list"],
  ] },
];

export function HelpDialog({ docsUrl, onClose }: { docsUrl?: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Working in the grid</DialogTitle>
          <DialogDescription>
            Past months are what Actual recorded; coming months are the forecast, and a typed amount always wins over it.
            {docsUrl && <> The <a href={docsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">Cashflow Planning guide</a> explains rows, forecasts and settings.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-3">
          {GROUPS.map((group) => (
            <section key={group.title} className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h3>
              <dl className="space-y-2 text-xs">
                {group.keys.map(([keys, what]) => <div key={keys}><dt><kbd className="rounded border border-border bg-muted px-1 py-0.5 font-sans text-[11px] font-medium">{keys}</kbd></dt><dd className="mt-0.5 text-muted-foreground">{what}</dd></div>)}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
