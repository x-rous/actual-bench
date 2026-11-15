import { SECTIONS, SECTION_SIGN, type PlanDocument } from "./types";
import { contributionsOf, placeActuals, unplannedTarget, type SnapAccount, type Snapshot } from "./actuals";
import { buildPlanFromActuals } from "./builder";
import { createPlanDocument, createRow, exportPlanJson, importPlanJson, parseAmount, parsePlanDocument, planEndMonth, ruleAmount, setCells, setHorizon } from "./document";
import { computePlan } from "./engine";
import { linkNotes } from "./linkNotes";

const account = (id: string, accountClass: SnapAccount["accountClass"], offBudget = false): SnapAccount => ({ id, name: id, offBudget, closed: false, accountClass, treatment: null, excluded: false, groupName: null });

/**
 * A small household, today 15 Mar 2026. Bank and card are cash; the broker is savings; the mortgage is outside.
 * Each month: salary 5,000 in; groceries 800 from the bank and 200 on the card; the card is paid 200; 500 to the broker;
 * 1,000 to the mortgage (categorized "Mortgage" as Actual does for a transfer that leaves the budget).
 */
function household(): Snapshot {
  const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"];
  const movement: Snapshot["movement"] = [];
  const transfersIn: Snapshot["transfersIn"] = [];
  for (const month of months) {
    const part = month === "2026-03" ? 0.5 : 1;
    movement.push(
      { month, accountId: "bank", categoryId: "salary", transferAccountId: null, amountMinor: 500_000 * part, count: 1 },
      { month, accountId: "bank", categoryId: "groceries", transferAccountId: null, amountMinor: -80_000 * part, count: 8 },
      { month, accountId: "card", categoryId: "groceries", transferAccountId: null, amountMinor: -20_000 * part, count: 2 },
      { month, accountId: "bank", categoryId: null, transferAccountId: "card", amountMinor: -20_000, count: 1 },
      { month, accountId: "card", categoryId: null, transferAccountId: "bank", amountMinor: 20_000, count: 1 },
      { month, accountId: "bank", categoryId: null, transferAccountId: "broker", amountMinor: -50_000, count: 1 },
      { month, accountId: "broker", categoryId: null, transferAccountId: "bank", amountMinor: 50_000, count: 1 },
      { month, accountId: "bank", categoryId: "mortgage", transferAccountId: "mortgage", amountMinor: -100_000, count: 1 },
      { month, accountId: "mortgage", categoryId: null, transferAccountId: "bank", amountMinor: 100_000, count: 1 },
    );
    transfersIn.push({ month, accountId: "card", transferAccountId: "bank", amountMinor: 20_000 }, { month, accountId: "broker", transferAccountId: "bank", amountMinor: 50_000 }, { month, accountId: "mortgage", transferAccountId: "bank", amountMinor: 100_000 });
  }
  // An uncategorized refund and an uncategorized fee in January.
  movement.push({ month: "2026-01", accountId: "bank", categoryId: null, transferAccountId: null, amountMinor: 3_000, count: 2 });
  return {
    today: "2026-03-15",
    accounts: [account("bank", "bank"), account("card", "credit-card"), account("broker", "investment", true), account("mortgage", "loan", true)],
    categories: [
      { id: "salary", name: "Salary", groupId: "g-income", groupName: "Income", isIncome: true, hidden: false },
      { id: "groceries", name: "Groceries", groupId: "g-living", groupName: "Living", isIncome: false, hidden: false },
      { id: "mortgage", name: "Mortgage", groupId: "g-home", groupName: "Home", isIncome: false, hidden: false },
    ],
    movement,
    startingBalances: [{ month: "2025-11", accountId: "bank", amountMinor: 1_000_000 }, { month: "2025-11", accountId: "broker", amountMinor: 2_000_000 }, { month: "2025-11", accountId: "mortgage", amountMinor: -30_000_000 }],
    uncategorizedIn: [{ month: "2026-01", accountId: "bank", amountMinor: 5_000 }],
    transfersIn,
    schedules: [{ id: "s-rent", name: "Insurance", completed: false, amount: -120_000, dates: ["2026-03-20", "2026-06-20", "2026-09-20"] }],
    loans: { mortgage: { state: "ready", name: "Mortgage", split: true, principal: { "2026-03": 100_000, "2026-04": 100_000, "2026-05": 100_000, "2026-06": 40_000 }, payment: { "2026-03": 130_000, "2026-04": 130_000, "2026-05": 130_000, "2026-06": 45_000 } } },
    loanCosts: [], shifts: [],
    budget: { months: { "2026-03": { groceries: 110_000 }, "2026-04": { groceries: 120_000 } }, lastMonth: "2026-04" },
  };
}

