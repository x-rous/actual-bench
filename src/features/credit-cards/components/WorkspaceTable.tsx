"use client";
import { useState, type ReactNode } from "react";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export type TableColumn<T> = { label: string; width?: string; searchValue?: (row: T) => string; value?: (row: T) => string | number | null | undefined };
type Filter<T> = { label: string; options: { value: string; label: string }[]; matches: (row: T, value: string) => boolean };
/** Feature table shell: toolbar stays visible while dense, sortable rows fill the workspace. */
export function WorkspaceTable<T>({ title, columns, rows, renderRow, actions, filters = [], description, defaultSort = 0, compact = false, summary = false }: { title: string; columns: TableColumn<T>[]; rows: T[]; renderRow: (row: T) => ReactNode; actions?: ReactNode; filters?: Filter<T>[]; description?: string; defaultSort?: number; compact?: boolean; summary?: boolean }) {
  const [search, setSearch] = useState("");
  const [selectedFilters, setSelectedFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState({ index: defaultSort, ascending: false });
  const query = search.toLowerCase().trim();
  const visible = rows.filter((row) => (!query || columns.some((column) => (() => { const value = column.value?.(row); return `${column.searchValue?.(row) ?? ""} ${value ?? ""} ${typeof value === "number" ? formatAmount(value, 2) : ""}`.toLowerCase().includes(query); })())) && filters.every((filter) => !selectedFilters[filter.label] || filter.matches(row, selectedFilters[filter.label]))).sort((a, b) => {
    const accessor = columns[sort.index].value;
    const left = accessor?.(a) ?? "", right = accessor?.(b) ?? "";
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return sort.ascending ? comparison : -comparison;
  });
  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={title}>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <div className="relative"><Search className="absolute left-2 top-1.5 size-3.5 text-muted-foreground" aria-hidden /><Input size="sm" className="w-60 pl-7" aria-label={`Search ${title}`} placeholder="Search…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      {filters.map((filter) => <Select key={filter.label} size="sm" className="w-40" aria-label={filter.label} value={selectedFilters[filter.label] ?? ""} options={filter.options} onValueChange={(value) => setSelectedFilters((current) => ({ ...current, [filter.label]: value }))} />)}
      {(search || Object.values(selectedFilters).some(Boolean)) && <Button variant="ghost" size="xs" onClick={() => { setSearch(""); setSelectedFilters({}); }}>Clear filters</Button>}
      <span className="text-xs text-muted-foreground">{visible.length} of {rows.length}</span><div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
    {description && <p className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">{description}</p>}
    <div className="min-h-0 flex-1 overflow-auto"><table className={summary ? "w-full table-fixed text-left text-xs [&_td]:align-middle [&_th]:whitespace-normal [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_td]:leading-5" : compact ? "w-full table-fixed text-left text-xs [&_td]:px-1 [&_th]:px-1 min-[1600px]:[&_td]:px-2 min-[1600px]:[&_th]:px-2 max-[1599px]:text-[11px] [&_td]:break-words [&_td]:align-top [&_th]:whitespace-normal [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:whitespace-normal [&_[data-slot=badge]]:justify-start" : "w-full text-left text-xs"}><caption className="sr-only">{title}</caption>{compact && <colgroup>{columns.map((column) => <col key={column.label} style={{ width: column.width }} />)}</colgroup>}<thead className="sticky top-0 z-10 bg-muted"><tr>{columns.map((column, index) => <th key={column.label} scope="col" className="border-b border-border px-2 py-1 font-medium whitespace-nowrap" aria-sort={column.value ? sort.index === index ? sort.ascending ? "ascending" : "descending" : "none" : undefined}>{column.value ? <button title={column.label} className="group relative flex w-full min-w-0 items-center gap-0.5" onClick={() => setSort({ index, ascending: sort.index === index ? !sort.ascending : true })}><span className="min-w-0 whitespace-normal">{column.label}</span>{sort.index === index ? sort.ascending ? <ArrowUp className="size-3 shrink-0" aria-hidden /> : <ArrowDown className="size-3 shrink-0" aria-hidden /> : <ArrowUpDown className="absolute right-0 hidden size-3 text-muted-foreground group-hover:block group-focus-visible:block" aria-hidden />}</button> : column.label}</th>)}</tr></thead><tbody>{visible.map(renderRow)}</tbody></table>{!visible.length && <p className="p-4 text-xs text-muted-foreground">{rows.length ? "No rows match your filters." : "No records in the loaded history."}</p>}</div>
  </section>;
}
