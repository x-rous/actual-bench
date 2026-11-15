import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Figure, Key } from "@/features/financial-insights/components/guide/guideVisuals";

/**
 * The pictures of the Cashflow Planning guide: small static sketches drawn with the grid's own fills and text colours (recorded
 * figures in ink blue, the current month in amber, the forecast in white), so what a reader sees here is what the grid shows.
 * Nothing here reads data.
 */

const INK = "text-[#1e3a8a] dark:text-blue-300";
type Kind = "actual" | "current" | "forecast";
const MONTHS: { name: string; kind: Kind }[] = [{ name: "Sep", kind: "actual" }, { name: "Oct", kind: "actual" }, { name: "Nov", kind: "current" }, { name: "Dec", kind: "forecast" }, { name: "Jan", kind: "forecast" }];
const KIND_LABEL: Record<Kind, string> = { actual: "Actual", current: "This month", forecast: "Forecast" };

type SketchRow = { kind: "balance" | "section" | "group" | "row" | "net"; label: string; cells: (string | { v: string; typed: true })[] };
const ROWS: SketchRow[] = [
  { kind: "balance", label: "Opening balance", cells: ["12,000", "13,500", "15,000", "16,600", "18,200"] },
  { kind: "section", label: "▾ INCOME", cells: ["5,000", "5,000", "5,300", "5,000", "5,300"] },
  { kind: "group", label: "▾ Salary", cells: ["5,000", "5,000", "5,300", "5,000", "5,300"] },
  { kind: "row", label: "Monthly salary", cells: ["5,000", "5,000", "5,000", "5,000", "5,000"] },
  { kind: "row", label: "Bonus", cells: ["", "", "300", "", { v: "300", typed: true }] },
  { kind: "section", label: "▸ EXPENSES", cells: ["3,500", "3,500", "3,700", "3,400", "3,400"] },
  { kind: "net", label: "Net cashflow", cells: ["1,500", "1,500", "1,600", "1,600", "1,900"] },
  { kind: "balance", label: "Closing balance", cells: ["13,500", "15,000", "16,600", "18,200", "20,100"] },
];

function fill(row: SketchRow, kind: Kind): string {
  if (row.kind === "row") return kind === "actual" ? "bg-muted/40" : kind === "current" ? "bg-amber-500/10" : "bg-background";
  if (row.kind === "group") return kind === "actual" ? "bg-muted" : kind === "current" ? "bg-amber-500/15" : "bg-muted/60";
  if (row.kind === "section") return "bg-muted";
  return kind === "current" ? "bg-amber-500/10" : kind === "actual" ? "bg-muted/40" : "bg-background";
}

