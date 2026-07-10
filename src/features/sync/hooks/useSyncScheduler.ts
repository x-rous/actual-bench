"use client";

import { useEffect, useRef } from "react";
import { decodeFlowPlanConfig } from "@/lib/sync/flowConfig";
import { runClientSafeSync } from "../lib/clientOrchestration";
import { flowToFormState } from "../lib/flowForm";
import {
  classifySafeSyncOutcome,
  nextConsecutiveFailures,
  shouldPauseForHealth,
} from "../lib/flowHealth";
import { selectFlowsToAutoRun, type SchedulableFlow } from "../lib/scheduler";
import type { ConnectionInstance } from "@/store/connection";
import type { SyncFlow, SyncFlowRun } from "@/lib/app-db/types";
import type { SafeSyncResult } from "@/lib/sync/safeSyncOrchestrator";

/**
 * Client-side interval auto-sync (RD-054 / PR-020 Slice 4). Runs a safe-only sync
 * for `auto_sync_on_interval` flows **while this tab is open and their
 * connections are unlocked**. All the actual gating lives in the pure
 * `selectFlowsToAutoRun`; this hook is just the timer + non-overlap bookkeeping.
 *
 * Not a background daemon - nothing runs when the app is closed (that is RD-058).
 */

const TICK_MS = 60_000;
const INITIAL_DELAY_MS = 3_000;

function runTimeMs(run: SyncFlowRun | undefined): number | null {
  if (!run) return null;
  const ms = new Date(run.finishedAt ?? run.startedAt).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function useSyncScheduler(params: {
  flows: SyncFlow[];
  connections: ConnectionInstance[];
  latestRuns: Map<string, SyncFlowRun>;
  /** Master switch (default on); the per-flow opt-in is the review policy. */
  enabled?: boolean;
  onRunComplete?: (flowId: string, result: SafeSyncResult) => void;
  /** Persist a health pause after repeated automated failures (RD-054). */
  onFlowPaused?: (flowId: string) => void;
}) {
  const { enabled = true } = params;
  const inFlightRef = useRef<Set<string>>(new Set());
  const lastRunRef = useRef<Map<string, number>>(new Map());
  const failuresRef = useRef<Map<string, number>>(new Map());
  // Flows paused this session - a local guard so a slow enabled=false persist
  // can't let one more auto run slip through before the DB reflects the pause.
  const pausedRef = useRef<Set<string>>(new Set());

  // Latest inputs, read inside the timer without resetting it each render.
  const stateRef = useRef(params);
  useEffect(() => {
    stateRef.current = params;
  });

  useEffect(() => {
    if (!enabled) return;

    function tick() {
      const { flows, connections, latestRuns, onRunComplete, onFlowPaused } = stateRef.current;
      const resolved = new Map<string, { source: ConnectionInstance; target: ConnectionInstance }>();

      const schedulable: SchedulableFlow[] = flows.map((flow) => {
        const config = decodeFlowPlanConfig(flow);
        // A re-enabled flow clears its local pause guard and failure streak.
        if (flow.enabled && !config.autoPausedAt) {
          pausedRef.current.delete(flow.id);
          failuresRef.current.delete(flow.id);
        }
        const form = flowToFormState(flow, connections);
        const source = connections.find((c) => c.id === form.source.connectionId);
        const target = connections.find((c) => c.id === form.target.connectionId);
        let connectionsReady = false;
        if (source && target) {
          connectionsReady = true;
          resolved.set(flow.id, { source, target });
        }
        return {
          flowId: flow.id,
          reviewPolicy: config.reviewPolicy,
          // A flow paused for health is treated as disabled until re-enabled.
          enabled: flow.enabled && !pausedRef.current.has(flow.id),
          intervalMinutes: config.intervalMinutes,
          connectionsReady,
          lastRunAtMs: lastRunRef.current.get(flow.id) ?? runTimeMs(latestRuns.get(flow.id)),
        };
      });

      const due = selectFlowsToAutoRun({ flows: schedulable, inFlight: inFlightRef.current, nowMs: Date.now() });
      for (const flowId of due) {
        const conns = resolved.get(flowId);
        if (!conns) continue;
        // Mark started immediately so the next tick can't double-fire, and so a
        // fast-failing run still waits a full interval before retrying.
        inFlightRef.current.add(flowId);
        lastRunRef.current.set(flowId, Date.now());
        runClientSafeSync({ flowId, sourceConnection: conns.source, targetConnection: conns.target })
          .then((result) => {
            recordHealth(flowId, result.status, onFlowPaused);
            onRunComplete?.(flowId, result);
          })
          .catch(() => {
            // A thrown run counts as a failure for health purposes.
            recordHealth(flowId, "failed", onFlowPaused);
          })
          .finally(() => {
            inFlightRef.current.delete(flowId);
          });
      }
    }

    // Update the failure streak for a completed auto run; pause the flow once it
    // crosses the threshold, then reset the streak so a re-enable starts clean.
    function recordHealth(
      flowId: string,
      status: SafeSyncResult["status"],
      onFlowPaused?: (flowId: string) => void
    ) {
      const outcome = classifySafeSyncOutcome(status);
      const count = nextConsecutiveFailures(failuresRef.current.get(flowId) ?? 0, outcome);
      if (shouldPauseForHealth(count)) {
        failuresRef.current.set(flowId, 0);
        pausedRef.current.add(flowId);
        onFlowPaused?.(flowId);
      } else {
        failuresRef.current.set(flowId, count);
      }
    }

    const interval = setInterval(tick, TICK_MS);
    const initial = setTimeout(tick, INITIAL_DELAY_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(initial);
    };
  }, [enabled]);
}
