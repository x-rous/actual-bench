"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PendingActionsSlot, usePendingPanel } from "./PendingPanelContext";

type Props = {
  title: string;
  displayTitle?: string;
  count: number;
  errors?: number;
  autoCollapseEmpty?: boolean;
  collapsible?: boolean;
  width?: string;
  badge?: ReactNode;
  children: ReactNode;
  "data-budget-details-panel"?: boolean;
};

export function PendingPanelFrame({ title, displayTitle = title, count, errors = 0, autoCollapseEmpty = false, collapsible = true, width = "w-90", badge, children, "data-budget-details-panel": budgetDetailsPanel }: Props) {
  const { minimized, setMinimized, forceExpanded, collapseSignal } = usePendingPanel();
  const [openedEmpty, setOpenedEmpty] = useState(false);
  // The Save button lives in this panel, so pressing it counts as "opened". After a save that leaves nothing pending, tuck the panel away.
  const [seenSignal, setSeenSignal] = useState(collapseSignal);
  if (seenSignal !== collapseSignal) { setSeenSignal(collapseSignal); if (count === 0 && errors === 0) setOpenedEmpty(false); }
  const collapsed = collapsible && !forceExpanded && (minimized || (autoCollapseEmpty && count === 0 && errors === 0 && !openedEmpty));
  const panelRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusRequested = useRef(false);
  useLayoutEffect(() => {
    if (focusRequested.current) {
      toggleRef.current?.focus();
      focusRequested.current = false;
    }
  }, [collapsed]);

  useEffect(() => {
    const panel = panelRef.current;
    // Portal controls belong to TopBar in React's tree. Observe native DOM focus
    // so clearing the last draft does not remove the panel from under its controls.
    const preserveHeader = () => {
      if (panel?.getAttribute("data-panel-minimized") !== "true") setOpenedEmpty(true);
    };
    panel?.addEventListener("focus", preserveHeader, true);
    return () => panel?.removeEventListener("focus", preserveHeader, true);
  }, []);

  return (
    <aside
      ref={panelRef}
      data-panel-minimized={collapsed}
      data-budget-details-panel={budgetDetailsPanel || undefined}
      aria-label={collapsed ? `${title} minimized` : title}
      className={cn("flex min-h-0 shrink-0 flex-col border-l border-border bg-background", collapsed ? "w-10" : width)}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 pt-2">
          <Button ref={toggleRef} variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={`Show ${title.toLowerCase()}`} aria-expanded={false}
            title={`Show ${title.toLowerCase()}${count ? ` (${count} pending)` : ""}`}
            onClick={() => { focusRequested.current = true; setOpenedEmpty(true); setMinimized(false); }}>
            <Layers className="h-4 w-4" strokeWidth={1.5} />
          </Button>
          {(count > 0 || errors > 0) && <span className={cn("rounded border px-1 text-[10px] tabular-nums", errors ? "border-destructive/40 text-destructive" : "border-amber-300 text-amber-600 dark:text-amber-400")} aria-label={errors ? `${errors} save error${errors === 1 ? "" : "s"}` : `${count} pending change${count === 1 ? "" : "s"}`}>{errors ? "!" : count}</span>}
        </div>
      ) : (
        <div data-pending-panel-header className="flex h-[45px] shrink-0 items-center gap-1 border-b border-border px-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 aria-label={title} title={title} className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{displayTitle}</h2>
            {badge ?? ((count > 0 || errors > 0) && (
              <Badge variant={errors ? "destructive" : "outline"}
                className={cn("h-5 shrink-0 px-1.5 text-[10px] tabular-nums", !errors && "border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400")}
                title={errors ? `${errors} save errors` : `${count} pending changes`}
                aria-label={errors ? `${errors} save error${errors === 1 ? "" : "s"}` : `${count} pending change${count === 1 ? "" : "s"}`}>
                {errors ? `! ${errors}` : count}
              </Badge>
            ))}
          </div>
          <PendingActionsSlot />
          {collapsible && (
            <div className="ml-0.5 shrink-0 border-l border-border pl-0.5">
              <Button ref={toggleRef} variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" aria-label={`Minimize ${title.toLowerCase()}`} aria-expanded={true}
                disabled={forceExpanded} title={forceExpanded ? "Resolve pending changes before minimizing" : "Minimize panel"}
                onClick={() => { focusRequested.current = true; setOpenedEmpty(false); setMinimized(true); }}>
                <Layers className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </div>
          )}
        </div>
      )}
      <div hidden={collapsed} className={cn("min-h-0 flex-1 flex-col", collapsed ? "hidden" : "flex")}>
        {children}
      </div>
    </aside>
  );
}
