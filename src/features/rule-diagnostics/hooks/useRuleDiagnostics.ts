"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const payees = useStagedStore((s) => s.payees);
  const categories = useStagedStore((s) => s.categories);
  const accounts = useStagedStore((s) => s.accounts);
  const categoryGroups = useStagedStore((s) => s.categoryGroups);
  const schedules = useStagedStore((s) => s.schedules);
  const activeConnectionId = useConnectionStore((s) => s.activeInstanceId);

  const entityMaps = selectEntityMaps({
    payees,
    categories,
    accounts,
    categoryGroups,
    schedules,
  });

  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runToken, setRunToken] = useState(0);

  const cancelledRef = useRef(false);
  const previousConnectionIdRef = useRef(activeConnectionId);

  // Auto-refresh on connection switch — the working set belongs to a different
  // budget now, so the stale-banner pattern (used for in-route edits) would be
  // misleading. Matches the spec edge-case "Switching connections mid-review".
  useEffect(() => {
    if (previousConnectionIdRef.current !== activeConnectionId) {
      previousConnectionIdRef.current = activeConnectionId;
      setRunToken((t) => t + 1);
    }
  }, [activeConnectionId]);

  // Current working set signature is recomputed from the latest store snapshot
  // every render. It is compared against report.workingSetSignature to decide
  // whether the report is stale.
  const currentRules: Rule[] = [];
  for (const entry of Object.values(stagedRules)) {
    if (!entry.isDeleted) currentRules.push(entry.entity);
  }
  const currentSignature = workingSetSignature(currentRules);
  const stale = report !== null && report.workingSetSignature !== currentSignature;

  useEffect(() => {
    cancelledRef.current = false;
    let cancelled = false;
    setRunning(true);
    setError(null);

    const ws = buildWorkingSet(stagedRules, entityMaps);
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
    // Intentionally run only on mount and on explicit refresh — not on every
    // staged-store change. Staleness is surfaced via the `stale` flag so the
    // UI can prompt the user instead of silently recomputing (Clarification 2).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
