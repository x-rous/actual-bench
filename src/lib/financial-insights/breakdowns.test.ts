import { classBalances, compositionSeries, debtRepayments, netWorthSteps, spendingGroups, cashBridgeLines, heatBand, monthlyFlows, payeeSpending, spendingBreakdown, spendingFacts, type CategoryInfo } from "./breakdowns";
import { drillScope, type DrillKind, type DrillTarget } from "./drill";
import { buildLedger, summarize, type AccountFact, type FinancialFacts, type MovementRow, type ReclassifiedRow } from "./measures";
import { resolvePeriod } from "./period";

const today = "2026-11-18";
const accounts: AccountFact[] = [
  { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false },
  { id: "sav", name: "Savings", accountClass: "bank", treatment: null, offBudget: true },
  { id: "inv", name: "Brokerage", accountClass: "investment", treatment: "non-current-investment", offBudget: true },
  { id: "loan", name: "Mortgage", accountClass: "loan", treatment: null, offBudget: true },
  { id: "visa", name: "Visa", accountClass: "credit-card", treatment: null, offBudget: false },
  { id: "house", name: "House", accountClass: "property", treatment: null, offBudget: true },
];
const categories = new Map<string, CategoryInfo>([
  ["salary", { id: "salary", name: "Salary", groupName: "Income", hidden: false, isIncome: true }],
  ["food", { id: "food", name: "Food", groupName: "Daily", hidden: false, isIncome: false }],
  ["tuition", { id: "tuition", name: "Tuition", groupName: "Education", hidden: true, isIncome: false }],
]);

/** A raw Actual transaction, the unit the aggregates and the drilldown queries both read. */
type Tx = { id: string; date: string; account: string; category: string | null; payee: string | null; payeeName?: string; transferAcct?: string | null; /** A transfer payee with no linked counterpart row: transfer_id is empty. */ unlinked?: boolean; amount: number };
const tx = (id: string, date: string, account: string, amount: number, extra: Partial<Tx> = {}): Tx => ({ id, date, account, category: null, payee: null, transferAcct: null, amount, ...extra });
const STARTING = "Starting Balance";

const txs: Tx[] = [
  tx("start", "2026-09-01", "sav", 900_000, { payee: "p-start", payeeName: STARTING }),
  tx("salary", "2026-10-01", "chk", 500_000, { category: "salary", payee: "p1" }),
  tx("food", "2026-10-03", "chk", -30_000, { category: "food", payee: "p2" }),
  tx("refund", "2026-10-04", "chk", 5_000, { category: "food", payee: "p2" }),
  tx("uout", "2026-10-05", "chk", -7_000),
  tx("uin", "2026-10-06", "chk", 2_000),
  tx("ident", "2026-10-07", "sav", 4_000),
  tx("to-inv", "2026-10-08", "chk", -100_000, { transferAcct: "inv", payee: "t-inv" }),
  tx("from-chk-inv", "2026-10-08", "inv", 100_000, { transferAcct: "chk", payee: "t-chk" }),
  // Money back from the same investment account in the same month: a contribution and a withdrawal must not net into one figure.
  tx("from-inv", "2026-10-08", "chk", 30_000, { transferAcct: "inv", payee: "t-inv" }),
  tx("from-inv-leg", "2026-10-08", "inv", -30_000, { transferAcct: "chk", payee: "t-chk" }),
  // A transfer payee whose other side was never recorded (no transfer_id), carrying an expense category: still a transfer.
  tx("one-sided", "2026-10-15", "chk", -700, { category: "food", transferAcct: "sav", unlinked: true, payee: "t-sav" }),
  tx("to-loan", "2026-10-09", "chk", -80_000, { transferAcct: "loan", payee: "t-loan" }),
  tx("from-chk-loan", "2026-10-09", "loan", 80_000, { transferAcct: "chk", payee: "t-chk" }),
  tx("to-scratch", "2026-10-10", "chk", -20_000, { transferAcct: "scratch", payee: "t-scratch" }),
  tx("scratch-leg", "2026-10-10", "scratch", 20_000, { transferAcct: "chk", payee: "t-chk" }),
  // A gain recorded in an investment account with no category: an investment result, not an unidentified movement.
  tx("inv-gain", "2026-10-09", "inv", 40_000),
  tx("rv", "2026-10-11", "house", 300_000),
  tx("tuition", "2026-10-12", "chk", -10_000, { category: "tuition", payee: "p3" }),
  // A transfer can carry a category; it is a transfer, so it is neither spending nor part of the category.
  tx("cat-xfer", "2026-10-14", "chk", -1_000, { category: "food", transferAcct: "sav", payee: "t-sav" }),
  tx("cat-xfer-leg", "2026-10-14", "sav", 1_000, { transferAcct: "chk", payee: "t-chk" }),
  tx("nov-food", "2026-11-02", "chk", -4_000, { category: "food", payee: "p2" }),
];
const reclassified: ReclassifiedRow[] = [{ id: "rv", payeeId: null, month: "2026-10", accountId: "house", categoryId: null, amountMinor: 300_000, to: "valueChange" }];