function plan(change?: (doc: PlanDocument) => PlanDocument): PlanDocument {
  const doc = createPlanDocument({ name: "Test", startMonth: "2026-01", years: 1 });
  const rows = [
    createRow({ name: "Salary", section: "income", basis: { kind: "average", months: 3 }, links: { categories: ["salary"] } }),
    createRow({ name: "Living", section: "expenses", basis: { kind: "average", months: 3 }, links: { categoryGroups: ["g-living"] } }),
    createRow({ name: "Broker", section: "savings", basis: { kind: "average", months: 3 }, links: { accounts: [{ id: "broker" }] } }),
    createRow({ name: "Mortgage", section: "debt", basis: { kind: "loan", count: "principal" }, links: { accounts: [{ id: "mortgage" }] } }),
  ];
  const built = { ...doc, rows };
  return change ? change(built) : built;
}

const run = (doc: PlanDocument, snapshot: Snapshot | null = household()) => computePlan(doc, snapshot, snapshot ? placeActuals(doc, snapshot) : null);
const rowOf = (doc: PlanDocument, name: string) => doc.rows.find((r) => r.name === name)!;

describe("placing what Actual recorded", () => {
  it("places every movement once, so the rows of a month add up to the change in cash", () => {
    const snapshot = household();
    for (const doc of [plan(), createPlanDocument({ name: "Empty", startMonth: "2026-01", years: 1 })]) {
      const result = run(doc, snapshot);
      for (let i = 0; i < 2; i++) {
        const flows = SECTIONS.reduce((sum, s) => sum + result.sectionTotals[s][i] * SECTION_SIGN[s], 0) + result.inTransit[i];
        expect(result.closing[i] - result.opening[i]).toBe(flows + result.startingBalances[i]);
        expect(result.net[i]).toBe(flows);
      }
      // Bank 10,000 start, then +5,000 -800 -200 -500 -1,000 a month with the card inside cash: two months before the plan.
      expect(result.opening[0]).toBe(1_000_000 + 2 * 250_000);
    }
  });

  it("follows the account before the category for a transfer, and never counts a card payment inside cash", () => {
    const doc = plan();
    const result = run(doc);
    expect(result.rows.get(rowOf(doc, "Salary").id)!.actual[0]).toBe(500_000);
    // Bank and card purchases together; the payment between them is not spending.
    expect(result.rows.get(rowOf(doc, "Living").id)!.actual[0]).toBe(100_000);
    expect(result.rows.get(rowOf(doc, "Broker").id)!.actual[0]).toBe(50_000);
    expect(result.rows.get(rowOf(doc, "Mortgage").id)!.actual[0]).toBe(100_000);
    expect(result.inTransit[0]).toBe(0);
    // The uncategorized entries are split by sign: 50.00 in, 20.00 out.
    expect(result.unplanned.income[0]).toBe(5_000);
    expect(result.unplanned.expenses[0]).toBe(2_000);
  });

  it("shows a card payment as money out when the card is outside the plan's cash", () => {
    const doc = plan((d) => ({ ...d, accountRoles: { card: "outside" } }));
    const result = run(doc);
    expect(result.rows.get(rowOf(doc, "Living").id)!.actual[0]).toBe(80_000);
    expect(result.unplanned.debt[0]).toBe(20_000);
    const placed = placeActuals(doc, household());
    expect(contributionsOf(placed, household(), unplannedTarget("debt"), new Set(["2026-01"]))).toEqual([{ kind: "transfer", id: "card", label: "Transfers: card", amount: 20_000 }]);
  });

  it("lets a transfer follow its category when no row follows the account, and reports a link held twice", () => {
    const doc = plan((d) => ({ ...d, rows: [...d.rows.filter((r) => r.name !== "Mortgage"), createRow({ name: "Home", section: "expenses", links: { categories: ["mortgage"] } }), createRow({ name: "Again", section: "expenses", links: { categories: ["mortgage"] } })] }));
    const placed = placeActuals(doc, household());
    expect(placed.rowActual.get(rowOf(doc, "Home").id)!.get("2026-01")).toBe(100_000);
    expect(placed.conflicts).toEqual([{ rowId: rowOf(doc, "Again").id, what: "Mortgage is already followed by another row", kind: "category", name: "Mortgage", heldBy: rowOf(doc, "Home").id }]);
  });
});

