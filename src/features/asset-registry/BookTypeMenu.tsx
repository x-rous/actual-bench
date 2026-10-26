"use client";
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import { BOOK_TYPES } from "@/lib/asset-registry/models";
import type { AttributedRow } from "@/lib/asset-registry/ledger";
import { BOOK_TYPE_TAGS } from "@/lib/asset-registry/tags";
import { bookTypeChoices } from "./bookTypes";
import { assetMoney } from "./AssetPresentation";

/** One row, or several for bulk classification: only types valid for every row's sign are offered. */
export function BookTypeMenu({ rows, taggable, anchor, onClose, onSave }: {
  rows: AttributedRow[]; /** How many of the rows can have their Notes tagged in Actual (the rest are protected). */ taggable: number; anchor: Element; onClose: () => void; onSave: (value: string) => Promise<void>;
}) {
  const row = rows[0];
  const types = rows.map((r) => r.classification ?? "");
  const [value, setValue] = useState(types.every((t) => t === types[0]) ? types[0] : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choices = ["", ...bookTypeChoices(row.amountMinor).filter((type) => rows.every((r) => bookTypeChoices(r.amountMinor).includes(type)))];
  async function save() {
    setBusy(true); setError("");
    try { await onSave(value); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save type"); }
    finally { setBusy(false); }
  }
  return <Popover.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><Popover.Portal><Popover.Positioner anchor={anchor} side="bottom" align="start" sideOffset={4} className="z-[80]"><Popover.Popup aria-label={rows.length > 1 ? `Type of ${rows.length} transactions` : `Type of ${row.label}`} className="w-[26rem] max-w-[92vw] rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none">
    <p className="font-medium">{rows.length > 1 ? `${rows.length} transactions` : `${row.label} · ${assetMoney(row.amountMinor)}`}</p>
    <fieldset disabled={busy} className="mt-3 grid grid-cols-2 gap-1"><legend className="mb-2 text-xs text-muted-foreground">Entry type</legend>{choices.map((choice) => <label key={choice} className="relative cursor-pointer"><input type="radio" name="book-popup-type" className="peer sr-only" checked={value === choice} onChange={() => setValue(choice)} /><span className="flex min-h-8 items-center rounded border px-2 py-1 text-[11px] whitespace-nowrap peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{choice ? BOOK_TYPES[choice as keyof typeof BOOK_TYPES] : "Unclassified"}</span></label>)}</fieldset>
    <p className="mt-2 text-[11px] text-muted-foreground">{taggable === 0 ? "The type is kept in Bench only; the transaction in Actual is not changed."
      : `${value ? `Also writes ${BOOK_TYPE_TAGS[value as keyof typeof BOOK_TYPE_TAGS]} to` : "Also removes any type tag from"} the Notes in Actual${taggable < rows.length ? ` for ${taggable} of ${rows.length} rows (the others were not created by Bench and stay untouched)` : ""}, so the type is readable there.`}</p>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    <div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button size="sm" disabled={busy || !choices.includes(value)} onClick={() => void save()}>{busy ? "Saving…" : "Set type"}</Button></div>
  </Popover.Popup></Popover.Positioner></Popover.Portal></Popover.Root>;
}