function factsFrom(rows: Tx[]): FinancialFacts {
  const movement = new Map<string, MovementRow>();
  const uncategorizedIn = new Map<string, { month: string; accountId: string; amountMinor: number }>();
  const starting: { month: string; accountId: string; amountMinor: number }[] = [];
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    if (r.payeeName === STARTING) { starting.push({ month, accountId: r.account, amountMinor: r.amount }); continue; }
    const key = [month, r.account, r.category, r.transferAcct].join("|");
    const cell = movement.get(key) ?? { month, accountId: r.account, categoryId: r.category, transferAccountId: r.transferAcct ?? null, amountMinor: 0, count: 0 };
    cell.amountMinor += r.amount; cell.count += 1; movement.set(key, cell);
    if (r.category === null && !r.transferAcct && r.amount > 0) {
      const k = `${month}|${r.account}`;
      const c = uncategorizedIn.get(k) ?? { month, accountId: r.account, amountMinor: 0 };
      c.amountMinor += r.amount; uncategorizedIn.set(k, c);
    }
  }
  const transfersIn = new Map<string, { month: string; accountId: string; transferAccountId: string; amountMinor: number }>();
  for (const r of rows) {
    if (r.payeeName === STARTING || !r.transferAcct || r.amount <= 0) continue;
    const k = `${r.date.slice(0, 7)}|${r.account}|${r.transferAcct}`;
    const c = transfersIn.get(k) ?? { month: r.date.slice(0, 7), accountId: r.account, transferAccountId: r.transferAcct, amountMinor: 0 };
    c.amountMinor += r.amount; transfersIn.set(k, c);
  }
  return {
    accounts, excluded: new Set(["scratch"]), incomeCategories: new Set(["salary"]), movement: [...movement.values()], startingBalances: starting,
    uncategorizedIn: [...uncategorizedIn.values()], transfersIn: [...transfersIn.values()], reclassified, loanCosts: [],
  };
}

const facts = factsFrom(txs);
const ledger = buildLedger(facts);
const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-11" }, today, ledger.firstMonth);
const review = { unavailableReason: null, rowCount: 0 };

describe("financial insights: month-by-month figures", () => {
  it("add up to the period's received and spent, which the Summary shows", () => {
    const summary = summarize(ledger, period, review);
    const monthly = monthlyFlows(ledger, period, today, true);
    expect(monthly.reduce((a, m) => a + m.received, 0)).toBe(summary.received);
    expect(monthly.reduce((a, m) => a + m.spent, 0)).toBe(summary.spent);
    expect(monthly.map((m) => m.partial)).toEqual([false, false, true]);
    expect(monthly[1]).toMatchObject({ received: 502_000, spent: 42_000, kept: 460_000, contributed: 100_000, withdrawn: 30_000, repaid: 80_000, borrowed: 0 });
    expect(monthlyFlows(ledger, period, today, false).every((m) => m.kept === null)).toBe(true);
  });
});

