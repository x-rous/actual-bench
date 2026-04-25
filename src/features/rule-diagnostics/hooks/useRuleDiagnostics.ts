"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { useStagedStore } from "@/store/staged";
import { useConnectionStore } from "@/store/connection";
import type { Rule, Payee, Category, Account, CategoryGroup, Schedule } from "@/types/entities";
import type { StagedMap } from "@/types/staged";
import type { EntityMaps } from "@/features/rules/utils/rulePreview";
import type { DiagnosticReport, WorkingSet } from "../types";
import { runDiagnostics } from "../lib/runDiagnostics";
import { workingSetSignature } from "../lib/ruleSignature";

// Ensure all checks are registered before the engine runs.
import "../lib/checks/register";

/**
 * Build a WorkingSet from the current staged-store snapshot.
 * Staged deletions are excluded, staged updates are reflected in their
 * new form, and staged-new rows are included.
 */
export function buildWorkingSet(
  stagedRules: StagedMap<Rule>,
  entityMaps: EntityMaps
): WorkingSet {
  const rules: Rule[] = [];
  for (const entry of Object.values(stagedRules)) {
    if (!entry.isDeleted) rules.push(entry.entity);
  }

  const entityExists = {
    payees: new Set<string>(),
    categories: new Set<string>(),
    accounts: new Set<string>(),
    categoryGroups: new Set<string>(),
  };
  for (const [id, e] of Object.entries(entityMaps.payees)) {
    if (!e.isDeleted) entityExists.payees.add(id);
  }
  for (const [id, e] of Object.entries(entityMaps.categories)) {
    if (!e.isDeleted) entityExists.categories.add(id);
  }
  for (const [id, e] of Object.entries(entityMaps.accounts)) {
    if (!e.isDeleted) entityExists.accounts.add(id);
  }
  for (const [id, e] of Object.entries(entityMaps.categoryGroups)) {
    if (!e.isDeleted) entityExists.categoryGroups.add(id);
  }

  return { rules, entityMaps, entityExists };
}

export type UseRuleDiagnosticsResult = {
  report: DiagnosticReport | null;
  running: boolean;
  error: string | null;
  stale: boolean;
  refresh: () => void;
};

function selectEntityMaps(state: {
  payees: StagedMap<Payee>;
  categories: StagedMap<Category>;
  accounts: StagedMap<Account>;
  categoryGroups: StagedMap<CategoryGroup>;
  schedules: StagedMap<Schedule>;
}): EntityMaps {
  return {
    payees: state.payees,
    categories: state.categories,
    accounts: state.accounts,
    categoryGroups: state.categoryGroups,
    schedules: state.schedules,
  };
}

export function useRuleDiagnostics(): UseRuleDiagnosticsResult {
  const stagedRules = useStagedStore((s) => s.rules);
  // Subscribe to entity maps so that staged-entity changes drive re-renders
  // (the engine reads via getState() at run time, but the React layer needs
  // these subscriptions to know when to re-evaluate the stale signature).
  useStagedStore((s) => s.payees);
  useStagedStore((s) => s.categories);
  useStagedStore((s) => s.accounts);
  useStagedStore((s) => s.categoryGroups);
  useStagedStore((s) => s.schedules);
  const activeConnectionId = useConnectionStore((s) => s.activeInstanceId);
  // Number of in-flight queries for the entity types the engine consumes.
  // Drops to 0 once the new connection's rules (and related entities) have
  // finished loading — that's our cue to re-run after a connection switch.
  const isLoadingEntities = useIsFetching({
    predicate: (q) => {
      const key = q.queryKey[0];
      return (
        key === "rules" ||
        key === "payees" ||
        key === "categories" ||
        key === "accounts" ||
        key === "categoryGroups" ||
        key === "schedules"
      );
    },
  }) > 0;

  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runToken, setRunToken] = useState(0);

  const cancelledRef = useRef(false);
  const previousConnectionIdRef = useRef(activeConnectionId);
  // True between "connection switched" and "engine ran for the new connection".
  // The post-switch watcher waits for the rules query to settle before refreshing.
  const awaitingPostSwitchRefreshRef = useRef(false);

  // Effect 1: detect a connection switch.
  // When the connection changes we clear the current report and put the view
  // into the loading state immediately, then arm Effect 2 to refresh the
  // engine once the new connection's entity queries have finished loading.
  useEffect(() => {
    if (previousConnectionIdRef.current !== activeConnectionId) {
      previousConnectionIdRef.current = activeConnectionId;
      awaitingPostSwitchRefreshRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReport(null);
      setRunning(true);
      setError(null);
    }
  }, [activeConnectionId]);

  // Effect 2: when the new connection's entity queries finish loading after a
  // switch, bump runToken so the engine re-runs against the now-fresh staged
  // store. We gate on the queries (not on staged-rules reference changes)
  // because `discardAll()` clears staged data BEFORE the new data arrives —
  // reacting to the first reference change runs the engine against an empty
  // staged store and leaves the report stuck on the empty signature.
  useEffect(() => {
    if (!awaitingPostSwitchRefreshRef.current) return;
    if (isLoadingEntities) return;
    awaitingPostSwitchRefreshRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunToken((t) => t + 1);
  }, [isLoadingEntities]);

  // Current working-set signature is recomputed every render and compared
  // against the report's signature to drive the stale banner.
  const currentRules: Rule[] = [];
  for (const entry of Object.values(stagedRules)) {
    if (!entry.isDeleted) currentRules.push(entry.entity);
  }
  const currentSignature = workingSetSignature(currentRules);
  const stale = report !== null && report.workingSetSignature !== currentSignature;

  useEffect(() => {
    cancelledRef.current = false;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunning(true);
    setError(null);

    // Read fresh state at run time so we pick up any staged-store updates
    // that happened between runToken bump and now (e.g. a deferred refresh
    // after a connection switch).
    const state = useStagedStore.getState();
    const ws = buildWorkingSet(state.rules, selectEntityMaps(state));
    runDiagnostics(ws)
      .then((r) => {
        if (cancelled || cancelledRef.current) return;
        setReport(r);
      })
      .catch((err: unknown) => {
        if (cancelled || cancelledRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled || cancelledRef.current) return;
        setRunning(false);
      });

    return () => {
      cancelled = true;
    };
    // Intentionally run only on mount and on explicit refresh (or
    // deferred refresh after a connection switch via Effect 2) — not on
    // every staged-store change. Staleness is surfaced via the `stale`
    // flag so the UI can prompt the user instead of silently recomputing
    // (Clarification 2).
  }, [runToken]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const refresh = useCallback(() => {
    setRunToken((t) => t + 1);
  }, []);

  return { report, running, error, stale, refresh };
}
