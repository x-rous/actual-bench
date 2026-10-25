"use client";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { parseMajorToMinor } from "@/features/assets-debt/lib/money";
import { bankToday } from "@/features/credit-cards/lib/cycles";
import { StatusBadge } from "@/features/credit-cards/components/primitives/StatusBadge";

export type OwnershipPeriod = { effectiveFrom: string; ownershipBps: number };
/** The first ownership period of an asset whose date nobody remembers: it simply holds from the start. */
export const OWNERSHIP_FROM_START = "1900-01-01";

/**
 * Ownership over time as a small table: from which date you own what share. The row in force today is marked Current.
 * The account's value already represents your share; ownership never multiplies or changes it.
 */
export function OwnershipTable({ value, onChange, today = bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone), disabled = false }: { value: OwnershipPeriod[]; onChange: (next: OwnershipPeriod[]) => void; today?: string; disabled?: boolean }) {
  const current = [...value].filter((p) => p.effectiveFrom <= today).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const duplicate = new Set(value.map((p) => p.effectiveFrom)).size !== value.length;
  const update = (index: number, patch: Partial<OwnershipPeriod>) => onChange(value.map((p, i) => i === index ? { ...p, ...patch } : p));
  return <div className="grid gap-2">
    <div className="overflow-hidden rounded-md border">
      <table className="w-full table-fixed border-collapse text-xs">
        <thead className="bg-muted/40 text-muted-foreground"><tr><th scope="col" className="px-2 py-1.5 text-left font-medium">Effective from</th><th scope="col" className="w-36 px-2 py-1.5 text-left font-medium">You own</th><th scope="col" className="w-24 px-2 py-1.5 text-left font-medium">&nbsp;</th><th scope="col" className="w-9 px-1 py-1.5"><span className="sr-only">Remove</span></th></tr></thead>
        <tbody>{value.map((period, index) => <tr key={index} className="border-t">
          <td className="p-1.5">{period.effectiveFrom === OWNERSHIP_FROM_START
            ? <div className="flex h-7 items-center gap-2 px-1"><span className="text-muted-foreground">From the start</span><Button type="button" size="xs" variant="ghost" disabled={disabled} aria-label={`Pick an ownership date for period ${index + 1}`} onClick={() => update(index, { effectiveFrom: today })}>Pick a date</Button></div>
            : <DateInput size="sm" aria-label={`Ownership effective date ${index + 1}`} disabled={disabled} value={period.effectiveFrom} onValueChange={(effectiveFrom) => update(index, { effectiveFrom })} />}</td>
          <td className="p-1.5"><div className="flex items-center gap-1"><Input size="sm" aria-label={`Ownership percentage ${index + 1}`} type="number" min="0" max="100" step="0.01" disabled={disabled} value={period.ownershipBps / 100}
            onChange={(e) => { const n = parseMajorToMinor(e.target.value, 2); if (n.ok && n.value !== null && n.value <= 10000) update(index, { ownershipBps: n.value }); }} /><span className="text-muted-foreground">%</span></div></td>
          <td className="px-2">{current === period && <StatusBadge label="Current" tone="success" />}</td>
          <td className="p-1"><Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove ownership period ${index + 1}`} disabled={disabled || value.length === 1} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 className="size-3.5" aria-hidden /></Button></td>
        </tr>)}</tbody>
      </table>
    </div>
    {duplicate && <p role="alert" className="text-xs text-destructive">Two rows have the same date. Each date can have one share.</p>}
    <Button type="button" size="sm" variant="outline" className="justify-self-start" disabled={disabled} onClick={() => onChange([...value, { effectiveFrom: today, ownershipBps: value[value.length - 1]?.ownershipBps ?? 10000 }])}><Plus className="size-3.5" aria-hidden />Add a change of share</Button>
  </div>;
}
