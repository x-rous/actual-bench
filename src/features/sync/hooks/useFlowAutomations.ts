"use client";

import { useQuery } from "@tanstack/react-query";
import { listAutomations } from "@/features/automations/lib/automationsApi";
import type { EnginePause } from "../lib/unattendedStatus";

/**
 * The automation behind each unattended flow, keyed by flow id.
 *
 * An unattended flow does not run itself: it runs because the automation engine
 * runs it, and the engine can health-pause that automation after repeated
 * failures. Nothing writes that pause back onto the flow, so without reading it
 * here the Sync page showed a paused flow as armed and healthy, with a next-run
 * time for a run that was never going to happen.
 *
 * Reading rather than mirroring keeps one source of truth. The engine owns
 * server-side pausing; this is the Sync page looking at it.
 */
export function useFlowAutomations(): Map<string, EnginePause | null> {
  const query = useQuery({
    queryKey: ["sync-flow-automations"],
    queryFn: listAutomations,
    // The engine pauses between ticks, so this only has to be roughly current.
    refetchInterval: 60_000,
  });

  const byFlowId = new Map<string, EnginePause | null>();
  for (const automation of query.data?.automations ?? []) {
    if (automation.type !== "budget-file-sync") continue;
    const flowId = automation.config?.data?.flowId;
    if (typeof flowId !== "string") continue;
    byFlowId.set(flowId, automation.autoPausedAt ? { reason: automation.autoPauseReason } : null);
  }
  return byFlowId;
}
