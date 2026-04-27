import {
  computeEffectiveMonthState,
  mergeMonthStates,
} from "./effectiveMonth";
import type {
  BudgetCellKey,
  LoadedCategory,
  LoadedGroup,
  LoadedMonthState,
  StagedBudgetEdit,
} from "../types";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function cat(overrides: Partial<LoadedCategory> = {}): LoadedCategory {
  return {
    id: overrides.id ?? "c1",
    name: overrides.name ?? "Cat",
    groupId: overrides.groupId ?? "g1",
    groupName: overrides.groupName ?? "Group",
    isIncome: overrides.isIncome ?? false,
    hidden: overrides.hidden ?? false,
    budgeted: overrides.budgeted ?? 0,
    actuals: overrides.actuals ?? 0,
    balance: overrides.balance ?? 0,
    carryover: overrides.carryover ?? false,
  };
}

function group(overrides: Partial<LoadedGroup>): LoadedGroup {
  return {
    id: overrides.id ?? "g1",
    name: overrides.name ?? "Group",
    isIncome: overrides.isIncome ?? false,
    hidden: overrides.hidden ?? false,
    categoryIds: overrides.categoryIds ?? ["c1"],
    budgeted: overrides.budgeted ?? 0,
    actuals: overrides.actuals ?? 0,
    balance: overrides.balance ?? 0,
  };
}

function state(opts: {
  month: string;
  groups: LoadedGroup[];
  cats: LoadedCategory[];
  summary?: Partial<LoadedMonthState["summary"]>;
}): LoadedMonthState {
  const groupsById: Record<string, LoadedGroup> = {};
  const categoriesById: Record<string, LoadedCategory> = {};
  for (const g of opts.groups) groupsById[g.id] = g;
  for (const c of opts.cats) categoriesById[c.id] = c;
  return {
    summary: {
      month: opts.month,
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: 0,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: 0,
      totalSpent: 0,
      totalBalance: 0,
      ...opts.summary,
    },
    groupsById,
    categoriesById,
    groupOrder: opts.groups.map((g) => g.id),
  };
}

function edit(
  month: string,
  categoryId: string,
  nextBudgeted: number,
  previousBudgeted: number
): StagedBudgetEdit {
  return { month, categoryId, nextBudgeted, previousBudgeted, source: "manual" };
}

function editsMap(edits: StagedBudgetEdit[]): Record<BudgetCellKey, StagedBudgetEdit> {
  const out: Record<BudgetCellKey, StagedBudgetEdit> = {};
  for (const e of edits) out[`${e.month}:${e.categoryId}`] = e;
  return out;
}

// ─── computeEffectiveMonthState ────────────────────────────────────────────────

