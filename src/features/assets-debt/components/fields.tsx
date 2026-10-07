"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fractionToPercent, minorToMajorText, parseMajorToMinor, percentToFraction } from "../lib/money";

/**
 * Labelled fields for Assets & Debt. Every control has a visible label tied to
 * it, a hint where the meaning is not obvious, and its validation message
 * announced through `aria-describedby`, so nothing depends on colour alone.
 * Money and rate fields keep the text a person typed and report exact values:
 * integer minor units and decimal strings, never floats.
 */

type Common = { label: string; hint?: string; issue?: string; className?: string; /** Visually hidden label (a table column header says it); still read by assistive tech. */ hideLabel?: boolean };

const FIELD_LABEL = "text-xs font-medium text-muted-foreground";
const labelClass = (hide?: boolean) => (hide ? "sr-only" : FIELD_LABEL);

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

export function TextField({ label, hint, issue, value, onChange, inputMode, placeholder, className, hideLabel }: Common & { value: string; onChange: (value: string) => void; inputMode?: "decimal" | "numeric" | "text"; placeholder?: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label className={labelClass(hideLabel)} htmlFor={id}>{label}</Label>
      <Input id={id} className="text-[13px]" value={value} inputMode={inputMode} placeholder={placeholder} aria-invalid={issue ? true : undefined} aria-describedby={describedBy(id, hint, issue)} onChange={(e) => onChange(e.target.value)} />
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

export function MoneyField({ label, hint, issue, valueMinor, minorDigits, onChange, className, suffix, hideLabel, fixedDecimals }: Common & { valueMinor: number | null; minorDigits: number; onChange: (minor: number | null) => void; suffix?: string; /** Always show every decimal (an amount of money, not an input like a loan size). */ fixedDecimals?: boolean }) {
  const id = useId();
  const external = fixedDecimals && valueMinor !== null ? groupTypedAmount(minorToMajorText(valueMinor, minorDigits)) : editableAmount(valueMinor, minorDigits);
  const { text, setText, onFocus, onBlur } = useSyncedText(external);
  const parsed = parseMajorToMinor(text, minorDigits);
  const problem = issue ?? (parsed.ok ? undefined : parsed.message);
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label className={labelClass(hideLabel)} htmlFor={id}>{label}</Label>
      <div className="relative flex items-center">
        <Input
          id={id}
          value={text}
          inputMode="decimal"
          className={suffix ? "pr-16 text-[13px]" : "text-[13px]"}
          aria-invalid={problem ? true : undefined}
          aria-describedby={describedBy(id, hint, problem)}
          onFocus={() => {
            onFocus();
            setText(text.replace(/,/g, ""));
          }}
          onBlur={() => {
            onBlur();
            if (parsed.ok) setText(fixedDecimals ? groupTypedAmount(minorToMajorText(parsed.value, minorDigits)) : groupTypedAmount(text));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const r = parseMajorToMinor(e.target.value, minorDigits);
            onChange(r.ok ? r.value : null);
          }}
        />
        {suffix ? <span className="pointer-events-none absolute right-3 text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
      <Described id={id} hint={hint} issue={problem} />
    </div>
  );
}

export function PercentField({ label, hint, issue, valueFraction, onChange, className, suffix = "%" }: Common & { valueFraction: string | null; onChange: (fraction: string | null) => void; suffix?: string }) {
  const id = useId();
  const { text, setText, onFocus, onBlur } = useSyncedText(fractionToPercent(valueFraction));
  const parsed = percentToFraction(text);
  const problem = issue ?? (parsed.ok ? undefined : parsed.message);
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label className={FIELD_LABEL} htmlFor={id}>{label}</Label>
      <div className="relative flex items-center">
        <Input
          id={id}
          value={text}
          inputMode="decimal"
          className="pr-14 text-[13px]"
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
        <span className="pointer-events-none absolute right-3 text-xs text-muted-foreground" aria-hidden>
          {suffix}
        </span>
      </div>
      <Described id={id} hint={hint} issue={problem} />
    </div>
  );
}

export function IntegerField({ label, hint, issue, value, onChange, min = 0, className, suffix, hideLabel }: Common & { value: number | null; onChange: (value: number | null) => void; min?: number; suffix?: string }) {
  const id = useId();
  const { text, setText, onFocus, onBlur } = useSyncedText(value === null ? "" : String(value));
  const valid = text.trim() === "" || (/^\d+$/.test(text.trim()) && Number(text) >= min);
  const problem = issue ?? (valid ? undefined : `Enter a whole number of at least ${min}`);
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label className={labelClass(hideLabel)} htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          className="text-[13px]"
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

export function SelectField({ label, labelAccessory, hint, issue, value, onChange, options, placeholder, className, hideLabel }: Common & { labelAccessory?: ReactNode; value: string; onChange: (value: string) => void; options: SelectOption[]; placeholder?: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <Label className={labelClass(hideLabel)} id={`${id}-label`}>{label}</Label>
        {labelAccessory ? <span className="text-right text-[11px] text-muted-foreground">{labelAccessory}</span> : null}
      </div>
      <Select className="text-[13px]" value={value} onValueChange={onChange} options={options} placeholder={placeholder ?? "Choose…"} aria-labelledby={`${id}-label`} id={id} />
      <Described id={id} hint={hint} issue={issue} />
    </div>
  );
}

export function DateField({ label, hint, issue, value, onChange, className, hideLabel }: Common & { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label className={labelClass(hideLabel)} htmlFor={id}>{label}</Label>
      <DateInput id={id} inputClassName="text-[13px]" value={value} onValueChange={onChange} aria-label={label} aria-invalid={issue ? true : undefined} aria-describedby={describedBy(id, hint, issue)} />
      <Described id={id} hint={hint} issue={issue} />
    </div>
  );
}

/** A labelled on/off switch: state is in text and the checked attribute, never colour alone. */
export function FeatureSwitch({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex min-h-9 items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label} <span className="sr-only">{checked ? "(on)" : "(off)"}</span>
        </label>
        {description ? (
          <span id={`${id}-desc`} className="text-[11px] text-muted-foreground">
            {description}
          </span>
        ) : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={description ? `${id}-desc` : undefined} className="mt-0.5" />
    </div>
  );
}

/** Initial/external values omit redundant zero decimals; typed decimals are preserved on blur. */
function editableAmount(valueMinor: number | null, minorDigits: number): string {
  if (valueMinor === null) return "";
  const plain = minorToMajorText(valueMinor, minorDigits);
  const trimmed = plain.includes(".") ? plain.replace(/\.0+$/, "") : plain;
  return groupTypedAmount(trimmed);
}

function groupTypedAmount(value: string): string {
  const clean = value.replace(/[,\s_]/g, "");
  const match = /^(\d+)(\.\d*)?$/.exec(clean);
  if (!match) return value;
  return `${match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${match[2] ?? ""}`;
}