/** A miniature of the grid: five months, a section, a group and its rows, and the pinned lines. */
export function GridSketch() {
  const cols = "grid-cols-[8.5rem_repeat(5,minmax(0,1fr))]";
  return (
    <Figure wide label="A miniature of the plan grid" caption={<>
      <Key colour="#1e3a8a">Recorded by Actual: ink blue</Key>
      <Key colour="#f59e0b">This month: recorded so far plus what is still expected</Key>
      <Key colour="#e5e7eb">Forecast: black</Key>
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-0 border-4 border-transparent border-r-foreground border-t-foreground" />A typed amount</span>
    </>}>
      <div className="overflow-hidden rounded-lg border text-xs">
        <div className={cn("grid items-end border-b bg-background", cols)}>
          <span className="px-2 py-1.5 text-[11px] text-muted-foreground">2026</span>
          {MONTHS.map((m) => (
            <span key={m.name} className={cn("px-2 py-1.5 text-right leading-tight", m.kind === "current" && "bg-amber-500/15")}>
              <span className="block font-medium">{m.name}</span>
              <span className={cn("block text-[10px]", m.kind === "current" ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{m.kind === "current" && <span aria-hidden className="mr-1 inline-block size-1.5 rounded-full bg-amber-500 align-[1px]" />}{KIND_LABEL[m.kind]}</span>
            </span>
          ))}
        </div>
        {ROWS.map((row) => (
          <div key={row.label} className={cn("grid border-b last:border-b-0", cols, row.kind === "net" && "border-t")}>
            <span className={cn("truncate px-2 py-1.5", row.kind === "row" && "pl-6", row.kind === "group" && "bg-muted/60 pl-4 font-semibold", row.kind === "section" && "bg-muted text-[11px] font-semibold uppercase tracking-wide", (row.kind === "balance") && "font-semibold", row.kind === "net" && "text-muted-foreground")}>{row.label}</span>
            {row.cells.map((cell, i) => {
              const kind = MONTHS[i].kind;
              const typed = typeof cell === "object";
              const text = typed ? cell.v : cell;
              return (
                <span key={i} className={cn("relative px-2 py-1.5 text-right tabular-nums", fill(row, kind), kind === "actual" && row.kind !== "net" && INK, row.kind === "net" && "text-muted-foreground", (row.kind === "section" || row.kind === "balance" || row.kind === "group") && "font-semibold")}>
                  {typed && <span aria-hidden className="absolute right-[3px] top-[3px] size-0 border-[3px] border-transparent border-r-foreground border-t-foreground" />}
                  {text}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </Figure>
  );
}

const Block = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("rounded-md border bg-card px-2.5 py-2 text-[11px]", className)}>{children}</div>;

/** Where things are on the page. */
export function LayoutSketch() {
  return (
    <Figure wide label="The parts of the Cashflow Planning page" caption={<span>Everything is saved as you go; nothing here writes to Actual.</span>}>
      <div className="space-y-2 text-xs">
        <Block className="flex flex-wrap items-center gap-x-4 gap-y-1"><b>Plan bar</b><span className="text-muted-foreground">plan picker · Saved · month window · Months / Years · Undo, Redo · View · Refresh · Plan settings · Guide</span></Block>
        <Block className="flex flex-wrap items-center gap-x-4 gap-y-1"><b>Key figures</b><span className="text-muted-foreground">Cash today · Lowest point, next 12 months · Minimum cash · End of the year · Next 12 months · End of plan</span></Block>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_14rem]">
          <Block className="space-y-1.5"><p><b>The grid</b></p><div className="space-y-1">{[70, 45, 60, 52].map((w, i) => <div key={i} className="h-2 rounded bg-muted" style={{ width: `${w}%` }} />)}</div><p className="text-muted-foreground">Past months, this month and the forecast, line by line. Net cashflow and Closing balance stay pinned at the bottom, with Savings (estimate) and Cash + savings under them when there are savings accounts.</p></Block>
          <Block className="space-y-1"><p><b>Details panel</b></p><p className="text-muted-foreground">The plan overview, or whatever you select: a row, a month, a year.</p></Block>
        </div>
      </div>
    </Figure>
  );
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = MAC ? "⌘" : "Ctrl";

export const SHORTCUTS: { title: string; keys: [string, string][] }[] = [
  { title: "Moving", keys: [
    ["Arrow keys", "Move one cell; Left from the first month reaches the row label"],
    ["Shift + arrows", "Extend the selection"],
    [`${MOD} + arrows`, "Jump to the first or last month, or line"],
    ["Home / End", `First or last month of the line (${MOD} for the whole grid)`],
    ["Page Up / Page Down", "Move twelve lines"],
    ["Space or Enter on a label", "Collapse or expand a section or group"],
    ["S", "Show the summary of the selected cell's month or year"],
    ["Esc", "Close the summary, then clear the selection and show the plan overview"],
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
    ["?", "Open this guide at the shortcuts"],
  ] },
];

/** Every shortcut of the grid, grouped by what it does. */
export function ShortcutGroups() {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {SHORTCUTS.map((group) => (
        <section key={group.title} className="rounded-xl border bg-card p-4 shadow-sm">
          <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h4>
          <dl className="space-y-2.5 text-xs">
            {group.keys.map(([keys, what]) => (
              <div key={keys}>
                <dt><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] font-medium">{keys}</kbd></dt>
                <dd className="mt-1 leading-relaxed text-muted-foreground">{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
