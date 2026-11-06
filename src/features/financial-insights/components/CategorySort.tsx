"use client";

import { Select } from "@/components/ui/select";

export type CategorySort = "order" | "amount" | "name";

/** Selects an ordering without changing the underlying category data. */
export function CategorySortControl({ value, onChange, income = false }: { value: CategorySort; onChange: (value: CategorySort) => void; income?: boolean }) {
  return <div className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><span>Sort by</span>
    <Select aria-label="Sort groups and categories" size="sm" className="w-28" value={value} onValueChange={(next) => onChange(next as CategorySort)} options={[{ value: "order", label: "Sort order" }, { value: "amount", label: income ? "Income" : "Spent" }, { value: "name", label: "Name" }]} />
  </div>;
}

export function sortCategories<T extends { name: string; order?: number }>(items: readonly T[], sort: CategorySort, amount: (item: T) => number): T[] {
  return [...items].sort((a, b) => (sort === "amount" ? amount(b) - amount(a) : sort === "name" ? a.name.localeCompare(b.name) : (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)) || a.name.localeCompare(b.name));
}
