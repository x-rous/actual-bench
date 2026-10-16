"use client";
import { useState, type ReactNode } from "react";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { SearchInput } from "@/components/ui/search-input";
import { SortableHeader, compareValues, type SortDirection } from "@/components/ui/sortable-header";
import { Select } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TableColumn<T> = { label: string; description?: string; width?: string; align?: "left" | "right"; searchValue?: (row: T) => string; value?: (row: T) => string | number | null | undefined };
type Filter<T> = { label: string; segmented?: boolean; options: { value: string; label: string }[]; matches: (row: T, value: string) => boolean };
/** Feature table shell, using the same search and sorting controls as app lists. */
export function WorkspaceTable<T>({ title, columns, rows, renderRow, actions, filters = [], description, defaultSort = 0, compact = false, summary = false, attentionOnly = false, singleLine = false, tableClassName }: { title: string; columns: TableColumn<T>[]; rows: T[]; renderRow: (row: T) => ReactNode; actions?: ReactNode; filters?: Filter<T>[]; description?: string; defaultSort?: number; compact?: boolean; summary?: boolean; attentionOnly?: boolean; singleLine?: boolean; tableClassName?: string }) {
  const [search, setSearch] = useState("");
  const [selectedFilters, setSelectedFilters] = useState<Record<string, string>>(attentionOnly ? { "Statement status": "review" } : {});
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>({ key: String(defaultSort), direction: "desc" });
  const query = search.toLowerCase().trim();
  const visible = rows.filter((row) => (!query || columns.some((column) => {
    const value = column.value?.(row);
    return `${column.searchValue?.(row) ?? ""} ${value ?? ""} ${typeof value === "number" ? formatAmount(value, 2) : ""}`.toLowerCase().includes(query);
  })) && filters.every((filter) => !selectedFilters[filter.label] || filter.matches(row, selectedFilters[filter.label])));
  if (sort?.direction) {
    const accessor = columns[Number(sort.key)]?.value;
    const direction = sort.direction;
    visible.sort((a, b) => compareValues(accessor?.(a), accessor?.(b), direction));
  }
  const headerClass = cn("border-b border-border px-2 py-2 text-xs font-medium text-muted-foreground [&_span]:overflow-visible", (singleLine || summary) ? "whitespace-nowrap [&_span]:whitespace-nowrap" : "[&_span]:whitespace-normal", summary && "px-1.5 [&_button]:gap-0.5");

  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={title}>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <SearchInput size="sm" className="w-60 max-w-full" aria-label={`Search ${title}`} value={search} onValueChange={setSearch} />
      {filters.map((filter) => filter.segmented ? <div key={filter.label} className="flex flex-wrap items-center gap-0.5 rounded-md border bg-muted/20 p-0.5" role="group" aria-label={filter.label}>{filter.options.slice(0, 3).map((option) => <Button key={option.value} size="xs" variant={(selectedFilters[filter.label] ?? "") === option.value ? "outline" : "ghost"} aria-pressed={(selectedFilters[filter.label] ?? "") === option.value} onClick={() => setSelectedFilters((current) => ({ ...current, [filter.label]: option.value }))}>{option.label}</Button>)}{filter.options.length > 3 && <DropdownMenu><DropdownMenuTrigger render={<Button size="xs" variant="ghost" aria-label={`More ${filter.label.toLowerCase()} filters`} />}>{filter.options.slice(3).find((option) => option.value === selectedFilters[filter.label])?.label ?? "More"}</DropdownMenuTrigger><DropdownMenuContent>{filter.options.slice(3).map((option) => <DropdownMenuItem key={option.value} onClick={() => setSelectedFilters((current) => ({ ...current, [filter.label]: option.value }))}>{option.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}</div> : <Select key={filter.label} size="sm" className="w-40" aria-label={filter.label} value={selectedFilters[filter.label] ?? ""} options={filter.options} onValueChange={(value) => setSelectedFilters((current) => ({ ...current, [filter.label]: value }))} />)}
      {(search || Object.values(selectedFilters).some(Boolean)) && <Button variant="ghost" size="xs" onClick={() => { setSearch(""); setSelectedFilters({}); }}>Clear filters</Button>}
      {(query || Object.values(selectedFilters).some(Boolean)) && <span className="text-xs text-muted-foreground" role="status">{visible.length} of {rows.length}</span>}<div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
    {description && <p className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">{description}</p>}
    <div className="min-h-0 flex-1 overflow-auto"><table className={cn(
      "w-full text-left text-xs",
      compact && "min-w-[1000px] table-fixed text-[13px] [&_td]:px-2 [&_td]:py-2 [&_td]:align-middle",
      summary && "min-w-[1600px] [&_td]:py-1.5 [&_td]:leading-4 [&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:bg-[var(--workspace-row-background,var(--background))] [&_td:last-child]:sticky [&_td:last-child]:right-0 [&_td:last-child]:bg-[var(--workspace-row-background,var(--background))] [&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:bg-muted [&_th:last-child]:sticky [&_th:last-child]:right-0 [&_th:last-child]:bg-muted",
      singleLine && "[&_td]:whitespace-nowrap",
      tableClassName,
    )}><caption className="sr-only">{title}</caption>{compact && <colgroup>{columns.map((column) => <col key={column.label} style={{ width: column.width }} />)}</colgroup>}<thead className="sticky top-0 z-10 bg-muted"><tr>{columns.map((column, index) => column.value ? <SortableHeader key={column.label} label={column.label} description={column.description} sortKey={String(index)} sort={sort} onSort={(key, direction) => setSort(direction ? { key, direction } : null)} align={column.align} className={headerClass} /> : <th key={column.label} scope="col" className={cn(headerClass, column.align === "right" && "text-right")}>{column.label}</th>)}</tr></thead><tbody>{visible.map(renderRow)}</tbody></table>{!visible.length && <p className="p-4 text-xs text-muted-foreground">{rows.length ? "No rows match your filters." : "No records in the loaded history."}</p>}</div>
  </section>;
}