describe("forecasting", () => {
  it("starts from the real balance and expects only what is left of the current month", () => {
    const doc = plan();
    const result = run(doc);
    expect(result.currentIndex).toBe(2);
    expect(result.kinds.slice(0, 4)).toEqual(["actual", "actual", "current", "forecast"]);
    const salary = result.rows.get(rowOf(doc, "Salary").id)!;
    // Three complete months of 5,000; half of March is recorded, so the other half is still expected.
    expect(salary.typical).toBe(500_000);
    expect(salary.actual[2]).toBe(250_000);
    expect(salary.values[2]).toBe(500_000);
    expect(salary.values[3]).toBe(500_000);
    // The broker transfer already happened in full: nothing more is expected this month.
    expect(result.rows.get(rowOf(doc, "Broker").id)!.values[2]).toBe(50_000);
    // The loan projection only holds what is still due, so it adds to what was paid.
    const mortgage = result.rows.get(rowOf(doc, "Mortgage").id)!;
    expect(mortgage.values[2]).toBe(200_000);
    expect(mortgage.values.slice(3, 7)).toEqual([100_000, 100_000, 40_000, 0]);
    expect(result.closing[2]).toBe(result.kpis.cashNow + (500_000 - 250_000) - (100_000 - 50_000) - 100_000);
    expect(result.opening[3]).toBe(result.closing[2]);
  });

  it("lets a typed cell win, then repeating amounts, a budget and schedules", () => {
    const snapshot = household();
    let doc = plan((d) => ({
      ...d,
      rows: [
        ...d.rows.filter((r) => r.name !== "Living"),
        createRow({ name: "Living", section: "expenses", basis: { kind: "budget" }, links: { categoryGroups: ["g-living"] } }),
        { ...createRow({ name: "Rent", section: "expenses" }), rules: [{ id: "r1", amount: 300_000, start: "2026-02", every: 3, growthPct: 10 }] },
        createRow({ name: "Insurance", section: "expenses", basis: { kind: "schedule", scheduleIds: ["s-rent"] } }),
      ],
    }));
    doc = setCells(doc, [{ rowId: rowOf(doc, "Salary").id, month: "2026-06", amount: 900_000 }]);
    const result = run(doc, snapshot);
    expect(result.rows.get(rowOf(doc, "Salary").id)!.values[5]).toBe(900_000);
    expect(result.rows.get(rowOf(doc, "Salary").id)!.source[5]).toBe("cell");
    // Budgeted months as they are; later months repeat the last budgeted one.
    expect(result.rows.get(rowOf(doc, "Living").id)!.values.slice(2, 6)).toEqual([110_000, 120_000, 120_000, 120_000]);
    const rent = result.rows.get(rowOf(doc, "Rent").id)!;
    expect(rent.plan[1]).toBe(300_000);
    expect(rent.values.slice(3, 9)).toEqual([0, 300_000, 0, 0, 300_000, 0]);
    expect(result.rows.get(rowOf(doc, "Insurance").id)!.values.slice(2, 9)).toEqual([120_000, 0, 0, 120_000, 0, 0, 120_000]);
    expect(ruleAmount({ id: "r", amount: 300_000, start: "2026-02", every: 3, growthPct: 10 }, "2027-02")).toBe(330_000);
  });

  it("flags the months below the minimum and works out goals", () => {
    const doc = plan((d) => ({ ...d, minimumCash: 5_000_000, goals: [{ id: "g", name: "Buffer", month: "2026-12", amount: 9_000_000, basis: "cash" }] }));
    const result = run(doc);
    expect(result.belowMinimum[0]).toBe(false);
    expect(result.kpis.firstBelow).toBe("2026-03");
    expect(result.kpis.lowestAll!.amount).toBe(Math.min(...result.closing.slice(2)));
    const goal = result.goals[0];
    expect(goal.projected).toBe(result.closing[11]);
    expect(goal.shortfall).toBe(9_000_000 - result.closing[11]);
    expect(goal.perMonth).toBe(Math.ceil(goal.shortfall! / 9));
  });

  it("works as a plain worksheet without Actual", () => {
    let doc = { ...createPlanDocument({ name: "Manual", startMonth: "2026-01", years: 1, useActuals: false }), openingBalance: 100_000 };
    doc = { ...doc, rows: [{ ...createRow({ name: "Pay", section: "income" }), rules: [{ id: "r", amount: 50_000, start: "2026-01", every: 1 }] }, createRow({ name: "Rent", section: "expenses" })] };
    doc = setCells(doc, [{ rowId: rowOf(doc, "Rent").id, month: "2026-02", amount: 70_000 }]);
    const result = run(doc, null);
    expect(result.kinds.every((k) => k === "forecast")).toBe(true);
    expect(result.closing.slice(0, 3)).toEqual([150_000, 130_000, 180_000]);
    expect(result.kpis.cashNow).toBe(100_000);
  });
});

