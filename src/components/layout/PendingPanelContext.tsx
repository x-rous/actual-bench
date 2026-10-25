"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const STORAGE_KEY = "pending-panel-minimized";
type PanelContext = {
  actionsTarget: HTMLDivElement | null;
  setActionsTarget: (target: HTMLDivElement | null) => void;
  minimized: boolean;
  forceExpanded: boolean;
  setMinimized: (value: boolean) => void;
  /** Increments after a successful save, so an emptied panel can tuck itself away. */
  collapseSignal: number;
  requestCollapse: () => void;
};
const Context = createContext<PanelContext | null>(null);

/** Shell-wide UI preference only; never persists financial drafts. */
export function PendingPanelProvider({ children, forceExpanded = false }: { children: ReactNode; forceExpanded?: boolean }) {
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  const [collapseSignal, setCollapseSignal] = useState(0);
  const [minimized, updateMinimized] = useState(() => {
    try { return typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1"; }
    catch { return false; }
  });
  function setMinimized(value: boolean) {
    updateMinimized(value);
    try { localStorage.setItem(STORAGE_KEY, value ? "1" : "0"); }
    catch { /* The in-memory preference still works when storage is unavailable. */ }
  }
  return <Context value={{ actionsTarget, setActionsTarget, minimized, setMinimized, forceExpanded, collapseSignal, requestCollapse: () => setCollapseSignal((n) => n + 1) }}>{children}</Context>;
}

export function usePendingPanel() {
  const value = useContext(Context);
  if (!value) throw new Error("Pending panel controls require PendingPanelProvider");
  return value;
}

/** Host existing staged-action handlers without mounting another save pipeline. */
export function PendingActionsSlot() {
  const { setActionsTarget } = usePendingPanel();
  return <div ref={setActionsTarget} role="group" aria-label="Pending change actions" className="ml-auto flex shrink-0 items-center justify-end gap-0.5 empty:hidden" />;
}