describe("financial insights: the spending breakdown", () => {
  const summary = summarize(ledger, period, review);
  const monthly = monthlyFlows(ledger, period, today, true);
  const breakdown = spendingBreakdown(ledger, period, categories, monthly);

  it("ties to Money spent exactly: refunds lower a category, income is out, uncategorized is its own row", () => {
    expect(breakdown.totalMinor).toBe(summary.spent);
    const byName = Object.fromEntries(breakdown.rows.map((r) => [r.name, r.totalMinor]));
    expect(byName).toEqual({ Food: 29_000, Tuition: 10_000, Uncategorized: 7_000 });
    expect(breakdown.rows.map((r) => r.name)).toEqual(["Food", "Tuition", "Uncategorized"]);
    expect(breakdown.hasHidden).toBe(true);
    expect(breakdown.rows.find((r) => r.name === "Tuition")?.hidden).toBe(true);
  });

  it("takes a registry-classified categorized row back out of its category", () => {
    const withRow = factsFrom([...txs, tx("rv-food", "2026-10-13", "house", -50_000, { category: "food" })]);
    const f2 = { ...withRow, reclassified: [...reclassified, { id: "rv-food", payeeId: null, month: "2026-10", accountId: "house", categoryId: "food", amountMinor: -50_000, to: "valueChange" as const }] };
    const l2 = buildLedger(f2);
    const m2 = monthlyFlows(l2, period, today, true);
    expect(spendingBreakdown(l2, period, categories, m2).totalMinor).toBe(summarize(l2, period, review).spent);
    expect(spendingBreakdown(l2, period, categories, m2).rows.find((r) => r.name === "Food")?.totalMinor).toBe(29_000);
  });

  it("averages over complete months only, and shows a pace only with six or more", () => {
    const f = spendingFacts(breakdown, monthly);
    expect(f.averageMonths).toBe(1);
    expect(f.averageMinor).toBe(42_000);
    expect(f.largest).toEqual({ name: "Food", totalMinor: 29_000 });
    expect(f.pace).toEqual({ state: "unavailable", reason: "Needs at least six complete months in the period" });
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
    const long = factsFrom([tx("s", "2026-01-01", "chk", 5_000_000, { category: "salary" }), ...months.map((m, i) => tx(`e${i}`, `${m}-10`, "chk", -(10_000 + i * 1_000), { category: "food" }))]);
    const ll = buildLedger(long);
    const p = resolvePeriod({ kind: "custom", startMonth: "2026-01", endMonth: "2026-06" }, today, ll.firstMonth);
    const mm = monthlyFlows(ll, p, today, true);
    const pace = spendingFacts(spendingBreakdown(ll, p, categories, mm), mm).pace;
    expect(pace).toEqual({ state: "ready", earliestMinor: 11_000, latestMinor: 14_000, changePercent: 27.3 });
  });

  it("places a month against its own row average, as below, near or above, never as good or bad", () => {
    expect([heatBand(40, 100), heatBand(70, 100), heatBand(90, 100), heatBand(100, 100), heatBand(110, 100), heatBand(125, 100), heatBand(150, 100), heatBand(300, 100), heatBand(10, null)]).toEqual([-4, -3, -1, 0, 1, 2, 3, 4, 0]);
  });
});