describe("rows that follow what an earlier row follows", () => {
  const rows = (second: { basis: Parameters<typeof createRow>[0]["basis"] }) => {
    const first = createRow({ name: "Food", section: "expenses", links: { categories: ["groceries"] } });
    const later = createRow({ name: "Card", section: "expenses", links: { categories: ["groceries"] }, ...second });
    return { first, later, doc: plan((d) => ({ ...d, rows: [first, later] })) };
  };
  const notesOf = (doc: PlanDocument) => linkNotes(doc, run(doc), placeActuals(doc, household()));

  it("is only a note when nothing is counted twice, and names the earlier row", () => {
    const { later, first, doc } = rows({ basis: { kind: "budget" } });
    const note = notesOf(doc).get(later.id)!;
    expect(note).toMatchObject({ severity: "note", items: [{ kind: "category", name: "Groceries", heldBy: { id: first.id, name: "Food" } }] });
    expect(note.summary).toContain("“Food”");
  });

  it("warns when both rows forecast it, or when the later row needs history it does not have", () => {
    const both = rows({ basis: { kind: "budget" } });
    const typed = setCells(both.doc, [{ rowId: both.first.id, month: "2026-06", amount: 5_000 }]);
    expect(notesOf(typed).get(both.later.id)).toMatchObject({ severity: "warning", reason: expect.stringContaining("twice") });
    const average = rows({ basis: { kind: "average", months: 3 } });
    expect(notesOf(average.doc).get(average.later.id)).toMatchObject({ severity: "warning", reason: expect.stringContaining("average") });
  });
});