describe("computeEffectiveMonthState", () => {
  it("returns serverState unchanged when nothing applies", () => {
    const s = state({
      month: "2026-01",
      groups: [group({ id: "g1", categoryIds: ["c1"] })],
      cats: [cat({ id: "c1" })],
    });
    const r = computeEffectiveMonthState({
      serverState: s,
      allEdits: {},
      isTracking: false,
      incomeBudgets: undefined,
      month: "2026-01",
    });
    expect(r).toBe(s);
  });

  it("returns undefined when no server state is provided", () => {
    expect(
      computeEffectiveMonthState({
        serverState: undefined,
        allEdits: {},
        isTracking: false,
        incomeBudgets: undefined,
        month: "2026-01",
      })
    ).toBeUndefined();
  });

  describe("Layer 2 — staged edits", () => {
    it("updates the category's budgeted and balance by the delta", () => {
      const s = state({
        month: "2026-01",
        groups: [group({ id: "g1", categoryIds: ["c1"], budgeted: 1000, balance: 500 })],
        cats: [cat({ id: "c1", budgeted: 1000, balance: 500 })],
        summary: { totalBudgeted: -1000, totalBalance: 500, toBudget: 100 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "c1", 1500, 1000)]),
        isTracking: false,
        incomeBudgets: undefined,
        month: "2026-01",
      });
      expect(r?.categoriesById.c1!.budgeted).toBe(1500);
      expect(r?.categoriesById.c1!.balance).toBe(1000);
      expect(r?.groupsById.g1!.budgeted).toBe(1500);
      expect(r?.groupsById.g1!.balance).toBe(1000);
      expect(r?.summary.totalBudgeted).toBe(-1500);
      expect(r?.summary.totalBalance).toBe(1000);
      expect(r?.summary.toBudget).toBe(-400);
    });

    it("does not mutate the input serverState", () => {
      const s = state({
        month: "2026-01",
        groups: [group({ id: "g1", categoryIds: ["c1"] })],
        cats: [cat({ id: "c1", budgeted: 1000 })],
      });
      const before = JSON.parse(JSON.stringify(s));
      computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "c1", 9999, 1000)]),
        isTracking: false,
        incomeBudgets: undefined,
        month: "2026-01",
      });
      expect(s).toEqual(before);
    });

    it("ignores edits for other months", () => {
      const s = state({
        month: "2026-02",
        groups: [group({ id: "g1", categoryIds: ["c1"] })],
        cats: [cat({ id: "c1", budgeted: 1000 })],
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-03", "c1", 5000, 1000)]),
        isTracking: false,
        incomeBudgets: undefined,
        month: "2026-02",
      });
      expect(r?.categoriesById.c1!.budgeted).toBe(1000);
    });

    it("skips edits where next equals current (delta zero)", () => {
      const s = state({
        month: "2026-01",
        groups: [group({ id: "g1", categoryIds: ["c1"], budgeted: 1000, balance: 0 })],
        cats: [cat({ id: "c1", budgeted: 1000 })],
        summary: { totalBudgeted: -1000 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "c1", 1000, 1000)]),
        isTracking: false,
        incomeBudgets: undefined,
        month: "2026-01",
      });
      // No change, so the function may still allocate but values match.
      expect(r?.summary.totalBudgeted).toBe(-1000);
      expect(r?.categoriesById.c1!.budgeted).toBe(1000);
    });
  });

  describe("Cascade — prior-month carry-forward", () => {
    it("subtracts cumulative prior-month delta from incomeAvailable and toBudget", () => {
      const s = state({
        month: "2026-03",
        groups: [group({ id: "g1", categoryIds: ["c1"] })],
        cats: [cat({ id: "c1" })],
        summary: { incomeAvailable: 10000, toBudget: 5000 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([
          edit("2026-01", "c1", 200, 100), // +100 in Jan
          edit("2026-02", "c1", 500, 300), // +200 in Feb
        ]),
        isTracking: false,
        incomeBudgets: undefined,
        month: "2026-03",
      });
      // Cascade total = 100 + 200 = 300
      expect(r?.summary.incomeAvailable).toBe(10000 - 300);
      expect(r?.summary.toBudget).toBe(5000 - 300);
    });
  });

  describe("Tracking-mode hidden category exclusion", () => {
    it("excludes hidden categories from summary updates", () => {
      const s = state({
        month: "2026-01",
        groups: [group({ id: "g1", categoryIds: ["c1"] })],
        cats: [cat({ id: "c1", hidden: true, budgeted: 1000 })],
        summary: { totalBudgeted: -1000, totalBalance: 0, toBudget: 0 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "c1", 9000, 1000)]),
        isTracking: true,
        incomeBudgets: undefined,
        month: "2026-01",
      });
      // Category itself updates, but the summary stays put.
      expect(r?.categoriesById.c1!.budgeted).toBe(9000);
      expect(r?.summary.totalBudgeted).toBe(-1000);
      expect(r?.summary.toBudget).toBe(0);
    });

    it("propagates hidden-category edits to a hidden parent group's aggregate", () => {
      const s = state({
        month: "2026-01",
        groups: [group({ id: "g1", hidden: true, categoryIds: ["c1"], budgeted: 1000, balance: 0 })],
        cats: [cat({ id: "c1", hidden: true, budgeted: 1000 })],
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "c1", 5000, 1000)]),
        isTracking: true,
        incomeBudgets: undefined,
        month: "2026-01",
      });
      // Group is hidden too → aggregate updates.
      expect(r?.groupsById.g1!.budgeted).toBe(5000);
    });

    it("does NOT pollute a visible group's aggregate when a hidden category is edited", () => {
      const s = state({
        month: "2026-01",
        groups: [group({ id: "g1", hidden: false, categoryIds: ["c1"], budgeted: 1000 })],
        cats: [cat({ id: "c1", hidden: true, budgeted: 1000 })],
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "c1", 5000, 1000)]),
        isTracking: true,
        incomeBudgets: undefined,
        month: "2026-01",
      });
      // Visible group keeps its server-reported budgeted.
      expect(r?.groupsById.g1!.budgeted).toBe(1000);
    });
  });

  describe("Layer 1 — income budgets in tracking mode", () => {
    it("populates income category budgeted from incomeBudgets map", () => {
      const s = state({
        month: "2026-01",
        groups: [group({ id: "gi", isIncome: true, categoryIds: ["i1"], budgeted: 0 })],
        cats: [cat({ id: "i1", isIncome: true, groupId: "gi", budgeted: 0 })],
      });
      const incomeBudgets = new Map([
        ["2026-01", new Map([["i1", 50000]])],
      ]);
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: {},
        isTracking: true,
        incomeBudgets,
        month: "2026-01",
      });
      expect(r?.categoriesById.i1!.budgeted).toBe(50000);
      expect(r?.groupsById.gi!.budgeted).toBe(50000);
    });

    it("does not touch income budgets when not in tracking mode", () => {
      const s = state({
        month: "2026-01",
        groups: [group({ id: "gi", isIncome: true, categoryIds: ["i1"], budgeted: 0 })],
        cats: [cat({ id: "i1", isIncome: true, groupId: "gi", budgeted: 0 })],
      });
      const incomeBudgets = new Map([["2026-01", new Map([["i1", 50000]])]]);
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: {},
        isTracking: false,
        incomeBudgets,
        month: "2026-01",
      });
      expect(r?.categoriesById.i1!.budgeted).toBe(0);
    });
  });
});