describe("financial insights: the cash-change bridge", () => {
  it("starts at opening cash and ends at closing cash with nothing left unattributed when the facts are complete", () => {
    const summary = summarize(ledger, period, review);
    const b = cashBridgeLines(summary);
    expect(b.unattributedMinor).toBe(0);
    expect(b.openingMinor + b.lines.reduce((a, l) => a + l.amountMinor, 0) + b.unattributedMinor).toBe(b.closingMinor);
    expect(b.lines.find((l) => l.key === "contributed")?.amountMinor).toBe(-100_000);
    expect(b.lines.find((l) => l.key === "withdrawn")?.amountMinor).toBe(30_000);
    expect(b.lines.find((l) => l.key === "repaid")?.amountMinor).toBe(-80_000);
    expect(b.lines.find((l) => l.key === "excluded")?.amountMinor).toBe(-20_000);
  });

  it("keeps a genuine difference visible instead of forcing it to zero", () => {
    // A registry value change recorded against a cash account with no movement behind it cannot be placed on any line.
    const odd = { ...facts, reclassified: [...reclassified, { id: "odd", payeeId: null, month: "2026-10", accountId: "chk", categoryId: "food", amountMinor: 12_345, to: "valueChange" as const }] };
    const b = cashBridgeLines(summarize(buildLedger(odd), period, review));
    expect(b.unattributedMinor).not.toBe(0);
    expect(b.openingMinor + b.lines.reduce((a, l) => a + l.amountMinor, 0) + b.unattributedMinor).toBe(b.closingMinor);
  });
});

describe("financial insights: spending by payee", () => {
  it("totals spending categories by payee, leaving out income and excluded accounts and registry rows", () => {
    const rows = [
      { payeeId: "p2", categoryId: "food", accountId: "chk", amountMinor: -34_000 + 5_000, count: 3 },
      { payeeId: "p1", categoryId: "salary", accountId: "chk", amountMinor: 500_000, count: 1 },
      { payeeId: "p3", categoryId: "tuition", accountId: "chk", amountMinor: -10_000, count: 1 },
      { payeeId: null, categoryId: "food", accountId: "chk", amountMinor: -1_000, count: 1, isChild: false },
      { payeeId: "p9", categoryId: "food", accountId: "scratch", amountMinor: -99_000, count: 1 },
    ];
    const result = payeeSpending(rows, ledger, period, categories, new Map([["p2", "Market"], ["p3", "School"]]));
    expect(result.payees.map((p) => [p.name, p.totalMinor, p.count, p.topCategory])).toEqual([["Market", 29_000, 3, "Food"], ["School", 10_000, 1, "Tuition"]]);
    expect(result.noPayee).toMatchObject({ name: "No payee", totalMinor: 1_000, count: 1, splitParts: 0 });
  });
});

// ─── Each drill scope adds up to its figure ───────────────────────────────────

type Cond = Record<string, unknown>;
const FIELD: Record<string, (t: Tx) => unknown> = { category: (t) => t.category, account: (t) => t.account, payee: (t) => t.payee, id: (t) => t.id, "payee.transfer_acct": (t) => t.transferAcct ?? null, amount: (t) => t.amount };
/** The few ActualQL operators the drill scopes use, evaluated on a raw transaction. */
function matches(t: Tx, cond: Cond): boolean {
  return Object.entries(cond).every(([key, value]) => {
    if (key === "$and") return (value as Cond[]).every((c) => matches(t, c));
    if (key === "$or") return (value as Cond[]).some((c) => matches(t, c));
    const actual = FIELD[key](t);
    if (value === null || typeof value !== "object") return actual === value;
    return Object.entries(value as Cond).every(([op, v]) => {
      if (op === "$oneof") return (v as unknown[]).includes(actual);
      if (op === "$ne") return actual !== v;
      if (op === "$gt") return (actual as number) > (v as number);
      if (op === "$lt") return (actual as number) < (v as number);
      throw new Error(`operator ${op}`);
    });
  });
}

