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

  describe("Layer 3 — per-category balance cascade", () => {
    it("envelope carryover=true: prior edit cascades balance to future month", () => {
      const s = state({
        month: "2026-02",
        groups: [group({ id: "g1", categoryIds: ["c1"], balance: 300 })],
        cats: [cat({ id: "c1", carryover: true, balance: 300 })],
        summary: { totalBalance: 300 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "c1", 600, 400)]), // +200 prior month
        isTracking: false,
        incomeBudgets: undefined,
        month: "2026-02",
      });
      expect(r?.categoriesById.c1!.balance).toBe(500); // 300 + 200
      expect(r?.groupsById.g1!.balance).toBe(500);
      expect(r?.summary.totalBalance).toBe(500);
    });

    it("envelope carryover=false: prior edit still cascades (envelope always chains)", () => {
      const s = state({
        month: "2026-02",
        groups: [group({ id: "g1", categoryIds: ["c1"], balance: 100 })],
        cats: [cat({ id: "c1", carryover: false, balance: 100 })],
        summary: { totalBalance: 100 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "c1", 500, 300)]), // +200
        isTracking: false,
        incomeBudgets: undefined,
        month: "2026-02",
      });
      expect(r?.categoriesById.c1!.balance).toBe(300); // 100 + 200
      expect(r?.groupsById.g1!.balance).toBe(300);
      expect(r?.summary.totalBalance).toBe(300);
    });

    it("tracking carryover=false: prior edit does NOT cascade balance", () => {
      const s = state({
        month: "2026-02",
        groups: [group({ id: "g1", categoryIds: ["c1"], balance: 100 })],
        cats: [cat({ id: "c1", carryover: false, balance: 100 })],
        summary: { totalBalance: 100 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "c1", 500, 300)]), // +200, but carryover=false
        isTracking: true,
        incomeBudgets: undefined,
        month: "2026-02",
      });
      // Layer 3 does not cascade — balance stays at server value
      expect(r?.categoriesById.c1!.balance).toBe(100);
      expect(r?.groupsById.g1!.balance).toBe(100);
      expect(r?.summary.totalBalance).toBe(100);
    });

    it("tracking carryover=true: prior edit cascades balance", () => {
      const s = state({
        month: "2026-02",
        groups: [group({ id: "g1", categoryIds: ["c1"], balance: 50 })],
        cats: [cat({ id: "c1", carryover: true, balance: 50 })],
        summary: { totalBalance: 50 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "c1", 300, 100)]), // +200
        isTracking: true,
        incomeBudgets: undefined,
        month: "2026-02",
      });
      expect(r?.categoriesById.c1!.balance).toBe(250); // 50 + 200
      expect(r?.groupsById.g1!.balance).toBe(250);
      expect(r?.summary.totalBalance).toBe(250);
    });

    it("two prior edits for same category: cascade delta = sum of both", () => {
      const s = state({
        month: "2026-03",
        groups: [group({ id: "g1", categoryIds: ["c1"], balance: 0 })],
        cats: [cat({ id: "c1", balance: 0 })],
        summary: { totalBalance: 0 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([
          edit("2026-01", "c1", 200, 100), // +100
          edit("2026-02", "c1", 600, 400), // +200
        ]),
        isTracking: false,
        incomeBudgets: undefined,
        month: "2026-03",
      });
      expect(r?.categoriesById.c1!.balance).toBe(300); // 0 + 100 + 200
      expect(r?.groupsById.g1!.balance).toBe(300);
      expect(r?.summary.totalBalance).toBe(300);
    });

    it("Layer 2 + Layer 3 compose: current-month edit and prior cascade both apply", () => {
      const s = state({
        month: "2026-02",
        groups: [group({ id: "g1", categoryIds: ["c1"], budgeted: 400, balance: 200 })],
        cats: [cat({ id: "c1", budgeted: 400, balance: 200 })],
        summary: { totalBudgeted: -400, totalBalance: 200, toBudget: 0 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        // Prior month: +100 cascade; current month: budgeted changes from 400 → 600 (+200)
        allEdits: editsMap([
          edit("2026-01", "c1", 300, 200), // +100 cascade
          edit("2026-02", "c1", 600, 400), // +200 Layer 2
        ]),
        isTracking: false,
        incomeBudgets: undefined,
        month: "2026-02",
      });
      // Layer 2: budgeted 400→600, balance 200+200=400
      // Layer 3: balance 400+100=500
      expect(r?.categoriesById.c1!.budgeted).toBe(600);
      expect(r?.categoriesById.c1!.balance).toBe(500);
      expect(r?.groupsById.g1!.balance).toBe(500);
    });

    it("category absent in future month: no crash, balance of existing categories unaffected", () => {
      // serverState for 2026-02 does not contain c1 at all
      const s = state({
        month: "2026-02",
        groups: [group({ id: "g1", categoryIds: ["c2"], balance: 50 })],
        cats: [cat({ id: "c2", balance: 50 })],
        summary: { totalBalance: 50 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "c1", 500, 300)]), // c1 absent this month
        isTracking: false,
        incomeBudgets: undefined,
        month: "2026-02",
      });
      // No crash; c2 balance unchanged — cascade for c1 is skipped
      expect(r?.categoriesById.c2!.balance).toBe(50);
      expect(r?.groupsById.g1!.balance).toBe(50);
      expect(r?.summary.totalBalance).toBe(50);
    });

    it("income categories are excluded from balance cascade", () => {
      const s = state({
        month: "2026-02",
        groups: [group({ id: "gi", isIncome: true, categoryIds: ["i1"], balance: 0 })],
        cats: [cat({ id: "i1", isIncome: true, groupId: "gi", balance: 0 })],
        summary: { totalBalance: 0 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "i1", 1000, 500)]),
        isTracking: false,
        incomeBudgets: undefined,
        month: "2026-02",
      });
      // Income category balance does not cascade via Layer 3
      expect(r?.categoriesById.i1!.balance).toBe(0);
      expect(r?.groupsById.gi!.balance).toBe(0);
      expect(r?.summary.totalBalance).toBe(0);
    });

    it("hidden category in tracking mode: summary not polluted, group logic mirrors Layer 2", () => {
      const s = state({
        month: "2026-02",
        groups: [group({ id: "g1", hidden: false, categoryIds: ["c1"], balance: 0 })],
        cats: [cat({ id: "c1", hidden: true, carryover: true, balance: 0 })],
        summary: { totalBalance: 0 },
      });
      const r = computeEffectiveMonthState({
        serverState: s,
        allEdits: editsMap([edit("2026-01", "c1", 500, 300)]), // +200
        isTracking: true,
        incomeBudgets: undefined,
        month: "2026-02",
      });
      // Category balance updates, but visible group and summary are not polluted
      expect(r?.categoriesById.c1!.balance).toBe(200);
      expect(r?.groupsById.g1!.balance).toBe(0); // visible group unchanged
      expect(r?.summary.totalBalance).toBe(0); // summary unchanged
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
