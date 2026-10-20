"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseMajorToMinor } from "@/features/assets-debt/lib/money";
import { CARD_DATE_FORMAT, formatCardDate } from "../lib/displayDates";
import { money } from "./primitives/format";

export type LimitChangeDraft = { effectiveDate: string; limitMinor: number };

type Props = {
  /** The limit the card started with (before any change). */
  startingMinor: number | null;
  changes: LimitChangeDraft[];
  today: string;
  onChange: (changes: LimitChangeDraft[]) => void;
  onClose: () => void;
};

/**
 * Record a limit change (card Settings): a new limit from an effective date, any day of the month.
 * Earlier changes are listed and can be removed. Saved with the card.
 */
export function LimitChangesDialog({ startingMinor, changes, today, onChange, onClose }: Props) {
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const sorted = [...changes].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));

  function record() {
    const parsed = parseMajorToMinor(amount.replaceAll(",", ""), 2);
    if (!date) return setError("Enter the effective date");
    if (!parsed.ok || parsed.value === null || parsed.value < 0) return setError("Enter the new limit");
    onChange([...changes.filter((entry) => entry.effectiveDate !== date), { effectiveDate: date, limitMinor: parsed.value }]);
    setAmount("");
    setError("");
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Record a limit change</DialogTitle>
        <DialogDescription>The new limit applies from its effective date, any day of the month. Earlier figures keep the limit they had.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="limit-change-date" className="text-xs text-muted-foreground">Effective date</Label>
          <DateInput id="limit-change-date" value={date} onValueChange={setDate} dateFormat={CARD_DATE_FORMAT} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="limit-change-amount" className="text-xs text-muted-foreground">New limit</Label>
          <Input id="limit-change-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end"><Button size="sm" variant="outline" onClick={record}>Add change</Button></div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Limit history</p>
        <ul aria-label="Limit history" className="divide-y rounded-md border text-sm">
          {sorted.map((entry) => <li key={entry.effectiveDate} className="flex items-center gap-3 px-3 py-1.5">
            <span className="w-28">{formatCardDate(entry.effectiveDate)}</span>
            <span className="flex-1 tabular-nums">{money(entry.limitMinor)}</span>
            {entry.effectiveDate > today && <span className="text-xs text-muted-foreground">upcoming</span>}
            <Button size="icon-xs" variant="ghost" aria-label={`Remove the change on ${formatCardDate(entry.effectiveDate)}`}
              onClick={() => onChange(changes.filter((other) => other.effectiveDate !== entry.effectiveDate))}><X className="size-3" aria-hidden /></Button>
          </li>)}
          <li className="flex items-center gap-3 px-3 py-1.5 text-muted-foreground">
            <span className="w-28">Starting limit</span>
            <span className="flex-1 tabular-nums">{money(startingMinor)}</span>
          </li>
        </ul>
      </div>
      <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
