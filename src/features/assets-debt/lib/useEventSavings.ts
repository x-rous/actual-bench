"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DebtProjectionInput } from "@/lib/financial-models/loan/projection";
import type { OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import { ledgerChain, savingBetween, whatIfChain, chainOf, type LedgerEvent, type Saving } from "./eventSavings";
import { createDefaultRunner, SupersededError, type ProjectionRunner } from "./projectionRunner";
import { headline, type Headline } from "./results";
import type { SimulationState } from "./simulatorModel";
import { inputFor, ProjectionRunnerContext, type TrackedProjection } from "./useLiveProjection";

/**
 * Runs the savings chains (`eventSavings.ts`) after the main results settle, on a worker of its own so they never
 * delay the main calculation. One extra run per event, except the last what-if, whose result is the main projection.
 */

export type EventSavings = {
  status: "none" | "calculating" | "ok";
  /** By event key: an assumption's key, or `ledger:<rowId>` for a Loan Ledger row. Null: could not be worked out. */
  byKey: ReadonlyMap<string, Saving | null>;
  /** The contract with everything that really happened (the From Actual total's "after"), on a tracked loan. */
  fromActualAfter: Headline | null;
};

type Chains = {
  whatIf: { keys: string[]; inputs: (DebtProjectionInput | null)[] };
  ledger: { keys: string[]; inputs: (DebtProjectionInput | null)[] };
};

const EMPTY: ReadonlyMap<string, Saving | null> = new Map();

export function useEventSavings(sim: SimulationState, options: {
  /** The main results: without what-ifs, with them, and (tracked) the contract. Null until settled. */
  baseline: Headline | null; current: Headline | null; contract: Headline | null; ready: boolean;
  tracked: (TrackedProjection & { ledgerEvents: readonly LedgerEvent[] }) | null;
  histories?: readonly OffsetHistorySnapshot[];
}): EventSavings {
  const { tracked, histories, baseline, current, contract, ready } = options;
  const injected = useContext(ProjectionRunnerContext);
  const own = useRef<ProjectionRunner | null>(null);
  const at = useMemo(() => (tracked ? { startDate: tracked.startDate, anchor: tracked.anchor } : null), [tracked]);
  const chains = useMemo((): Chains => {
    const w = whatIfChain(sim, at?.anchor.date ?? null);
    // The last what-if's "after" is the main projection, so its chain step is not run again.
    const whatIf = { keys: w.events.map((e) => e.key), inputs: chainOf(w.base, w.events).slice(0, -1).map((s) => inputFor(s, histories, at && { mode: "projection", at })) };
    if (!tracked) return { whatIf, ledger: { keys: [], inputs: [] } };
    const l = ledgerChain(sim, tracked.startDate, tracked.ledgerEvents);
    return { whatIf, ledger: { keys: l.events.map((e) => `ledger:${e.rowId}`), inputs: chainOf(l.base, l.events).map((s) => inputFor(s, histories)) } };
  }, [sim, histories, at, tracked]);
  const [settled, setSettled] = useState<{ for: unknown[]; byKey: Map<string, Saving | null>; fromActualAfter: Headline | null } | null>(null);
  const deps = useMemo(() => [chains, baseline, current, contract], [chains, baseline, current, contract]);
  const none = chains.whatIf.keys.length === 0 && chains.ledger.keys.length === 0;

  useEffect(() => {
    if (injected) return;
    own.current = createDefaultRunner();
    return () => own.current?.dispose();
  }, [injected]);

  useEffect(() => {
    if (!ready || none || !baseline || !current || (tracked && !contract)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const runner = injected ?? own.current;
      if (!runner) return;
      const run = async (inputs: (DebtProjectionInput | null)[]) => {
        const out: (Headline | null)[] = [];
        for (const input of inputs) {
          if (cancelled) return null;
          if (!input) { out.push(null); continue; }
          const result = await runner.run(input, null);
          out.push(result.projection.ok ? headline(result.projection.events) : null);
        }
        return out;
      };
      try {
        const w = await run(chains.whatIf.inputs);
        const l = await run(chains.ledger.inputs);
        if (cancelled || !w || !l) return;
        const byKey = new Map<string, Saving | null>();
        const whatIfHeads = [baseline, ...w, current];
        chains.whatIf.keys.forEach((key, k) => { const a = whatIfHeads[k], b = whatIfHeads[k + 1]; byKey.set(key, a && b ? savingBetween(a, b) : null); });
        const ledgerHeads = [contract, ...l];
        chains.ledger.keys.forEach((key, k) => { const a = ledgerHeads[k], b = ledgerHeads[k + 1]; byKey.set(key, a && b ? savingBetween(a, b) : null); });
        setSettled({ for: deps, byKey, fromActualAfter: chains.ledger.keys.length ? l.at(-1) ?? null : null });
      } catch (error) {
        if (!(error instanceof SupersededError) && !cancelled) setSettled({ for: deps, byKey: new Map(), fromActualAfter: null });
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ready, none, baseline, current, contract, tracked, chains, deps, injected]);

  if (none) return { status: "none", byKey: EMPTY, fromActualAfter: null };
  if (!settled || settled.for !== deps) return { status: "calculating", byKey: EMPTY, fromActualAfter: null };
  return { status: "ok", byKey: settled.byKey, fromActualAfter: settled.fromActualAfter };
}
