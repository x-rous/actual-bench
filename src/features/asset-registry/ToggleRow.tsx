"use client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** A labelled on/off setting: the label and its one-line hint on the left, the switch on the right. */
export function ToggleRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="flex items-center justify-between gap-6"><div className="min-w-0"><Label id={`${id}-label`} htmlFor={id} className="text-sm leading-5 font-medium">{label}</Label><p id={`${id}-hint`} className="mt-0.5 text-xs leading-4 text-muted-foreground">{hint}</p></div><Switch id={id} aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`} className="shrink-0" checked={checked} onCheckedChange={onChange} /></div>;
}