function listed(target: Exclude<DrillTarget, { kind: "inTransit" }>) {
  const scope = drillScope(target, { ledger, period, today, reclassifiedIds: new Set(reclassified.map((r) => r.id)) });
  const { constraints: c, defaults: d } = scope;
  const rows = txs.filter((t) => {
    if (d.date?.from && t.date < d.date.from) return false;
    if (d.date?.to && t.date > d.date.to) return false;
    if ((c.excludeAccountIds ?? []).includes(t.account)) return false;
    if (c.excludeTransfers && t.transferAcct && !t.unlinked) return false;
    if (c.excludeTransferPayees && t.transferAcct) return false;
    if (c.transfersOnly && (!t.transferAcct || t.unlinked)) return false;
    if (c.requireCategory && t.category === null) return false;
    if (c.amountSign === "negative" && t.amount >= 0) return false;
    if (c.amountSign === "positive" && t.amount <= 0) return false;
    if (d.categories?.ids.length && !d.categories.ids.includes(t.category ?? "")) return false;
    if (d.payees?.none && t.payee !== null) return false;
    if (d.payees?.ids.length && !d.payees.ids.includes(t.payee ?? "")) return false;
    if (c.where && !matches(t, c.where as Cond)) return false;
    if (c.excludeStartingBalance && t.payeeName === STARTING) return false;
    if (c.excludeIds?.includes(t.id)) return false;
    return !scope.rowFilter || scope.rowFilter({ id: t.id, payeeName: t.payeeName ?? null } as never);
  });
  return { scope, total: rows.reduce((a, t) => a + t.amount, 0), ids: rows.map((t) => t.id) };
}

describe("financial insights: drilldown scopes", () => {
  const kinds: DrillKind[] = ["received", "spent", "uncategorizedIn", "uncategorizedOut", "unidentified", "investmentResults", "valueChange", "excludedTransfer", "contributed", "withdrawn", "repaid", "borrowed", "cashOperating", "cardPaid", "fixedMoved", "assetsMoved", "liabilitiesMoved"];
  it.each(kinds)("%s lists exactly the entries that make up its figure", (kind) => {
    const whole = listed({ kind });
    expect(whole.total).toBe(whole.scope.expectedMinor);
    const october = listed({ kind, month: "2026-10" });
    expect(october.total).toBe(october.scope.expectedMinor);
  });

  it("opens income and spending in cash accounts as the entries of cash accounts only", () => {
    const whole = listed({ kind: "cashOperating" });
    expect(whole.scope.expectedMinor).not.toBe(0);
    expect(whole.ids).not.toContain("one-sided");
    expect(whole.ids).not.toContain("to-inv");
  });

  it("treats a transfer payee with no linked counterpart as a transfer in every list, so the list adds up to the figure", () => {
    const spent = listed({ kind: "spent", month: "2026-10" });
    expect(spent.ids).not.toContain("one-sided");
    expect(spent.total).toBe(spent.scope.expectedMinor);
    expect(listed({ kind: "category", categoryIds: ["food"], name: "Food", amountMinor: 25_000, month: "2026-10" }).ids).not.toContain("one-sided");
  });

  it("splits investments and loans by direction without netting a contribution against a withdrawal", () => {
    expect(listed({ kind: "contributed", month: "2026-10" }).ids).toEqual(["to-inv"]);
    expect(listed({ kind: "withdrawn", month: "2026-10" }).ids).toEqual(["from-inv"]);
    expect(listed({ kind: "repaid", month: "2026-10" }).ids).toEqual(["to-loan"]);
    expect(listed({ kind: "borrowed", month: "2026-10" }).ids).toEqual([]);
  });

  it("leaves starting balances, excluded accounts, future months and registry rows out of income and spending", () => {
    expect(listed({ kind: "unidentified" }).ids).toEqual(["ident"]);
    expect(listed({ kind: "investmentResults" }).ids).toEqual(["inv-gain"]);
    expect(listed({ kind: "spent", month: "2026-10" }).ids.sort()).toEqual(["food", "refund", "tuition", "uout"].sort());
    expect(listed({ kind: "received" }).ids.sort()).toEqual(["salary", "uin"]);
    expect(listed({ kind: "excludedTransfer" }).ids).toEqual(["to-scratch"]);
  });

  it("opens a whole group, or one group in one month, with exactly the clicked figure", () => {
    const daily = listed({ kind: "category", categoryIds: ["food"], name: "Daily", amountMinor: 29_000 });
    expect(daily.total).toBe(-29_000);
    expect(daily.total).toBe(daily.scope.expectedMinor);
    const two = listed({ kind: "category", categoryIds: ["food", "tuition"], name: "Two groups", amountMinor: 39_000 });
    expect(two.total).toBe(two.scope.expectedMinor);
    expect(two.scope.insights?.hide).toEqual(["groups"]);
    const month = listed({ kind: "category", categoryIds: ["food", "tuition"], name: "Both", amountMinor: 35_000, month: "2026-10" });
    expect(month.ids.sort()).toEqual(["food", "refund", "tuition"].sort());
    expect(month.total).toBe(month.scope.expectedMinor);
    const uncategorized = listed({ kind: "category", categoryIds: [], includeUncategorized: true, name: "Uncategorized", amountMinor: 7_000 });
    expect(uncategorized.ids).toEqual(["uout"]);
    expect(uncategorized.total).toBe(uncategorized.scope.expectedMinor);
  });

  it("lists a category or a payee with the figure it sits on", () => {
    const food = listed({ kind: "category", categoryIds: ["food"], name: "Food", amountMinor: 25_000, month: "2026-10" });
    expect(food.ids.sort()).toEqual(["food", "refund"]);
    expect(food.total).toBe(food.scope.expectedMinor);
    const market = listed({ kind: "payee", payeeId: "p2", name: "Market", amountMinor: 29_000 });
    expect(market.total).toBe(market.scope.expectedMinor);
  });
});