describe("a budget row paid after the spending (a card paid next month)", () => {
  it("takes the card's recorded purchases of a month that is over, then the month in progress, then the budget", () => {
    const withLag = (lag?: 1 | 2) => {
      const row = createRow({ name: "Card", section: "expenses", basis: lag ? { kind: "budget", lag } : { kind: "budget" }, links: { categories: ["groceries"] } });
      const doc = plan((d) => ({ ...d, rows: [row] }));
      return run(doc).rows.get(row.id)!;
    };
    // Today is 15 Mar 2026. Groceries went on the card: 200.00 in Feb, 100.00 so far in March. The budget: 1,100.00 in March, 1,200.00 from April.
    const lagged = withLag(1);
    expect(lagged.plan[2]).toBe(20_000); // March: paid for February's card spending
    expect(lagged.plan[3]).toBe(110_000); // April: March is in progress, so the larger of 100.00 so far and its budget
    expect(lagged.plan[4]).toBe(120_000); // May: April's budget
    expect(lagged.plan[5]).toBe(120_000); // June: May is not budgeted, so the last budgeted month repeats
    expect(lagged.problem).toBeUndefined();
    // Without a lag the same row follows the budget of its own month.
    expect(withLag().plan.slice(3, 5)).toEqual([120_000, 120_000]);
  });
});

describe("key figures when today is outside the plan", () => {
  it("looks ahead over nothing once the plan has ended, and as usual when it starts later", () => {
    // Today is 15 Mar 2026: a plan of 2025 is over, a plan starting in 2027 has not begun.
    const ended = run({ ...plan(), startMonth: "2025-01" });
    expect(ended.currentIndex).toBe(-1);
    expect(ended.kpis.next12.months).toBe(0);
    expect(ended.kpis).toMatchObject({ lowest12: null, lowestAll: null, firstBelow: null });
    expect(ended.kpis.endOfPlan.month).toBe("2025-12");

    const future = run({ ...plan(), startMonth: "2027-01", minimumCash: 10_000_000 });
    expect(future.currentIndex).toBe(-1);
    expect(future.kpis.next12.months).toBe(12);
    expect(future.kpis.lowest12).not.toBeNull();
    expect(future.kpis.firstBelow).toBe("2027-01");
  });
});

describe("whole loan repayments", () => {
  // Each month 300.00 of interest is recorded on its own line, in the Mortgage Interest category, next to the 1,000 transfer.
  const withInterest = (): Snapshot => {
    const snapshot = household();
    const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"];
    return {
      ...snapshot,
      categories: [...snapshot.categories, { id: "interest", name: "Mortgage Interest", groupId: "g-home", groupName: "Home", isIncome: false, hidden: false }],
      movement: [...snapshot.movement, ...months.map((month) => ({ month, accountId: "bank", categoryId: "interest", transferAccountId: null, amountMinor: -30_000, count: 1 }))],
      loanCosts: months.map((month) => ({ id: `i-${month}`, month, accountId: "bank", categoryId: "interest", amountMinor: -30_000, loanAccountId: "mortgage" })),
    };
  };
  const withHome = (count?: "principal") => plan((d) => ({
    ...d,
    rows: [...d.rows.filter((r) => r.name !== "Mortgage"), createRow({ name: "Mortgage", section: "debt", basis: count ? { kind: "loan", count } : { kind: "loan" }, links: { accounts: [{ id: "mortgage" }] } }), createRow({ name: "Home", section: "expenses", basis: { kind: "average", months: 3 }, links: { categoryGroups: ["g-home"] } })],
  }));

  it("counts the interest lines with the loan, not with their category, and forecasts the whole instalment", () => {
    const doc = withHome();
    const result = run(doc, withInterest());
    expect(result.rows.get(rowOf(doc, "Mortgage").id)!.actual[0]).toBe(130_000);
    expect(result.rows.get(rowOf(doc, "Home").id)!.actual[0]).toBe(0);
    expect(result.rows.get(rowOf(doc, "Home").id)!.typical).toBe(0);
    expect(result.rows.get(rowOf(doc, "Mortgage").id)!.values.slice(3, 6)).toEqual([130_000, 130_000, 45_000]);
    // Nothing is counted twice: the month still adds up to the change in cash.
    const flows = SECTIONS.reduce((sum, s) => sum + result.sectionTotals[s][0] * SECTION_SIGN[s], 0);
    expect(result.closing[0] - result.opening[0]).toBe(flows);
  });

  it("keeps the interest in its category when only the principal is counted", () => {
    const doc = withHome("principal");
    const result = run(doc, withInterest());
    expect(result.rows.get(rowOf(doc, "Mortgage").id)!.actual[0]).toBe(100_000);
    expect(result.rows.get(rowOf(doc, "Home").id)!.actual[0]).toBe(30_000);
    expect(result.rows.get(rowOf(doc, "Mortgage").id)!.values[3]).toBe(100_000);
  });
});

