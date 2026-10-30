import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared presentation for the guides; the examples remain accessible tables. */
export function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 mb-3 flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground first:mt-0"><span aria-hidden="true" className="h-4 w-1 rounded-full bg-primary/60" />{children}</h3>;
}

export function Para({ children }: { children: ReactNode }) {
  return <p className="mb-4 max-w-[55rem] text-[13px] leading-6 text-foreground/80">{children}</p>;
}

export function Steps({ items }: { items: [string, ReactNode][] }) {
  return <ol className={cn("my-3 grid gap-3 sm:grid-cols-2", items.length !== 4 && "xl:grid-cols-3")}>{items.map(([title, body], index) => <li key={title} className="flex gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
    <div className="min-w-0 text-xs"><p className="font-semibold text-foreground">{title}</p><p className="mt-1.5 leading-relaxed text-muted-foreground">{body}</p></div>
  </li>)}</ol>;
}

export function Example({ caption, head, rows }: { caption: string; head: string[]; rows: (string | ReactNode)[][] }) {
  const numeric = (index: number) => head[index] === "Amount";
  const oneLine = (column: number) => column < head.length - 1 && rows.every((row) => { const cell = row[column]; return typeof cell !== "string" || cell.length <= 32; });
  return <div className="my-4 max-w-[55rem] overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
    <table className="w-full border-collapse text-left text-xs leading-relaxed">
      <caption className="border-b border-border bg-muted/30 px-4 py-2 text-left text-xs font-semibold text-foreground">{caption}</caption>
      <thead className="bg-muted/20"><tr>{head.map((cell, index) => <th key={cell} scope="col" className={cn("border-b border-border px-4 py-1.5 text-left text-[11px] font-semibold whitespace-nowrap text-muted-foreground", numeric(index) && "text-right")}>{cell}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index} className="border-b border-border/60 last:border-b-0">{row.map((cell, column) => <td key={column} className={cn("px-4 py-1.5 align-top text-foreground/85", oneLine(column) && "whitespace-nowrap", numeric(column) && "text-right tabular-nums")}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}
