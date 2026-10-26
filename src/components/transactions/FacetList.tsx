"use client";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { ComboboxOption } from "@/components/ui/combobox";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";

const SHOWN_LIMIT = 200;
/**
 * A searchable checklist for a filter popover: options (with the account, category-group and section headings the app's
 * option builders produce), a search box, and at most 200 rows at a time so a payee list of thousands stays quick.
 */
export function FacetList({ options, selected, onChange, ariaLabel, placeholder = "Search…" }: {
  options: ComboboxOption[]; selected: string[]; onChange: (ids: string[]) => void; ariaLabel: string; placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const matches = (o: ComboboxOption) => !o.isGroupHeader && !o.disabled && (!needle || o.name.toLocaleLowerCase().includes(needle));
  // Headings stay only above a visible choice: a section heading carries its group headings until a choice follows.
  const ordered: ComboboxOption[] = []; let pending: ComboboxOption[] = []; let shown = 0; let more = false;
  for (const o of options) {
    if (o.isGroupHeader) { pending = o.section ? [o] : [...pending.filter((h) => h.section), o]; continue; }
    if (!matches(o)) continue;
    if (shown >= SHOWN_LIMIT) { more = true; continue; }
    ordered.push(...pending); pending = []; shown++; ordered.push(o);
  }
  const chosen = new Set(selected);
  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  return <div className="grid gap-2">
    <SearchInput size="sm" className="w-full" aria-label={`Search ${ariaLabel}`} placeholder={placeholder} value={query} onValueChange={setQuery} />
    <ul aria-label={ariaLabel} className="max-h-64 overflow-y-auto">
      {ordered.map((o) => o.isGroupHeader
        ? <li key={o.id} role="presentation" className={cn("px-2 pt-2 pb-1 text-[11px] text-muted-foreground", o.section ? "font-semibold uppercase tracking-wide" : "font-medium")}>{o.name}</li>
        : <li key={o.id}><label className={cn("flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted", o.hidden && "text-muted-foreground")}><Checkbox checked={chosen.has(o.id)} onCheckedChange={() => toggle(o.id)} aria-label={o.name} /><span className="min-w-0 flex-1 truncate">{o.name}</span>{o.trailing && <span className="text-xs text-muted-foreground">{o.trailing}</span>}</label></li>)}
      {ordered.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">Nothing matches.</li>}
    </ul>
    {more && <p className="px-2 text-[11px] text-muted-foreground">Showing the first {SHOWN_LIMIT}. Type to narrow the list.</p>}
  </div>;
}