describe("money borrowed from a loan", () => {
  // 20,000 drawn from the mortgage into the bank in January, next to the usual 1,000 repayment.
  const drawn = (): Snapshot => {
    const snapshot = household();
    return {
      ...snapshot,
      movement: [...snapshot.movement, { month: "2026-01", accountId: "bank", categoryId: null, transferAccountId: "mortgage", amountMinor: 2_000_000, count: 1 }],
      transfersIn: [...snapshot.transfersIn, { month: "2026-01", accountId: "bank", transferAccountId: "mortgage", amountMinor: 2_000_000 }],
    };
  };

  it("is income, never a negative repayment, whether or not a row follows it", () => {
    const doc = plan();
    const result = run(doc, drawn());
    expect(result.rows.get(rowOf(doc, "Mortgage").id)!.actual[0]).toBe(100_000);
    expect(result.unplanned.income[0]).toBe(2_000_000 + 5_000);
    const withRow = plan((d) => ({ ...d, rows: [...d.rows, createRow({ name: "Drawn", section: "income", links: { accounts: [{ id: "mortgage", flow: "in" }] } })] }));
    const followed = run(withRow, drawn());
    expect(followed.rows.get(rowOf(withRow, "Drawn").id)!.actual[0]).toBe(2_000_000);
    expect(followed.rows.get(rowOf(withRow, "Mortgage").id)!.actual[0]).toBe(100_000);
    expect(placeActuals(withRow, drawn()).conflicts).toEqual([]);
    const built = buildPlanFromActuals(drawn(), { name: "Mine", startMonth: "2026-01", years: 1, detail: "groups" });
    expect(built.rows.filter((r) => r.links.accounts[0]?.id === "mortgage").map((r) => [r.section, r.name, r.links.accounts[0].flow])).toEqual([["debt", "mortgage", "out"], ["income", "mortgage borrowed", "in"]]);
  });
});

describe("counting a transaction in another month", () => {
  // 150.00 of groceries dated 1 Feb that belonged to January.
  const late = { id: "t-late", date: "2026-02-01", accountId: "bank", categoryId: "groceries", transferAccountId: null, amountMinor: -15_000 };

  it("follows a #YYYY-MM tag, keeps the real balances, and shows what was moved", () => {
    const doc = plan();
    const snapshot = { ...household(), shifts: [{ ...late, tagMonth: "2026-01" }] };
    const base = run(doc, household()), result = run(doc, snapshot);
    const living = result.rows.get(rowOf(doc, "Living").id)!;
    expect(living.actual.slice(0, 2)).toEqual([115_000, 85_000]);
    expect(result.moved.slice(0, 3)).toEqual([15_000, -15_000, 0]);
    expect(result.closing).toEqual(base.closing);
    const placed = placeActuals(doc, snapshot);
    expect(placed.shifted.get("t-late")).toEqual({ from: "2026-02", to: "2026-01", byTag: true });
    expect(placed.shiftNotes.get(`${rowOf(doc, "Living").id}|2026-01`)).toEqual([{ id: "t-late", amount: 15_000, from: "2026-02", to: "2026-01" }]);
  });

  it("lets the plan move a transaction, or cancel its tag, and never into a month that has not ended", () => {
    const tagged = { ...household(), shifts: [{ ...late, tagMonth: "2026-01" as string | null }] };
    const untagged = { ...household(), shifts: [{ ...late, tagMonth: null }] };
    const moved = { ...plan(), moves: { "t-late": "2026-01" } };
    expect(run(moved, untagged).rows.get(rowOf(moved, "Living").id)!.actual[0]).toBe(115_000);
    const cancelled = { ...plan(), moves: { "t-late": "2026-02" } };
    expect(run(cancelled, tagged).rows.get(rowOf(cancelled, "Living").id)!.actual[0]).toBe(100_000);
    const future = { ...plan(), moves: { "t-late": "2026-06" } };
    expect(run(future, untagged).moved.every((v) => v === 0)).toBe(true);
  });
});

