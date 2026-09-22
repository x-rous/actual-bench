"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { InfoHint } from "@/components/ui/info-hint";
import { cn } from "@/lib/utils";

/**
 * One section of the detection panel.
 *
 * The three sections beside the page - the layout, how the statement is read,
 * and what its columns hold - were each written with their own padding,
 * heading size and spacing, so a panel meant to be read top to bottom arrived
 * in three different rhythms. This is that rhythm, once: same frame, same
 * header, same body padding, same gap between a label and its control.
 *
 * Open state is the caller's when it passes `open`, and the section's own when
 * it does not.
 */
export function PdfPanelSection({
  title,
  summary,
  action,
  open,
  onOpenChange,
  defaultOpen = true,
  footer,
  children,
}: {
  title: string;
  /** The current answer, for when the section is closed. */
  summary?: React.ReactNode;
  /** A control that belongs to the section rather than to its contents. */
  action?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  /** Shown whether the section is open or closed, under the header. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const isOpen = open ?? ownOpen;
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="rounded-md border">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => (onOpenChange ? onOpenChange(!isOpen) : setOwnOpen((current) => !current))}
          className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn("size-3.5 shrink-0 transition-transform", !isOpen && "-rotate-90")}
          />
          <h3 id={headingId} className="shrink-0 text-sm font-medium">{title}</h3>
          {summary && <span className="min-w-0 truncate text-[11px] text-muted-foreground">{summary}</span>}
        </button>
        {action}
      </div>
      {isOpen && <div className="space-y-2 px-3 pb-3">{children}</div>}
      {footer && <div className="px-3 pb-3">{footer}</div>}
    </section>
  );
}

/**
 * A setting: its name, then its control under it.
 *
 * Side by side, the name had to give way to the control and a setting called
 * "Use as import date" arrived as "Use as impo…". A label that has to be
 * guessed at is worth more than the height it costs, and the height this
 * panel needed came from the density of the controls and from putting three
 * settings on a line, not from where the label sits.
 */
export function PdfPanelField({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** What the setting means, for when it is not obvious from its name. */
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground">
        <label htmlFor={htmlFor}>{label}</label>
        {hint && <InfoHint label={label.toLowerCase()}>{hint}</InfoHint>}
      </span>
      {children}
    </div>
  );
}

/** The sentence under a section's controls, wherever one is needed. */
export function PdfPanelNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[11px] text-muted-foreground", className)}>{children}</p>;
}
