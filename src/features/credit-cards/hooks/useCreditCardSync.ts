"use client";
import { useEffect } from "react";
import { creditCardStore } from "../lib/store/store";
import { CHANGE_CHANNEL } from "../lib/store/persistence";

/**
 * Keeps this tab's credit-card records current: re-reads them when another tab of this browser saves
 * a change, and when the tab becomes visible again (another device may have saved meanwhile). The
 * store holds committed records only, so a re-read never discards an open editor's draft.
 */
export function useCreditCardSync(budget: string) {
  useEffect(() => {
    const reload = () => {
      if (creditCardStore.getState().status[budget]?.state === "ready") void creditCardStore.getState().load(budget, true);
    };
    const visible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", visible);
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANGE_CHANNEL);
      channel.onmessage = (event: MessageEvent<{ budgetSyncId?: string }>) => {
        if (event.data?.budgetSyncId === budget) reload();
      };
    }
    return () => {
      document.removeEventListener("visibilitychange", visible);
      channel?.close();
    };
  }, [budget]);
}
