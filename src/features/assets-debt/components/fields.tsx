"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { fractionToPercent, minorToMajorText, parseMajorToMinor, percentToFraction } from "../lib/money";

/**
 * Labelled fields for Assets & Debt. Every control has a visible label tied to
 * it, a hint where the meaning is not obvious, and its validation message
 * announced through `aria-describedby`, so nothing depends on colour alone.
 * Money and rate fields keep the text a person typed and report exact values:
 * integer minor units and decimal strings, never floats.
 */

type Common = { label: string; hint?: string; issue?: string; className?: string };

function Described({ id, hint, issue }: { id: string; hint?: string; issue?: string }) {
  return (
    <>
      {hint ? (
        <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {issue ? (
        <p id={`${id}-issue`} className="text-[11px] font-medium text-destructive">
          {issue}
        </p>
      ) : null}
    </>
  );
}

const describedBy = (id: string, hint?: string, issue?: string) => [hint ? `${id}-hint` : "", issue ? `${id}-issue` : ""].filter(Boolean).join(" ") || undefined;

export function TextField({ label, hint, issue, value, onChange, inputMode, placeholder, className }: Common & { value: string; onChange: (value: string) => void; inputMode?: "decimal" | "numeric" | "text"; placeholder?: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} inputMode={inputMode} placeholder={placeholder} aria-invalid={issue ? true : undefined} aria-describedby={describedBy(id, hint, issue)} onChange={(e) => onChange(e.target.value)} />
      <Described id={id} hint={hint} issue={issue} />
    </div>
  );
}

/** Keeps the typed text while focused; follows the value when it changes from outside. */
function useSyncedText(external: string) {
  const [text, setText] = useState(external);
  const focused = useRef(false);
  useEffect(() => {
    // Reflect outside changes (a preset, a reload) unless the person is typing here.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing an external value into an editable text buffer
    if (!focused.current) setText(external);
  }, [external]);
  return { text, setText, onFocus: () => (focused.current = true), onBlur: () => (focused.current = false) };
}

export function MoneyField({ label, hint, issue, valueMinor, minorDigits, onChange, className, suffix }: Common & { valueMinor: number | null; minorDigits: number; onChange: (minor: number | null) => void; suffix?: string }) {
  const id = useId();
  const { text, setText, onFocus, onBlur } = useSyncedText(minorToMajorText(valueMinor, minorDigits));
  const parsed = parseMajorToMinor(text, minorDigits);
  const problem = issue ?? (parsed.ok ? undefined : parsed.message);
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          value={text}
          inputMode="decimal"
          aria-invalid={problem ? true : undefined}
          aria-describedby={describedBy(id, hint, problem)}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(e) => {
            setText(e.target.value);
            const r = parseMajorToMinor(e.target.value, minorDigits);
            onChange(r.ok ? r.value : null);
          }}
        />
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
      <Described id={id} hint={hint} issue={problem} />
    </div>
  );
}

export function PercentField({ label, hint, issue, valueFraction, onChange, className }: Common & { valueFraction: string | null; onChange: (fraction: string | null) => void }) {
  const id = useId();
  const { text, setText, onFocus, onBlur } = useSyncedText(fractionToPercent(valueFraction));
  const parsed = percentToFraction(text);
  const problem = issue ?? (parsed.ok ? undefined : parsed.message);
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          value={text}
          inputMode="decimal"
          aria-invalid={problem ? true : undefined}
          aria-describedby={describedBy(id, hint, problem)}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(e) => {
            setText(e.target.value);
            const r = percentToFraction(e.target.value);
            onChange(r.ok ? r.value : null);
          }}
        />
        <span className="text-xs text-muted-foreground" aria-hidden>
          %
        </span>
      </div>
      <Described id={id} hint={hint} issue={problem} />
    </div>
  );
}

export function IntegerField({ label, hint, issue, value, onChange, min = 0, className, suffix }: Common & { value: number | null; onChange: (value: number | null) => void; min?: number; suffix?: string }) {
  const id = useId();
  const { text, setText, onFocus, onBlur } = useSyncedText(value === null ? "" : String(value));
  const valid = text.trim() === "" || (/^\d+$/.test(text.trim()) && Number(text) >= min);
  const problem = issue ?? (valid ? undefined : `Enter a whole number of at least ${min}`);
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          value={text}
          inputMode="numeric"
          aria-invalid={problem ? true : undefined}
          aria-describedby={describedBy(id, hint, problem)}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(e) => {
            setText(e.target.value);
            const t = e.target.value.trim();
            onChange(/^\d+$/.test(t) && Number(t) >= min ? Number(t) : null);
          }}
        />
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
      <Described id={id} hint={hint} issue={problem} />
    </div>
  );
}

export function SelectField({ label, hint, issue, value, onChange, options, placeholder, className }: Common & { value: string; onChange: (value: string) => void; options: SelectOption[]; placeholder?: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label id={`${id}-label`}>{label}</Label>
      <Select value={value} onValueChange={onChange} options={options} placeholder={placeholder ?? "Choose…"} aria-labelledby={`${id}-label`} id={id} />
      <Described id={id} hint={hint} issue={issue} />
    </div>
  );
}

export function DateField({ label, hint, issue, value, onChange, className }: Common & { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <DateInput id={id} value={value} onValueChange={onChange} aria-label={label} aria-invalid={issue ? true : undefined} />
      <Described id={id} hint={hint} issue={issue} />
    </div>
  );
}

/** A labelled on/off switch: state is in text and the checked attribute, never colour alone. */
export function FeatureSwitch({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} role="switch" aria-checked={checked} checked={checked} onCheckedChange={onChange} className="mt-0.5" aria-describedby={description ? `${id}-desc` : undefined} />
      <div className="flex flex-col">
        <label htmlFor={id} className="text-sm font-medium">
          {label} <span className="sr-only">{checked ? "(on)" : "(off)"}</span>
        </label>
        {description ? (
          <span id={`${id}-desc`} className="text-[11px] text-muted-foreground">
            {description}
          </span>
        ) : null}
      </div>
    </div>
  );
}
