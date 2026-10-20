"use client";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** Extra keys (for example ↑/↓ between statements); return true when handled. */
  onKeys?: (event: KeyboardEvent<HTMLElement>) => boolean;
  /** Where focus goes on close; defaults to whatever opened the panel. */
  returnFocus?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Match the header height of the table beside it (px); the title and description share the first line. */
  headerHeight?: number;
  /** A second header line, such as a status badge and the main action. */
  headerExtra?: ReactNode;
  /** A muted hint under the footer actions (for example keyboard keys). */
  hint?: ReactNode;
  className?: string;
};

/**
 * A docked inspector (DESIGN §3.2–3.3): it sits beside the table in the same canvas, never over it,
 * so the selected row stays visible. Esc closes it and focus returns to the row that opened it.
 * Render it as the last child of a `flex` row whose first child is the table area.
 */
export function SidePanel(props: Props) {
  const { title, description, onClose, onKeys, returnFocus, children, footer, headerHeight, headerExtra, hint, className } = props;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restore = useRef(returnFocus);
  useEffect(() => { restore.current = returnFocus; }, [returnFocus]);
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (restore.current) restore.current();
      else if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [title]);
  function keys(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (onKeys?.(event)) event.preventDefault();
  }
  return <aside
    aria-labelledby={headingId}
    onKeyDown={keys}
    className={cn("flex w-[400px] min-w-[360px] shrink-0 flex-col border-l bg-background", className)}
  >
    <div
      className={cn("flex shrink-0 justify-between gap-3 border-b px-4", headerHeight ? "items-center bg-muted" : "items-start py-3")}
      style={headerHeight ? { height: headerHeight } : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className={cn("min-w-0", headerHeight && "flex items-baseline gap-2")}>
          <h2 id={headingId} ref={heading} tabIndex={-1} className="shrink-0 truncate text-sm font-semibold outline-none">{title}</h2>
          {description && <div className={cn("text-xs text-muted-foreground", headerHeight ? "truncate" : "mt-0.5")}>{description}</div>}
        </div>
        {headerExtra && <div className="mt-1 flex items-center justify-between gap-2">{headerExtra}</div>}
      </div>
      <Button variant="ghost" size="icon-sm" aria-label={`Close ${title}`} onClick={onClose}><X className="size-4" aria-hidden /></Button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    {(footer || hint) && <div className="shrink-0 space-y-2 border-t px-4 py-3">
      {footer && <div className="flex flex-wrap gap-2">{footer}</div>}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>}
  </aside>;
}

/** A titled block inside a side panel. */
export function PanelSection({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="border-b px-4 py-3 last:border-b-0" aria-label={title}>
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {action}
    </div>
    {children}
  </section>;
}

/** One label/value line; values are tabular and neutral. */
export function PanelRow({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return <div className={cn("flex items-baseline justify-between gap-3 py-0.5 text-[13px]", strong && "font-semibold")}>
    <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
    <dd className="tabular-nums">{value}</dd>
  </div>;
}
