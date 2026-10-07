"use client";

import { useId, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type HelpItem = {
  term: string;
  description: ReactNode;
};

export type HelpGroup = {
  title?: string;
  items: HelpItem[];
};

export function HelpDialogButton({ title, description, groups, className }: { title: string; description?: ReactNode; groups: HelpGroup[]; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("size-6 text-muted-foreground hover:text-foreground", className)}
        aria-label={`About ${title}`}
        onClick={() => setOpen(true)}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </Button>
      {open ? <Dialog open onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="flex flex-col gap-5">
            {groups.map((group, index) => (
              <section key={group.title ?? index} className="flex flex-col gap-2">
                {group.title ? <h3 className="text-sm font-semibold">{group.title}</h3> : null}
                <dl className="divide-y divide-border rounded-lg border border-border">
                  {group.items.map((item) => (
                    <div key={item.term} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
                      <dt className="text-xs font-medium text-foreground">{item.term}</dt>
                      <dd className="text-xs leading-relaxed text-muted-foreground">{item.description}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog> : null}
    </>
  );
}

type Props = {
  title: string;
  helpDescription?: ReactNode;
  help: HelpGroup[];
  children: ReactNode;
  className?: string;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  collapsedSummary?: ReactNode;
};

/** A bordered settings group, or a compact borderless activation row while disabled. */
export function ConfigurationSection({ title, helpDescription, help, children, className, enabled, onEnabledChange, collapsedSummary }: Props) {
  const switchId = useId();
  const toggleable = enabled !== undefined && onEnabledChange !== undefined;
  const heading = (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span>{title}</span>
      <HelpDialogButton title={`${title} help`} description={helpDescription} groups={help} />
    </span>
  );
  const toggle = toggleable ? (
    <Switch
      id={switchId}
      checked={enabled}
      onCheckedChange={onEnabledChange}
      aria-label={`${enabled ? "Disable" : "Enable"} ${title}`}
    />
  ) : null;

  if (toggleable && !enabled) {
    return (
      <div role="group" aria-label={title} className={cn("flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-2", className)}>
        <div className="min-w-0">
          <div className="flex items-center text-sm font-semibold">{heading}</div>
          {collapsedSummary ? <p className="pl-0 text-[11px] text-muted-foreground">{collapsedSummary}</p> : null}
        </div>
        {toggle}
      </div>
    );
  }

  return (
    <fieldset aria-label={title} className={cn("flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-4", className)}>
      <legend className="w-full max-w-full px-1">
        <span className="flex w-full items-center justify-between gap-3 text-sm font-semibold">
          {heading}
          {toggle}
        </span>
      </legend>
      {children}
    </fieldset>
  );
}
