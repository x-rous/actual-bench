"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DAMAGED_COPY_EVENT } from "@/lib/actual/browser/runtime";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";

/**
 * Keeps this browser's copy of a Direct budget safe (owner decision 2026-10-07). In Direct mode the
 * budget lives in the browser; two Bench tabs writing to it at once can damage it. Tabs announce the
 * budget they have open to each other, and a second tab on the same budget is warned. When Actual
 * reports the copy damaged anyway, one click reloads the page, which downloads a fresh copy from the
 * server (the server's data is never affected).
 */

type Message = { type: "open" | "here" | "closed"; budget: string; tab: string };
const CHANNEL = "actual-bench:direct-budget-tabs";

export function BudgetCopyBanner() {
  const connection = useConnectionStore(selectActiveInstance);
  const budget = connection?.mode === "browser-api" ? connection.budgetSyncId ?? null : null;
  const [otherTab, setOtherTab] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [damaged, setDamaged] = useState(false);

  useEffect(() => {
    const onDamaged = () => setDamaged(true);
    window.addEventListener(DAMAGED_COPY_EVENT, onDamaged);
    return () => window.removeEventListener(DAMAGED_COPY_EVENT, onDamaged);
  }, []);

  useEffect(() => {
    if (!budget || typeof BroadcastChannel === "undefined") return;
    const tab = Math.random().toString(36).slice(2);
    const channel = new BroadcastChannel(CHANNEL);
    const send = (type: Message["type"]) => channel.postMessage({ type, budget, tab } satisfies Message);
    channel.onmessage = (event: MessageEvent<Message>) => {
      const m = event.data;
      if (!m || m.budget !== budget || m.tab === tab) return;
      if (m.type === "open") { setOtherTab(true); send("here"); }
      if (m.type === "here") setOtherTab(true);
      if (m.type === "closed") setOtherTab(false);
    };
    send("open");
    const onLeave = () => send("closed");
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      send("closed");
      channel.close();
      setOtherTab(false);
    };
  }, [budget]);

  if (damaged) {
    return (
      <div role="alert" className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>This browser&apos;s copy of the budget is damaged. Reload it from the server; your budget on the server is not affected. Close other Actual Bench tabs on this budget first.</span>
        <Button variant="outline" size="xs" className="ml-auto" onClick={() => window.location.reload()}>Reload from the server</Button>
      </div>
    );
  }
  if (!otherTab || dismissed) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>This budget is also open in another Actual Bench tab. Using both at once can damage this browser&apos;s copy of it; close one of them.</span>
      <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setDismissed(true)}>Dismiss</Button>
    </div>
  );
}