describe("financial insights: Wealth & investments drilldown scopes", () => {
  it("lists the funding and withdrawals of the portfolio, and of one account, from the account's side, adding up to the bridge", () => {
    for (const month of [undefined, "2026-10"]) {
      const funding = listed({ kind: "contributed", portfolio: true, month });
      expect(funding.ids).toEqual(["from-chk-inv"]);
      expect(funding.total).toBe(100_000);
      expect(funding.total).toBe(funding.scope.expectedMinor);
      const withdrawn = listed({ kind: "withdrawn", accountId: "inv", month });
      expect(withdrawn.ids).toEqual(["from-inv-leg"]);
      expect(withdrawn.total).toBe(-30_000);
      expect(withdrawn.total).toBe(withdrawn.scope.expectedMinor);
    }
  });

  it("lists the investment activity of an account, adding up to the bridge", () => {
    const activity = listed({ kind: "investmentResults", accountId: "inv" });
    expect(activity.ids).toEqual(["inv-gain"]);
    expect(activity.total).toBe(40_000);
    expect(activity.total).toBe(activity.scope.expectedMinor);
  });

});

describe("financial insights: My budget drilldown scopes", () => {
  it("opens Actual's own spending for a category: on-budget entries, transfers that carry the category included", () => {
    // Food in October: -30,000 spent, +5,000 refunded, and two entries Actual counts that Spending does not (the one-sided transfer and the categorized transfer).
    const cell = listed({ kind: "budgetCell", categoryIds: ["food"], name: "Food", amountMinor: 26_700, month: "2026-10" });
    expect(cell.ids.sort()).toEqual(["cat-xfer", "food", "one-sided", "refund"]);
    expect(cell.total).toBe(-26_700);
    expect(cell.total).toBe(cell.scope.expectedMinor);
  });

  it("runs from the first month through the last, and several categories at once", () => {
    const range = listed({ kind: "budgetCell", categoryIds: ["food"], name: "Food", amountMinor: 30_700, month: "2026-10", throughMonth: "2026-11" });
    expect(range.total).toBe(-30_700);
    expect(range.total).toBe(range.scope.expectedMinor);
    const both = listed({ kind: "budgetCell", categoryIds: ["food", "tuition"], name: "Two", amountMinor: 36_700, month: "2026-10" });
    expect(both.total).toBe(both.scope.expectedMinor);
  });

  it("opens a set of categories over a range of months with Spending's own figure, as the hidden part does", () => {
    const range = listed({ kind: "category", categoryIds: ["food", "tuition"], name: "Hidden categories", amountMinor: 35_000, month: "2026-09", throughMonth: "2026-10" });
    expect(range.total).toBe(-35_000);
    expect(range.total).toBe(range.scope.expectedMinor);
  });

  it("opens the two explained parts of the difference from Spending", () => {
    const transfers = listed({ kind: "budgetGap", part: "categorizedTransfers", amountMinor: 1_700, month: "2026-10", throughMonth: "2026-10" });
    expect(transfers.ids.sort()).toEqual(["cat-xfer", "one-sided"]);
    expect(transfers.total).toBe(transfers.scope.expectedMinor);
    const off = listed({ kind: "budgetGap", part: "offBudget", amountMinor: 0, month: "2026-10", throughMonth: "2026-10" });
    expect(off.ids).toEqual([]);
    const uncategorized = listed({ kind: "uncategorizedOut", month: "2026-09", throughMonth: "2026-10" });
    expect(uncategorized.total).toBe(uncategorized.scope.expectedMinor);
  });
});