describe("building a plan from Actual", () => {
  it("creates a row for everything that moved cash, and leaves nothing unplanned but uncategorized entries", () => {
    const snapshot = household();
    const doc = buildPlanFromActuals(snapshot, { name: "Mine", startMonth: "2026-01", years: 2, detail: "groups" });
    expect(doc.rows.map((r) => [r.section, r.name, r.basis.kind])).toEqual([
      ["income", "Salary", "average"], ["expenses", "Living", "average"], ["savings", "broker", "average"], ["debt", "mortgage", "loan"],
    ]);
    // A whole repayment is the default for a loan with a schedule.
    expect(doc.rows[3].basis).toEqual({ kind: "loan" });
    // With cards outside the plan, only the payments to them count.
    const outside = buildPlanFromActuals(snapshot, { name: "Mine", startMonth: "2026-01", years: 2, detail: "groups", cards: "outside" });
    expect(outside.accountRoles).toEqual({ card: "outside" });
    expect(outside.rows.map((r) => r.name)).toContain("card payments");
    expect(run(outside, snapshot).rows.get(outside.rows.find((r) => r.name === "Living")!.id)!.actual[0]).toBe(80_000);
    const result = run(doc, snapshot);
    expect(result.unplanned.expenses[1]).toBe(0);
    expect(result.unplanned.debt[1]).toBe(0);
    expect(parsePlanDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
});

describe("plan documents", () => {
  it("round-trips through a file and refuses what it cannot read", () => {
    const doc = setCells(plan(), [{ rowId: plan().rows[0].id, month: "2026-02", amount: 1 }]);
    expect(importPlanJson(exportPlanJson(doc))).toEqual(doc);
    expect(() => importPlanJson("{}")).toThrow("not a cashflow plan exported");
    expect(() => parsePlanDocument({ ...doc, schemaVersion: 2 })).toThrow("newer version");
    expect(() => parsePlanDocument({ ...doc, months: 601 })).toThrow("6 to 600 months");
    expect(() => parsePlanDocument({ ...doc, months: 5 })).toThrow("6 to 600 months");
    // A plan saved before the length was in months says how many years it covers.
    expect(parsePlanDocument({ ...doc, months: undefined, years: 2 }).months).toBe(24);
    expect(() => parsePlanDocument({ ...doc, months: undefined, years: 51 })).toThrow("6 to 600 months");
    expect(() => parsePlanDocument({ ...doc, rows: [{ ...doc.rows[0], cells: { "2026-02": 1.5 } }] })).toThrow("not a valid amount");
  });

  it("drops typed amounts outside a shortened plan", () => {
    let doc = plan();
    doc = setCells(doc, [{ rowId: doc.rows[0].id, month: "2026-11", amount: 5 }, { rowId: doc.rows[0].id, month: "2026-02", amount: 7 }]);
    expect(setHorizon(doc, "2026-06", 12).rows[0].cells).toEqual({ "2026-11": 5 });
    // A plan can end in any month: eight months from January stop in August.
    const short = setHorizon(doc, "2026-01", 8);
    expect(planEndMonth(short)).toBe("2026-08");
    expect(short.rows[0].cells).toEqual({ "2026-02": 7 });
    expect(run(short, null).months).toHaveLength(8);
  });

  it("reads amounts as people type and paste them", () => {
    expect(parseAmount("1,250.50")).toBe(125_050);
    expect(parseAmount("(300)")).toBe(-30_000);
    expect(parseAmount("-0.005")).toBe(-1);
    expect(parseAmount(" 12 ")).toBe(1_200);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});
