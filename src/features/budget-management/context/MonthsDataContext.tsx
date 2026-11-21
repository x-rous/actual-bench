"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import {
  budgetMonthDataQueryOptions,
  isMissingBudgetMonthError,
} from "../lib/monthDataQuery";
import { useBudgetMode } from "../hooks/useBudgetMode";
import { useIncomeBudgets } from "../hooks/useIncomeBudgets";
import { useEnvelopeCarry } from "../hooks/useEnvelopeCarry";
import { incomeCategoryIdsNeedingBudgetFallback } from "../lib/monthAuthority";
import {
  computeEffectiveMonthState,
  mergeMonthStates,
  type MergedStructure,
} from "../lib/effectiveMonth";
import type { LoadedCategory, LoadedGroup, LoadedMonthState } from "../types";

// ─── Context shape ────────────────────────────────────────────────────────────

export type MonthsDataContextValue = {
  /** Raw server states keyed by month — shared TanStack Query cache. */
  raw: Map<string, LoadedMonthState>;
  /** Effective states (raw + cascade + income budgets + staged edits) per month. */
  effective: Map<string, LoadedMonthState>;
  /** Per-month errors when their query rejected. */
  errors: Map<string, unknown>;
  /** True while any in-window month is still loading initial data. */
  isLoading: boolean;
  /** Cross-month union of groups and categories, ordered by first appearance. */
  merged: MergedStructure | null;
};

/** Everything except the effective states: changes only with server data. */
export type MonthsStructureValue = Omit<MonthsDataContextValue, "effective">;

type EffectiveMap = Map<string, LoadedMonthState>;

/**
 * P1: the effective states change on every staged edit, so they live in a
 * tiny external store instead of the context value. A context change
 * re-renders every consumer (every cell of the grid); a store subscription
 * with a narrow selector re-renders only the components whose selected value
 * changed. `computeEffectiveMonthState` keeps the identity of every category
 * and group an edit does not touch, so a cell re-renders only when its own
 * numbers change - the edited cell and the cells its cascade moves.
 */
type EffectiveStore = {
  get: () => EffectiveMap;
  set: (next: EffectiveMap) => void;
  subscribe: (listener: () => void) => () => void;
};

/** Same own keys with identical values (one level deep; arrays by identity). */
function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a) as (keyof T)[];
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];
    if (av === bv) continue;
    // categoryIds / incomeBudgetFallbackIds: compare contents.
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (av.length !== bv.length || av.some((v, i) => v !== bv[i])) return false;
      continue;
    }
    return false;
  }
  return true;
}

/** Reuses `prev[id]` for every entry whose figures did not change. */
function shareRecord<T extends object>(
  prev: Record<string, T>,
  next: Record<string, T>
): Record<string, T> {
  let changed = Object.keys(prev).length !== Object.keys(next).length;
  const out: Record<string, T> = {};
  for (const [id, value] of Object.entries(next)) {
    const old = prev[id];
    if (old !== undefined && shallowEqual(old, value)) {
      out[id] = old;
    } else {
      out[id] = value;
      changed = true;
    }
  }
  return changed ? out : prev;
}

/**
 * Structural sharing between two effective maps. The cascade rebuilds a
 * category or group object whenever an earlier edit touches it, even when
 * the edit just staged was somewhere else; reusing equal objects is what lets
 * a cell's selector see "unchanged" and skip the render.
 */
function shareEffective(prev: EffectiveMap, next: EffectiveMap): EffectiveMap {
  const out: EffectiveMap = new Map();
  for (const [month, state] of next) {
    const old = prev.get(month);
    if (!old || old === state) {
      out.set(month, state);
      continue;
    }
    const categoriesById = shareRecord(old.categoriesById, state.categoriesById);
    const groupsById = shareRecord(old.groupsById, state.groupsById);
    const summary = shallowEqual(old.summary, state.summary) ? old.summary : state.summary;
    const same =
      categoriesById === old.categoriesById &&
      groupsById === old.groupsById &&
      summary === old.summary &&
      old.groupOrder === state.groupOrder &&
      old.incomeBudgetFallbackIds === state.incomeBudgetFallbackIds;
    out.set(
      month,
      same ? old : { ...state, categoriesById, groupsById, summary }
    );
  }
  return out;
}

