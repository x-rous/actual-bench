"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { minorToMajorText, parseMajorToMinor } from "@/features/assets-debt/lib/money";

/**
 * Number fields that take what is typed and settle it when the field is left (or Enter), so "12." can be typed on the way to "12.50".
 * Escape puts back what was there; what cannot be read is marked, and never applied.
 */

const FIELD = "tabular-nums text-foreground";
const keys = (commit: () => void, cancel: () => void, editing: boolean) => (e: React.KeyboardEvent) => {
  if (e.key === "Enter") { e.preventDefault(); commit(); }
  if (e.key === "Escape" && editing) { e.stopPropagation(); cancel(); }
};

/** An amount in money, in two decimals, as minor units. */
export function AmountInput({ minor, label, disabled, onCommit, className = "h-6 text-right", allowNegative = false }: { minor: number; label: string; disabled?: boolean; onCommit: (minor: number) => void; className?: string; allowNegative?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const commit = () => {
    if (text === null) return;
    const negative = allowNegative && text.trim().startsWith("-");
    const parsed = parseMajorToMinor(negative ? text.trim().slice(1) : text, 2);
    if (parsed.ok && parsed.value !== null) { onCommit(negative ? -parsed.value : parsed.value); setBad(false); setText(null); } else setBad(true);
  };
  return (
    <Input
      size="sm" inputMode="decimal" aria-label={label} disabled={disabled} aria-invalid={bad || undefined}
      className={`${FIELD} ${className} ${bad ? "border-destructive" : ""}`}
      value={text ?? minorToMajorText(minor, 2)}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={keys(commit, () => { setText(null); setBad(false); }, text !== null)}
    />
  );
}

/** A number such as a percentage or a whole number of years, kept inside its limits. */
export function NumberInput({ value, label, min, max, decimals = 1, suffix, onCommit, className = "h-6 w-20 text-right", disabled }: { value: number; label: string; min: number; max: number; decimals?: number; suffix?: string; onCommit: (value: number) => void; className?: string; disabled?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const shown = (v: number) => (decimals === 0 ? String(Math.round(v)) : String(Number(v.toFixed(decimals))));
  const commit = () => {
    if (text === null) return;
    const n = Number(text.trim().replace(/,/g, ""));
    if (text.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) { onCommit(decimals === 0 ? Math.round(n) : Number(n.toFixed(decimals))); setBad(false); setText(null); } else setBad(true);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <Input size="sm" inputMode="decimal" aria-label={label} disabled={disabled} aria-invalid={bad || undefined} className={`${FIELD} ${className} ${bad ? "border-destructive" : ""}`}
        value={text ?? shown(value)} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={keys(commit, () => { setText(null); setBad(false); }, text !== null)} />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </span>
  );
}