describe("financial insights: category groups, what changed net worth, debt repayments", () => {
  const summary = summarize(ledger, period, review);
  const monthly = monthlyFlows(ledger, period, today, true);
  const breakdown = spendingBreakdown(ledger, period, categories, monthly);

  it("gives the ten largest groups a colour slot each and merges the rest into Other groups, with totals that still add up", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `Cat ${i}`, group: `Group ${i}`, hidden: false, byMonth: [1000 * (12 - i)], counts: [i + 1], totalMinor: 1000 * (12 - i), averageMinor: null }));
    const g = spendingGroups({ months: ["2026-10"], rows, totalMinor: rows.reduce((a, r) => a + r.totalMinor, 0), hasHidden: false });
    expect(g.groups.map((x) => x.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10]);
    expect(g.stacked.map((x) => x.name)).toEqual([...Array.from({ length: 10 }, (_, i) => `Group ${i}`), "Other groups"]);
    expect(g.stacked.at(-1)).toMatchObject({ slot: 10, totalMinor: 2000 + 1000, categoryIds: ["c10", "c11"], counts: [11 + 12] });
    expect(g.stacked.reduce((a, x) => a + x.totalMinor, 0)).toBe(rows.reduce((a, r) => a + r.totalMinor, 0));
  });

  it("builds groups from a real breakdown: the uncategorized entries are a group of their own and counts are unknown for it", () => {
    const g = spendingGroups(breakdown);
    expect(g.groups.map((x) => [x.name, x.totalMinor])).toEqual([["Daily", 29_000], ["Education", 10_000], ["Uncategorized", 7_000]]);
    expect(g.groups.find((x) => x.name === "Uncategorized")).toMatchObject({ hasUncategorized: true, categoryIds: [], counts: null });
    expect(g.groups.reduce((a, x) => a + x.totalMinor, 0)).toBe(summary.spent);
  });

  it("explains the change in net worth with steps that add up to it, and shows what they do not explain", () => {
    const n = netWorthSteps(summary);
    expect(n.openingMinor).toBe(0);
    expect(n.steps.reduce((a, s) => a + s.amountMinor, 0) + n.unexplainedMinor).toBe(n.changeMinor);
    expect(n.changeMinor).toBe(summary.netWorth.closing - summary.netWorth.opening);
    expect(n.unexplainedMinor).toBe(0);
    expect(n.steps.find((s) => s.key === "valueChange")).toMatchObject({ amountMinor: 300_000, drill: "valueChange" });
    expect(n.steps.find((s) => s.key === "excluded")).toMatchObject({ amountMinor: -20_000, drill: "excludedTransfer" });
    // A difference the components cannot place is passed on as it is, never folded into a step or set to zero.
    expect(netWorthSteps({ ...summary, unexplained: 500 }).unexplainedMinor).toBe(500);
  });

  it("reads an uncategorized entry in an investment account as an investment result, and in another off-budget account as unidentified", () => {
    expect(summary.flows).toMatchObject({ investmentResults: 40_000, investmentResultsCount: 1, unidentified: 4_000, unidentifiedCount: 1 });
    const n = netWorthSteps(summary);
    expect(n.steps.find((s) => s.key === "investmentResults")).toMatchObject({ amountMinor: 40_000, drill: "investmentResults" });
    expect(n.steps.reduce((a, s) => a + s.amountMinor, 0) + n.unexplainedMinor).toBe(n.changeMinor);
  });

  it("uses the balance before the first day as the start, so steps and balances share one boundary", () => {
    const october = resolvePeriod({ kind: "custom", startMonth: "2026-10", endMonth: "2026-10" }, today, ledger.firstMonth);
    const s = summarize(ledger, october, review);
    expect(s.opening.eligibleCash).toBe(900_000); // the September starting balance of savings, before 1 October
    const n = netWorthSteps(s);
    expect(n.openingMinor + n.changeMinor).toBe(s.netWorth.closing);
    expect(n.steps.some((x) => x.key === "opening")).toBe(false); // the starting balance is not a flow of October
    const sept = netWorthSteps(summarize(ledger, resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-09" }, today, ledger.firstMonth), review));
    expect(sept.steps.find((x) => x.key === "opening")?.amountMinor).toBe(900_000);
  });

  it("builds the month-end composition from the same balances as the summary", () => {
    const c = compositionSeries(ledger, period, summary.opening);
    const last = c.months.at(-1)!;
    expect(c.netWorth.at(-1)).toBe(summary.netWorth.closing);
    expect(Object.values(classBalances(summary.closing)).reduce((a, b) => a + b, 0)).toBe(summary.netWorth.closing);
    expect(last.cash).toBe(summary.closing.eligibleCash);
    expect(Object.values(c.opening).reduce((a, b) => a + b, 0)).toBe(summary.netWorth.opening);
  });

  it("keeps vehicles apart from other assets and credit cards apart from other liabilities", () => {
    const b = classBalances({ eligibleCash: 1, fixedDeposits: 2, investments: 3, property: 4, vehicle: 5, otherAssets: 6, loans: -7, cards: -8, otherLiabilities: -9 });
    expect(b).toEqual({ cash: 1, fixed: 2, invest: 3, property: 4, vehicle: 5, other: 6, loans: -7, cards: -8, otherLiability: -9 });
  });

  it("separates recorded principal from interest and fees, and says what cannot be identified", () => {
    const untracked = debtRepayments(ledger, period, new Set(), 80_000);
    expect(untracked.rows).toEqual([{ accountId: "loan", name: "Mortgage", tracked: false, principalMinor: 80_000, interestMinor: null, feesMinor: null }]);
    expect(untracked.complete).toBe(false);
    const costs = [{ month: "2026-10", accountId: "chk", categoryId: "x", amountMinor: -12_000, loanAccountId: "loan", kind: "interest" as const }, { month: "2026-10", accountId: "chk", categoryId: "x", amountMinor: -500, loanAccountId: "loan", kind: "fee" as const }];
    const tracked = debtRepayments(buildLedger({ ...facts, loanCosts: costs }), period, new Set(["loan"]), 80_000);
    expect(tracked).toMatchObject({ principalMinor: 80_000, interestMinor: 12_000, feesMinor: 500, complete: true, fromCashMinor: 80_000 });
  });
});