function createEffectiveStore(initial: EffectiveMap): EffectiveStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      if (next === current) return;
      current = shareEffective(current, next);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const EMPTY_EFFECTIVE: EffectiveMap = new Map();

const EMPTY_STRUCTURE: MonthsStructureValue = {
  raw: new Map(),
  errors: new Map(),
  isLoading: false,
  merged: null,
};

const EMPTY_STORE = createEffectiveStore(EMPTY_EFFECTIVE);

const MonthsStructureContext = createContext<MonthsStructureValue | null>(null);
const EffectiveStoreContext = createContext<EffectiveStore | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

type ProviderProps = {
  /** Visible month window (chronological order). */
  months: string[];
  /** Months the API reports as existing; unavailable months are skipped. */
  availableMonths?: string[];
  children: ReactNode;
};

/**
 * Loads every month in `months` via a single useQueries (replaces the two
 * 12-hook loaders) and computes the effective state per month with one shared
 * cascade pass and one shared edits subscription.
 *
 * Distributes the result via React Context so per-cell components can read
 * effective data without each subscribing to the full edits map.
 */
export function MonthsDataProvider({
  months,
  availableMonths,
  children,
}: ProviderProps) {
  const connection = useConnectionStore(selectActiveInstance);
  const { data: budgetMode } = useBudgetMode();
  const isTracking = budgetMode === "tracking";
  const loadableMonths = availableMonths ?? months;
  const loadableMonthSet = useMemo(
    () => new Set(loadableMonths),
    [loadableMonths]
  );

  // Snapshot only loadable month results. Disabled TanStack Query entries can
  // still expose cached data, so unavailable months must be filtered here. The
  // combined value is shared structurally by TanStack Query, so its arrays keep
  // their identity until a query result really changes, and the memo below can
  // depend on them directly.
  const combine = useCallback(
    (results: UseQueryResult<LoadedMonthState>[]) => ({
      data: results.map((q, i) => (loadableMonthSet.has(months[i]!) ? q.data : undefined)),
      errors: results.map((q, i) => (loadableMonthSet.has(months[i]!) ? q.error : null)),
      isLoading: results.some((q, i) => loadableMonthSet.has(months[i]!) && q.isLoading),
    }),
    [months, loadableMonthSet]
  );
  const { data: dataArr, errors: errorArr, isLoading } = useQueries({
    queries: months.map((m) => ({
      ...budgetMonthDataQueryOptions(connection, m),
      enabled: !!connection && !!m && loadableMonthSet.has(m),
    })),
    combine,
  });

  // BM-09: only income categories whose monthly `budgeted` was absent need the
  // reflect_budgets fallback. On 26.8+ this is empty, so useIncomeBudgets stays
  // disabled and the canonical monthly value is used without a second fetch.
  const incomeCategoryIds = useMemo(() => incomeCategoryIdsNeedingBudgetFallback(dataArr), [dataArr]);

  const { data: incomeBudgets } = useIncomeBudgets(incomeCategoryIds, isTracking);

  // Single subscription to the entire edits map and holds map happens here,
  // ONCE for the whole grid — instead of once per cell as in pre-BM-02.
  const allEdits = useBudgetEditsStore((s) => s.edits);
  const allHolds = useBudgetEditsStore((s) => s.holds);

  const structure = useMemo<MonthsStructureValue>(() => {
    const raw = new Map<string, LoadedMonthState>();
    const errors = new Map<string, unknown>();
    for (let i = 0; i < months.length; i++) {
      const m = months[i]!;
      if (!loadableMonthSet.has(m)) continue;
      const data = dataArr[i];
      const err = errorArr[i];
      if (err && !isMissingBudgetMonthError(err, m)) errors.set(m, err);
      if (data) raw.set(m, data);
    }
    return { raw, errors, isLoading, merged: mergeMonthStates(dataArr) };
  }, [months, loadableMonthSet, isLoading, dataArr, errorArr]);

  // H1: Envelope carries staged edits forward with Actual's rules (negative
  // balances reset, charged to next month's To Budget), not linearly, replayed
  // from the earliest staged edit even when it is before the window.
  const loadableStates = useMemo(
    () => months.map((m, i) => (loadableMonthSet.has(m) ? dataArr[i] : undefined)),
    [months, loadableMonthSet, dataArr]
  );
  const envelopeCarry = useEnvelopeCarry(months, loadableStates, allEdits, !isTracking, loadableMonthSet);

  const effective = useMemo<EffectiveMap>(() => {
    const result = new Map<string, LoadedMonthState>();

    for (let i = 0; i < months.length; i++) {
      const m = months[i]!;
      if (!loadableMonthSet.has(m)) continue;
      const data = dataArr[i];
      if (!data) continue;
      const eff = computeEffectiveMonthState({
        serverState: data,
        allEdits,
        isTracking,
        incomeBudgets,
        month: m,
        stagedHolds: allHolds,
        envelopeCarry: envelopeCarry?.get(m),
      });
      if (eff) result.set(m, eff);
    }
    return result;
  }, [months, loadableMonthSet, allEdits, allHolds, isTracking, incomeBudgets, dataArr, envelopeCarry]);

  // The store is created once with the first effective map, so the first
  // render already reads real data; later maps are published before paint.
  const [store] = useState(() => createEffectiveStore(effective));
  useLayoutEffect(() => {
    store.set(effective);
  }, [store, effective]);

  return (
    <MonthsStructureContext.Provider value={structure}>
      <EffectiveStoreContext.Provider value={store}>
        {children}
      </EffectiveStoreContext.Provider>
    </MonthsStructureContext.Provider>
  );
}

