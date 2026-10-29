"use client";

import { addDays } from "@/lib/financial-models/calendar/dates";
import { explainBlocks } from "@/lib/financial-models/loan/blockMessages";
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
  /** A tracked loan: the contract from its opening, for the time before the tracking start and the impact of what happened. */
  contract: DebtProjection | null;
  /** The inputs still needed before anything can be calculated. */
  missing: string[];
  /** Why the engine could not calculate (Blocked reasons), or an error. */
  problems: string[];
  /** The engine's own block reasons, with their codes and dates. */
  blocked: BlockReason[];
  durationMs: number | null;
};

/** A loan tracked in Actual: its calculation restarts from what really happened (design spec 06 §5.7). */
export type TrackedProjection = {
  startDate: string;
  /** `restartDate` (default `date`) is where the engine restarts when an early payment already covers the next due date; `accruedInterestMinor` is the interest accrued up to it. */
  anchor: { date: string; principalMinor: number; scheduledPaymentMinor: number; restartDate?: string; accruedInterestMinor?: number };
};

/**
 * One projection's input. A tracked loan's projection starts at its anchor (the last thing that really happened) with
 * only the events after it; its contract runs from the opening with only the events before the tracking start.
 */
export function inputFor(sim: SimulationState, histories?: readonly OffsetHistorySnapshot[], tracked?: { mode: "projection" | "contract"; at: TrackedProjection } | null): DebtProjectionInput | null {
  const restartDate = tracked?.at.anchor.restartDate ?? tracked?.at.anchor.date;
  const scoped = !tracked ? sim : { ...sim, assumptions: sim.assumptions
    .filter((a) => (tracked.mode === "contract" ? a.effectiveFrom < tracked.at.startDate : a.effectiveFrom > tracked.at.anchor.date))
    // The engine ignores anything dated up to its restart; a what-if in that gap counts from the next day instead of vanishing.
    .map((a) => (tracked.mode === "projection" && restartDate && a.effectiveFrom <= restartDate ? { ...a, effectiveFrom: addDays(restartDate, 1) } : a)) };
  const built = simulationToModel(scoped);
  if (!built.ok) return null;
  const merged = histories ? mergeOffsetHistories(built.model, histories) : { model: built.model, events: [] };
  const { model } = merged;
  const window = projectionWindow(sim);
  if (tracked?.mode === "projection") {
    const { anchor } = tracked.at;
    const restart = anchor.restartDate ?? anchor.date;
    return { model, anchor: { date: restart, principalMinor: anchor.principalMinor, accruedInterestMinor: anchor.accruedInterestMinor ?? 0, scheduledPaymentMinor: anchor.scheduledPaymentMinor, source: "tracked" }, events: merged.events.filter((e) => e.date > restart), from: restart, to: window.to };
  }
  return { model, anchor: { date: model.terms.openingDate, principalMinor: model.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" }, events: merged.events, from: window.from, to: window.to };
}

export function useLiveProjection(sim: SimulationState, options: { compareWith?: SimulationState | null; impactBaseline?: SimulationState | null; offsetHistories?: readonly OffsetHistorySnapshot[]; suspend?: boolean; externalProblems?: string[]; debounceMs?: number; tracked?: TrackedProjection | null } = {}): LiveProjection {
  const injected = useContext(ProjectionRunnerContext);
  const own = useRef<ProjectionRunner | null>(null);
  const debounceMs = options.debounceMs ?? 200;
  const tracked = options.tracked ?? null;
  const primary = useMemo(() => inputFor(sim, options.offsetHistories, tracked && { mode: "projection", at: tracked }), [sim, options.offsetHistories, tracked]);
  const comparison = useMemo(() => (options.compareWith ? inputFor(options.compareWith, options.offsetHistories) : null), [options.compareWith, options.offsetHistories]);
  const impactBaseline = useMemo(() => (options.impactBaseline ? inputFor(options.impactBaseline, options.offsetHistories, tracked && { mode: "projection", at: tracked }) : null), [options.impactBaseline, options.offsetHistories, tracked]);
  const contract = useMemo(() => (tracked ? inputFor(sim, options.offsetHistories, { mode: "contract", at: tracked }) : null), [sim, options.offsetHistories, tracked]);
  const missing = useMemo(() => missingInputs(sim), [sim]);
  /** The last settled result, with the inputs it answers. Status is derived from it during render. */
  const [settled, setSettled] = useState<{ primary: DebtProjectionInput; comparison: DebtProjectionInput | null; impactBaseline: DebtProjectionInput | null; contract: DebtProjectionInput | null; result: Omit<LiveProjection, "missing" | "status"> & { status: "ok" | "blocked" | "error" } } | null>(null);

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
        .run(primary, comparison, impactBaseline, contract)
        .then((outcome) => {
          if (cancelled) return;
          if (process.env.NODE_ENV === "development") console.debug(`[assets-debt] projection ${outcome.durationMs.toFixed(0)} ms`);
          // A blocked contract has no results to show, so its reasons are surfaced even when the projection itself is fine.
          const blocked = outcome.projection.ok ? (outcome.contract && !outcome.contract.ok ? outcome.contract.blocked : []) : outcome.projection.blocked;
          setSettled({ primary, comparison, impactBaseline, contract, result: { status: blocked.length ? "blocked" : "ok", projection: outcome.projection, comparison: outcome.comparison, impactBaseline: outcome.impactBaseline, contract: outcome.contract ?? null, problems: explainBlocks(blocked).texts, blocked, durationMs: outcome.durationMs } });
        })
        .catch((error: unknown) => {
          if (cancelled || error instanceof SupersededError) return;
          setSettled((s) => ({ primary, comparison, impactBaseline, contract, result: { ...(s?.result ?? { projection: null, comparison: null, impactBaseline: null, contract: null, durationMs: null }), status: "error", problems: [error instanceof Error ? error.message : String(error)], blocked: [] } }));
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [primary, comparison, impactBaseline, contract, injected, debounceMs, options.suspend, options.externalProblems]);

  if (options.externalProblems?.length) return { status: "blocked", projection: null, comparison: null, impactBaseline: null, contract: null, problems: options.externalProblems, blocked: [], durationMs: null, missing };
  if (options.suspend) return { status: "calculating", projection: null, comparison: null, impactBaseline: null, contract: null, problems: [], blocked: [], durationMs: null, missing };
  if (!primary) return { status: "incomplete", projection: null, comparison: null, impactBaseline: null, contract: null, problems: [], blocked: [], durationMs: null, missing };
  // Until the current inputs settle, the previous results stay on screen, marked as calculating.
  if (!settled || settled.primary !== primary || settled.comparison !== comparison || settled.impactBaseline !== impactBaseline || settled.contract !== contract) {
    return { ...(settled?.result ?? { projection: null, comparison: null, impactBaseline: null, contract: null, problems: [], blocked: [], durationMs: null }), status: "calculating", missing };
  }
  return { ...settled.result, missing };
}
