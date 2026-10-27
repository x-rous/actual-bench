"use client";
import { useState, type ReactNode } from "react";
import { Lock, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { ComboboxOption } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatAmount, minorToMajorText, parseMajorToMinor } from "@/features/assets-debt/lib/money";
import { cn } from "@/lib/utils";
import { FacetList } from "./FacetList";
import type { DatePreset, IdFilter, PickerFilterState } from "./transactionPickerQuery";

/** A small segmented control (one choice of a few), the same look as the app's other toggles. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-lg bg-muted/60 p-0.5">
    {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={cn("h-6 rounded-md px-2 text-xs transition-colors", value === o.value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>{o.label}</button>)}
  </div>;
}

/** One filter: a button showing its name and current value that opens a popover, with × to clear it when set. */
export function Chip({ name, summary, onClear, width = "w-80", children }: { name: string; summary: string | null; onClear: () => void; width?: string; children: ReactNode }) {
  return <span className={cn("inline-flex h-7 items-center rounded-md border text-xs", summary ? "border-foreground/30 bg-accent/40" : "bg-background")}>
    <Popover>
      <PopoverTrigger render={<button type="button" aria-label={summary ? `${name} filter: ${summary}` : `${name} filter`} className="inline-flex h-full max-w-56 items-center gap-1 rounded-md px-2 hover:bg-muted" />}>
        <span className={summary ? "text-muted-foreground" : undefined}>{name}</span>{summary && <span className="truncate font-medium">{summary}</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className={cn(width, "p-3 text-xs")}>{children}</PopoverContent>
    </Popover>
    {summary && <button type="button" aria-label={`Clear ${name} filter`} onClick={onClear} className="mr-1 inline-flex size-5 items-center justify-center rounded hover:bg-muted"><X className="size-3" aria-hidden /></button>}
  </span>;
}
/** A rule the calling screen sets: shown so the user knows why rows are missing, and never removable. */
export function LockedChip({ label, reason }: { label: string; reason: string }) {
  return <span title={`Set by this screen: ${reason}`} aria-label={`${label}. Set by this screen: ${reason}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed px-2 text-xs text-muted-foreground"><Lock className="size-3" aria-hidden />{label}</span>;
}

const DATE_PRESETS: { value: DatePreset; label: string }[] = [{ value: "all", label: "All time" }, { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last 90 days" }, { value: "this-year", label: "This year" }, { value: "last-year", label: "Last year" }, { value: "custom", label: "Custom range" }];
export function DateChip({ value, onChange }: { value: PickerFilterState["date"]; onChange: (v: PickerFilterState["date"]) => void }) {
  const summary = value.preset === "all" ? null : value.preset === "custom" ? `${value.from ?? "…"} – ${value.to ?? "…"}` : DATE_PRESETS.find((p) => p.value === value.preset)!.label;
  return <Chip name="Date" summary={summary} onClear={() => onChange({ preset: "all" })} width="w-72">
    <div role="group" aria-label="Date range" className="grid gap-0.5">
      {DATE_PRESETS.map((p) => <button key={p.value} type="button" aria-pressed={value.preset === p.value} onClick={() => onChange({ ...value, preset: p.value })} className={cn("rounded px-2 py-1 text-left text-xs hover:bg-muted", value.preset === p.value && "bg-muted font-medium")}>{p.label}</button>)}
    </div>
    {value.preset === "custom" && <div className="mt-2 grid grid-cols-2 gap-2"><label className="grid gap-1 text-xs text-muted-foreground">From<DateInput aria-label="From date" value={value.from ?? ""} onValueChange={(from) => onChange({ ...value, from })} /></label><label className="grid gap-1 text-xs text-muted-foreground">To<DateInput aria-label="To date" value={value.to ?? ""} onValueChange={(to) => onChange({ ...value, to })} /></label></div>}
  </Chip>;
}

const AMOUNT_MODES = [{ value: "equals", label: "Equals" }, { value: "between", label: "Between" }, { value: "more", label: "More" }, { value: "less", label: "Less" }] as const;
const money = (minor?: number) => minor === undefined ? "" : formatAmount(minor, 2);
export function AmountChip({ value, onChange }: { value: PickerFilterState["amount"]; onChange: (v: PickerFilterState["amount"]) => void }) {
  const [draft, setDraft] = useState({ a: value.a === undefined ? "" : minorToMajorText(value.a, 2), b: value.b === undefined ? "" : minorToMajorText(value.b, 2) });
  // The comparison is kept here, not derived from the applied value: before an amount is typed there is nothing to apply, yet the choice must stay.
  const [mode, setMode] = useState<(typeof AMOUNT_MODES)[number]["value"]>(value.mode === "any" ? "equals" : value.mode);
  // The last value this chip handed to its owner: a different one arriving means the owner changed it (Clear all), so the draft follows.
  const [emitted, setEmitted] = useState(value);
  if (value !== emitted) {
    setEmitted(value);
    if (value.mode === "any") { setDraft({ a: "", b: "" }); setMode("equals"); }
  }
  const apply = (next: { mode?: typeof mode; a?: string; b?: string }) => {
    const d = { ...draft, ...(next.a !== undefined ? { a: next.a } : {}), ...(next.b !== undefined ? { b: next.b } : {}) }; setDraft(d);
    const m = next.mode ?? mode; setMode(m);
    const parse = (t: string) => { const p = parseMajorToMinor(t.trim().replace(/^[+-]/, "").replace(/,/g, ""), 2); return p.ok && p.value !== null && t.trim() ? p.value : undefined; };
    const a = parse(d.a); const b = parse(d.b);
    const result: PickerFilterState["amount"] = a === undefined || (m === "between" && b === undefined) ? { mode: "any" } : { mode: m, a, ...(m === "between" ? { b } : {}) };
    setEmitted(result); onChange(result);
  };
  const summary = value.mode === "any" ? null : value.mode === "between" ? `${money(value.a)} – ${money(value.b)}` : `${value.mode === "equals" ? "=" : value.mode === "more" ? ">" : "<"} ${money(value.a)}`;
  return <Chip name="Amount" summary={summary} onClear={() => { setDraft({ a: "", b: "" }); setMode("equals"); onChange({ mode: "any" }); }} width="w-80">
    <div className="grid gap-2">
      <Segmented label="Amount comparison" value={mode} options={[...AMOUNT_MODES]} onChange={(m) => apply({ mode: m })} />
      <div className="flex items-center gap-2"><Input className="h-7 text-xs" aria-label={mode === "between" ? "Amount from" : "Amount"} inputMode="decimal" placeholder="0.00" value={draft.a} onChange={(e) => apply({ a: e.target.value })} />
        {mode === "between" && <><span className="text-xs text-muted-foreground">and</span><Input className="h-7 text-xs" aria-label="Amount to" inputMode="decimal" placeholder="0.00" value={draft.b} onChange={(e) => apply({ b: e.target.value })} /></>}</div>
      <p className="text-[11px] text-muted-foreground">Compared without the sign, so a payment and a refund of the same size both match.</p>
    </div>
  </Chip>;
}

/** The is / is not switch shared by the id facets. */
const IsNot = ({ not, onChange }: { not: boolean; onChange: (not: boolean) => void }) => <Segmented label="Match" value={not ? "not" : "is"} options={[{ value: "is", label: "is" }, { value: "not", label: "is not" }]} onChange={(v) => onChange(v === "not")} />;
const summarize = (ids: string[], not: boolean, nameOf: (id: string) => string, extra?: string) => {
  const parts = [...ids.map(nameOf), ...(extra ? [extra] : [])];
  return parts.length === 0 ? null : `${not ? "not " : ""}${parts.length === 1 ? parts[0] : `${parts.length} selected`}`;
};
export function FacetChip({ name, plural, options, value, onChange, onReset, nameOf, extra }: {
  name: string; plural: string; options: ComboboxOption[]; value: IdFilter; onChange: (v: IdFilter) => void; nameOf: (id: string) => string;
  /** Clears the whole filter in one update (the ids, the switch and the extra choice together). */ onReset: () => void;
  /** One more choice above the list (Uncategorized, No payee), shown as a checkbox. */ extra?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
}) {
  return <Chip name={name} summary={summarize(value.ids, value.not, nameOf, extra?.checked ? extra.label : undefined)} onClear={onReset}>
    <div className="grid gap-2">
      <IsNot not={value.not} onChange={(not) => onChange({ ...value, not })} />
      {extra && <label className="flex cursor-pointer items-center gap-2 px-2 text-xs"><Checkbox checked={extra.checked} onCheckedChange={(c) => extra.onChange(c === true)} aria-label={extra.label} />{extra.label}</label>}
      <FacetList options={options} selected={value.ids} onChange={(ids) => onChange({ ...value, ids })} ariaLabel={plural} placeholder={`Search ${plural}…`} />
    </div>
  </Chip>;
}

export function TagsChip({ options, value, onChange }: { options: ComboboxOption[]; value: PickerFilterState["tags"]; onChange: (v: PickerFilterState["tags"]) => void }) {
  const parts = [...value.names, ...(value.none ? ["No tags"] : [])];
  const summary = parts.length === 0 ? null : `${value.not ? "not " : ""}${parts.length === 1 ? parts[0] : `${value.match === "all" && value.names.length > 1 ? "all of " : ""}${parts.length}`}`;
  return <Chip name="Tags" summary={summary} onClear={() => onChange({ names: [], match: "any", none: false, not: false })}>
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2"><Segmented label="Tag match" value={value.match} options={[{ value: "any", label: "Any" }, { value: "all", label: "All" }]} onChange={(match) => onChange({ ...value, match })} /><IsNot not={value.not} onChange={(not) => onChange({ ...value, not })} /></div>
      <label className="flex cursor-pointer items-center gap-2 px-2 text-xs"><Checkbox checked={value.none} onCheckedChange={(c) => onChange({ ...value, none: c === true })} aria-label="No tags" />No tags</label>
      <FacetList options={options} selected={value.names} onChange={(names) => onChange({ ...value, names })} ariaLabel="tags" placeholder="Search tags…" />
      <p className="px-2 text-[11px] text-muted-foreground">Tags are the #words in Notes. Any = at least one of the chosen tags; All = every chosen tag.</p>
    </div>
  </Chip>;
}

export function TransfersChip({ value, onChange }: { value: PickerFilterState["transfers"]; onChange: (v: PickerFilterState["transfers"]) => void }) {
  return <Chip name="Transfers" summary={value === "include" ? null : value === "exclude" ? "excluded" : "only"} onClear={() => onChange("include")} width="w-60">
    <Segmented label="Transfers" value={value} options={[{ value: "include", label: "Include" }, { value: "exclude", label: "Exclude" }, { value: "only", label: "Only" }]} onChange={onChange} />
  </Chip>;
}