// ─── Consumers ────────────────────────────────────────────────────────────────

function useEffectiveStore(): EffectiveStore {
  return useContext(EffectiveStoreContext) ?? EMPTY_STORE;
}

/**
 * Subscribes to one value derived from the effective map. `select` must
 * return a stable value (a primitive, or an object already in the map) or
 * the component re-renders on every edit.
 */
export function useEffectiveSelector<T>(select: (map: EffectiveMap) => T): T {
  const store = useEffectiveStore();
  const getSnapshot = () => select(store.get());
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * Structure only (raw months, merged rows, errors, loading). Does not
 * re-render on staged edits - use this in the grid and workspace shells.
 */
export function useMonthsStructure(): MonthsStructureValue {
  return useContext(MonthsStructureContext) ?? EMPTY_STRUCTURE;
}

/**
 * Reads everything, including the whole effective map. Re-renders on every
 * staged edit, so keep it to components that summarise many cells (the
 * selection footer); grid cells use the narrow hooks below.
 */
export function useMonthsData(): MonthsDataContextValue {
  const structure = useMonthsStructure();
  const effective = useEffectiveSelector((map) => map);
  return useMemo(() => ({ ...structure, effective }), [structure, effective]);
}

/**
 * Returns the structure context, or null when no provider is mounted.
 *
 * Used by `useMonthData` to detect provider presence so it can either read
 * from context or fall back to a standalone TanStack Query subscription.
 */
export function useMonthsDataContext(): MonthsStructureValue | null {
  return useContext(MonthsStructureContext);
}

/** Reads the effective map without subscribing (event handlers only). */
export function useEffectiveMonthsGetter(): () => EffectiveMap {
  return useEffectiveStore().get;
}

/**
 * Effective state for one whole month. Re-renders whenever anything in that
 * month changes, so it suits per-month components (summary and section
 * totals), not per-cell ones.
 */
export function useEffectiveMonthFromContext(
  month: string | null | undefined
): LoadedMonthState | undefined {
  return useEffectiveSelector((map) => (month ? map.get(month) : undefined));
}

/** True when the effective state for `month` is loaded. */
export function useHasEffectiveMonth(month: string | null | undefined): boolean {
  return useEffectiveSelector((map) => (month ? map.has(month) : false));
}

/** One category's effective figures in one month (per-cell). */
export function useEffectiveCategory(
  month: string | null | undefined,
  categoryId: string | null | undefined
): LoadedCategory | undefined {
  return useEffectiveSelector((map) =>
    month && categoryId ? map.get(month)?.categoriesById[categoryId] : undefined
  );
}

/** One group's effective aggregate in one month (per group cell). */
export function useEffectiveGroup(
  month: string | null | undefined,
  groupId: string | null | undefined
): LoadedGroup | undefined {
  return useEffectiveSelector((map) =>
    month && groupId ? map.get(month)?.groupsById[groupId] : undefined
  );
}

/** Same as above but for raw server state. */
export function useRawMonthFromContext(
  month: string | null | undefined
): LoadedMonthState | undefined {
  const ctx = useContext(MonthsStructureContext);
  if (!ctx || !month) return undefined;
  return ctx.raw.get(month);
}