// ─── mergeMonthStates ──────────────────────────────────────────────────────────

describe("mergeMonthStates", () => {
  it("returns null when no states have data", () => {
    expect(mergeMonthStates([])).toBeNull();
    expect(mergeMonthStates([undefined, undefined])).toBeNull();
  });

  it("returns the single state's structure when only one is provided", () => {
    const s = state({
      month: "2026-01",
      groups: [group({ id: "g1", categoryIds: ["c1"] })],
      cats: [cat({ id: "c1" })],
    });
    const merged = mergeMonthStates([s]);
    expect(merged?.groupOrder).toEqual(["g1"]);
    expect(merged?.groupsById.g1!.categoryIds).toEqual(["c1"]);
  });

  it("preserves group order from first appearance", () => {
    const a = state({
      month: "2026-01",
      groups: [group({ id: "g1", categoryIds: ["c1"] })],
      cats: [cat({ id: "c1" })],
    });
    const b = state({
      month: "2026-02",
      groups: [
        group({ id: "g2", categoryIds: ["c2"] }),
        group({ id: "g1", categoryIds: ["c1"] }),
      ],
      cats: [cat({ id: "c1" }), cat({ id: "c2", groupId: "g2" })],
    });
    const merged = mergeMonthStates([a, b]);
    // g1 first because it appeared first in state a; g2 added when seen in b.
    expect(merged?.groupOrder).toEqual(["g1", "g2"]);
  });

  it("unions categories within a group (BM-13: category added mid-year)", () => {
    const a = state({
      month: "2026-01",
      groups: [group({ id: "g1", categoryIds: ["c1"] })],
      cats: [cat({ id: "c1" })],
    });
    const b = state({
      month: "2026-06",
      groups: [group({ id: "g1", categoryIds: ["c1", "c2"] })],
      cats: [cat({ id: "c1" }), cat({ id: "c2", name: "AddedMidYear" })],
    });
    const merged = mergeMonthStates([a, b]);
    expect(merged?.groupsById.g1!.categoryIds).toEqual(["c1", "c2"]);
    expect(merged?.categoriesById.c2!.name).toBe("AddedMidYear");
  });

  it("preserves category order by first appearance per group", () => {
    const a = state({
      month: "2026-01",
      groups: [group({ id: "g1", categoryIds: ["c1"] })],
      cats: [cat({ id: "c1" })],
    });
    const b = state({
      month: "2026-02",
      groups: [group({ id: "g1", categoryIds: ["c2", "c1", "c3"] })],
      cats: [cat({ id: "c1" }), cat({ id: "c2" }), cat({ id: "c3" })],
    });
    const merged = mergeMonthStates([a, b]);
    // c1 first (from a), then c2, c3 from b's order (c2 before c3 in b).
    expect(merged?.groupsById.g1!.categoryIds).toEqual(["c1", "c2", "c3"]);
  });

  it("skips undefined states without breaking the merge", () => {
    const a = state({
      month: "2026-01",
      groups: [group({ id: "g1", categoryIds: ["c1"] })],
      cats: [cat({ id: "c1" })],
    });
    const merged = mergeMonthStates([undefined, a, undefined]);
    expect(merged?.groupOrder).toEqual(["g1"]);
  });
});
