"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { BlockReason } from "@/lib/financial-models/loan/model";
import type { DebtProjection, DebtProjectionInput } from "@/lib/financial-models/loan/projection";
import { createDefaultRunner, SupersededError, type ProjectionRunner } from "./projectionRunner";
import { missingInputs, projectionWindow, simulationToModel, type SimulationState } from "./simulatorModel";
import { mergeOffsetHistories, type OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";

/**
 * Live results for the simulator (P1.3b T203; FR-218).
 *
 * Every calculation-affecting change recalculates after a short debounce
 * (typing only: it does not hide the engine's cost, which runs off the main
 * thread). The previous results stay visible, marked as calculating, until
 * the new ones arrive. Nothing is saved and nothing reaches Actual.
 */

export const ProjectionRunnerContext = createContext<ProjectionRunner | null>(null);

export type LiveProjection = {
  status: "incomplete" | "calculating" | "ok" | "blocked" | "error";
  projection: DebtProjection | null;
  comparison: DebtProjection | null;
  impactBaseline: DebtProjection | null;
  /** The inputs still needed before anything can be calculated. */
  missing: string[];
  /** Why the engine could not calculate (Blocked reasons), or an error. */
  problems: string[];
  /** The engine's own block reasons, with their codes and dates. */
  blocked: BlockReason[];
  durationMs: number | null;
};

function inputFor(sim: SimulationState, histories?: readonly OffsetHistorySnapshot[]): DebtProjectionInput | null {
  const built = simulationToModel(sim);
  if (!built.ok) return null;
  const merged = histories ? mergeOffsetHistories(built.model, histories) : { model: built.model, events: [] };
  const { model } = merged;
  const window = projectionWindow(sim);
  return { model, anchor: { date: model.terms.openingDate, principalMinor: model.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" }, events: merged.events, from: window.from, to: window.to };
}

export function useLiveProjection(sim: SimulationState, options: { compareWith?: SimulationState | null; impactBaseline?: SimulationState | null; offsetHistories?: readonly OffsetHistorySnapshot[]; suspend?: boolean; externalProblems?: string[]; debounceMs?: number } = {}): LiveProjection {
  const injected = useContext(ProjectionRunnerContext);
  const own = useRef<ProjectionRunner | null>(null);
  const debounceMs = options.debounceMs ?? 200;
  const primary = useMemo(() => inputFor(sim, options.offsetHistories), [sim, options.offsetHistories]);
  const comparison = useMemo(() => (options.compareWith ? inputFor(options.compareWith, options.offsetHistories) : null), [options.compareWith, options.offsetHistories]);
  const impactBaseline = useMemo(() => (options.impactBaseline ? inputFor(options.impactBaseline, options.offsetHistories) : null), [options.impactBaseline, options.offsetHistories]);
  const missing = useMemo(() => missingInputs(sim), [sim]);
  /** The last settled result, with the inputs it answers. Status is derived from it during render. */
  const [settled, setSettled] = useState<{ primary: DebtProjectionInput; comparison: DebtProjectionInput | null; impactBaseline: DebtProjectionInput | null; result: Omit<LiveProjection, "missing" | "status"> & { status: "ok" | "blocked" | "error" } } | null>(null);

  useEffect(() => {
    if (injected) return;
    own.current = createDefaultRunner();
    return () => own.current?.dispose();
  }, [injected]);

  useEffect(() => {
    if (!primary || options.suspend || options.externalProblems?.length) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const runner = injected ?? own.current;
      if (!runner) return;
      runner
        .run(primary, comparison, impactBaseline)
        .then((outcome) => {
          if (cancelled) return;
          if (process.env.NODE_ENV === "development") console.debug(`[assets-debt] projection ${outcome.durationMs.toFixed(0)} ms`);
          const blocked = outcome.projection.ok ? [] : outcome.projection.blocked;
          setSettled({ primary, comparison, impactBaseline, result: { status: blocked.length ? "blocked" : "ok", projection: outcome.projection, comparison: outcome.comparison, impactBaseline: outcome.impactBaseline, problems: blocked.map((b) => b.message), blocked, durationMs: outcome.durationMs } });
        })
        .catch((error: unknown) => {
          if (cancelled || error instanceof SupersededError) return;
          setSettled((s) => ({ primary, comparison, impactBaseline, result: { ...(s?.result ?? { projection: null, comparison: null, impactBaseline: null, durationMs: null }), status: "error", problems: [error instanceof Error ? error.message : String(error)], blocked: [] } }));
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [primary, comparison, impactBaseline, injected, debounceMs, options.suspend, options.externalProblems]);

  if (options.externalProblems?.length) return { status: "blocked", projection: null, comparison: null, impactBaseline: null, problems: options.externalProblems, blocked: [], durationMs: null, missing };
  if (options.suspend) return { status: "calculating", projection: null, comparison: null, impactBaseline: null, problems: [], blocked: [], durationMs: null, missing };
  if (!primary) return { status: "incomplete", projection: null, comparison: null, impactBaseline: null, problems: [], blocked: [], durationMs: null, missing };
  // Until the current inputs settle, the previous results stay on screen, marked as calculating.
  if (!settled || settled.primary !== primary || settled.comparison !== comparison || settled.impactBaseline !== impactBaseline) {
    return { ...(settled?.result ?? { projection: null, comparison: null, impactBaseline: null, problems: [], blocked: [], durationMs: null }), status: "calculating", missing };
  }
  return { ...settled.result, missing };
}
