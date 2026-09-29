"use client";

import { useId } from "react";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import type { EditorIssue } from "../../lib/editorModel";

/**
 * Labelled fields for the loan editor. Every control has a visible label tied
 * to it, a hint where the meaning is not obvious, and its validation message
 * announced through `aria-describedby`, so nothing depends on colour alone.
 */

type Common = { label: string; hint?: string; issue?: string };

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

export function TextField({ label, hint, issue, value, onChange, inputMode, placeholder }: Common & { value: string; onChange: (value: string) => void; inputMode?: "decimal" | "numeric" | "text"; placeholder?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} inputMode={inputMode} placeholder={placeholder} aria-invalid={issue ? true : undefined} aria-describedby={describedBy(id, hint, issue)} onChange={(e) => onChange(e.target.value)} />
      <Described id={id} hint={hint} issue={issue} />
    </div>
  );
}

export function SelectField({ label, hint, issue, value, onChange, options, placeholder }: Common & { value: string; onChange: (value: string) => void; options: SelectOption[]; placeholder?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label id={`${id}-label`}>{label}</Label>
      <Select value={value} onValueChange={onChange} options={options} placeholder={placeholder ?? "Choose…"} aria-labelledby={`${id}-label`} id={id} />
      <Described id={id} hint={hint} issue={issue} />
    </div>
  );
}

export function DateField({ label, hint, issue, value, onChange }: Common & { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <DateInput id={id} value={value} onValueChange={onChange} aria-label={label} aria-invalid={issue ? true : undefined} />
      <Described id={id} hint={hint} issue={issue} />
    </div>
  );
}

/** A group of related settings with a heading, and the problems that belong to it. */
export function Section({ title, description, issues = [], children }: { title: string; description?: string; issues?: EditorIssue[]; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-b border-border px-4 py-4">
      <div>
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {issues.length > 0 ? (
        <ul className="list-disc pl-5 text-xs text-destructive" aria-label={`Problems in ${title}`}>
          {issues.map((i) => (
            <li key={`${i.field}:${i.message}`}>
              <span className="font-medium">{i.field}</span>: {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

export const issueFor = (issues: EditorIssue[], field: string) => issues.find((i) => i.field === field)?.message;
