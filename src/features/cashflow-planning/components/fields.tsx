"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatAmountInput, parseAmount } from "@/lib/cashflow-planning/document";
import { isMonth } from "@/lib/cashflow-planning/months";
import type { Month } from "@/lib/cashflow-planning/types";

/** Small inputs that hold what is typed until it is left or Enter is pressed, and only then hand over a checked value. */

const plain = (minor: number | null) => (minor === null ? "" : formatAmountInput(minor));

/** An amount in whole units with up to two decimals. Empty text is `null` when `allowEmpty`, otherwise the value is put back. */
export function AmountField({ value, onCommit, allowEmpty = false, className, placeholder, id, ...aria }: { value: number | null; onCommit: (minor: number | null) => void; allowEmpty?: boolean; className?: string; placeholder?: string; id?: string; "aria-label"?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    if (text === "") { setDraft(null); setInvalid(false); if (allowEmpty && value !== null) onCommit(null); return; }
    const minor = parseAmount(text);
    if (minor === null) { setInvalid(true); return; }
    setDraft(null); setInvalid(false);
    if (minor !== value) onCommit(minor);
  };
  return (
    <Input
      id={id} size="sm" inputMode="decimal" placeholder={placeholder} aria-invalid={invalid || undefined} {...aria}
      className={cn("text-right tabular-nums", className)}
      value={draft ?? plain(value)}
      onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape" && draft !== null) { e.stopPropagation(); setDraft(null); setInvalid(false); } }}
    />
  );
}

/** A month typed as YYYY-MM. */
export function MonthField({ value, onCommit, onInvalid, allowEmpty = false, min, max, className, id, ...aria }: { value: Month | null; onCommit: (month: Month | null) => void; /** Told whether the text typed is not a month the field can take, so a dialog can hold back what depends on it. */ onInvalid?: (invalid: boolean) => void; allowEmpty?: boolean; min?: Month; max?: Month; className?: string; id?: string; "aria-label"?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { onInvalid?.(invalid); }, [invalid, onInvalid]);
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    if (text === "") { setDraft(null); setInvalid(false); if (allowEmpty && value !== null) onCommit(null); return; }
    // "2026-3" and "2026/03" are what people type; both mean March.
    const match = /^(\d{4})[-/.](\d{1,2})$/.exec(text);
    const month = match ? `${match[1]}-${match[2].padStart(2, "0")}` : text;
    if (!isMonth(month) || (min && month < min) || (max && month > max)) { setInvalid(true); return; }
    setDraft(null); setInvalid(false);
    if (month !== value) onCommit(month);
  };
  return (
    <Input
      id={id} size="sm" placeholder="YYYY-MM" aria-invalid={invalid || undefined} {...aria}
      className={cn("tabular-nums", className)}
      value={draft ?? value ?? ""}
      onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape" && draft !== null) { e.stopPropagation(); setDraft(null); setInvalid(false); } }}
    />
  );
}

/** A percentage with up to two decimals, within the given bounds; empty is zero. */
export function PercentField({ value, onCommit, min = -50, max = 100, className, id, ...aria }: { value: number; onCommit: (value: number) => void; min?: number; max?: number; className?: string; id?: string; "aria-label"?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim().replace(/%$/, "");
    const number = text === "" ? 0 : Number(text);
    if (!Number.isFinite(number) || number < min || number > max) { setInvalid(true); return; }
    setDraft(null); setInvalid(false);
    const rounded = Math.round(number * 100) / 100;
    if (rounded !== value) onCommit(rounded);
  };
  return (
    <Input
      id={id} size="sm" inputMode="decimal" placeholder="0" aria-invalid={invalid || undefined} {...aria}
      className={cn("text-right tabular-nums", className)}
      value={draft ?? (value ? String(value) : "")}
      onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape" && draft !== null) { e.stopPropagation(); setDraft(null); setInvalid(false); } }}
    />
  );
}

/** Text that is saved when the field is left: a name, a note. */
export function TextField({ value, onCommit, className, id, maxLength, ...aria }: { value: string; onCommit: (text: string) => void; className?: string; id?: string; maxLength?: number; "aria-label"?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft === null) return; const text = draft.trim(); setDraft(null); if (text && text !== value) onCommit(text); };
  return (
    <Input
      id={id} size="sm" maxLength={maxLength} {...aria} className={className}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape" && draft !== null) { e.stopPropagation(); setDraft(null); } }}
    />
  );
}
