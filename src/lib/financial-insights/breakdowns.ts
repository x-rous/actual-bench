import { computeFlows, ledgersByMonth, positionsAt, type Ledger, type Positions, type Summary } from "./measures";
import { resolvePeriod, type ResolvedPeriod } from "./period";

/**
 * Month-by-month figures, the spending breakdown and the cash-change bridge, for the Money in & out and Spending tabs.
 * They are built from the same row rules as `measures.ts` (`computeFlows` is called once per month here and once for the
 * whole period there), so the months always add up to the period's figures. Pure: no I/O.
 */

export type CategoryInfo = { id: string; name: string; groupName: string; hidden: boolean; isIncome: boolean; /** Position in the budget: groups in Actual's order, then their categories. */ order?: number };

export type MonthlyPoint = {
  month: string;
  /** False for a month before the budget has any movement. */
  hasData: boolean;
  partial: boolean;
  received: number;
  spent: number;
  /** Null while Money kept needs review. */
  kept: number | null;
  /** Spending recorded with no category, in on-budget accounts (part of `spent`). */
  uncategorizedSpent: number;
  /** Money put into investments from cash accounts. */
  contributed: number;
  /** Money received into cash accounts from investments. */
  withdrawn: number;
  /** Money paid from cash accounts to loans. */
  repaid: number;
  /** Money received into cash accounts from loans (borrowing). */
  borrowed: number;
};

const oneMonth = (month: string, today: string, firstMonth: string | null) => resolvePeriod({ kind: "custom", startMonth: month, endMonth: month }, today, firstMonth);

export function monthlyFlows(ledger: Ledger, period: ResolvedPeriod, today: string, keptAvailable: boolean): MonthlyPoint[] {
  const byMonth = ledgersByMonth(ledger, period.months);
  return period.months.map((month, index) => {
    const { flows, cashBridge } = computeFlows(byMonth.get(month)!, oneMonth(month, today, ledger.firstMonth));
    const received = flows.income + flows.uncategorizedIn;
    const spent = 0 - (flows.spending + flows.uncategorizedOut);
    return {
      month, hasData: !!ledger.firstMonth && month >= ledger.firstMonth, partial: period.partial && index === period.months.length - 1,
      received, spent, kept: keptAvailable ? received - spent : null, uncategorizedSpent: 0 - flows.uncategorizedOut,
      contributed: 0 - cashBridge.investmentOut, withdrawn: cashBridge.investmentIn, repaid: 0 - cashBridge.loanOut, borrowed: cashBridge.loanIn,
    };
  });
}

// ─── Spending ────────────────────────────────────────────────────────────────

export type SpendingRow = {
  /** Null is the "Uncategorized" row: spending with no category in on-budget accounts. */
  id: string | null;
  name: string;
  group: string;
  hidden: boolean;
  /** Spending per month of the period, a refund lowering it. Positive is money spent. */
  byMonth: number[];
  /** Entries per month (refunds included). Not known for the Uncategorized row. */
  counts: number[];
  totalMinor: number;
  /** Position in the budget (see `CategoryInfo.order`); the Uncategorized row has none and sorts last. */
  order?: number;
  /** The average over the complete months with data: the heatmap's baseline. Null when there is none. */
  averageMinor: number | null;
};

export type SpendingBreakdown = { months: string[]; rows: SpendingRow[]; totalMinor: number; hasHidden: boolean };

/** Spending by category and month. The total equals the Summary's Money spent exactly. */
export function spendingBreakdown(ledger: Ledger, period: ResolvedPeriod, categories: ReadonlyMap<string, CategoryInfo>, monthly: readonly MonthlyPoint[]): SpendingBreakdown {
  const { facts, account } = ledger;
  const slot = new Map(period.months.map((m, i) => [m, i]));
  const cells = new Map<string, number[]>();
  const tally = new Map<string, number[]>();
  const add = (categoryId: string, month: string, amount: number, entries: number) => {
    const index = slot.get(month);
    if (index === undefined) return;
    const row = cells.get(categoryId) ?? period.months.map(() => 0);
    const n = tally.get(categoryId) ?? period.months.map(() => 0);
    row[index] += amount; n[index] += entries;
    cells.set(categoryId, row); tally.set(categoryId, n);
  };
  for (const row of facts.movement) {
    if (row.transferAccountId || row.categoryId === null || !account.has(row.accountId) || facts.incomeCategories.has(row.categoryId)) continue;
    add(row.categoryId, row.month, 0 - row.amountMinor, row.count);
  }
  // A row the Asset Registry classifies has left spending; take it back out of its category.
  for (const row of facts.reclassified) {
    if (row.categoryId === null || !account.has(row.accountId) || facts.incomeCategories.has(row.categoryId)) continue;
    add(row.categoryId, row.month, row.amountMinor, -1);
  }
  const completeSlots = monthly.flatMap((m, i) => (m.hasData && !m.partial ? [i] : []));
  const finish = (values: number[], counts: number[]) => ({
    byMonth: values, counts, totalMinor: values.reduce((a, b) => a + b, 0),
    averageMinor: completeSlots.length ? Math.round(completeSlots.reduce((a, i) => a + values[i], 0) / completeSlots.length) : null,
  });
  const rows: SpendingRow[] = [...cells].map(([id, values]) => {
    const info = categories.get(id);
    return { id, name: info?.name ?? "Unknown category", group: info?.groupName ?? "Other", hidden: info?.hidden ?? false, order: info?.order, ...finish(values, tally.get(id) ?? values.map(() => 0)) };
  });
  const uncategorized = monthly.map((m) => m.uncategorizedSpent);
  if (uncategorized.some((v) => v !== 0)) rows.push({ id: null, name: "Uncategorized", group: "Uncategorized", hidden: false, ...finish(uncategorized, uncategorized.map(() => 0)) });
  const kept = rows.filter((r) => r.totalMinor !== 0 || r.byMonth.some((v) => v !== 0)).sort((a, b) => b.totalMinor - a.totalMinor);
  return { months: [...period.months], rows: kept, totalMinor: kept.reduce((a, r) => a + r.totalMinor, 0), hasHidden: kept.some((r) => r.hidden) };
}

/**
 * Money received by income category and month, in the same shape as spending (positive amounts), so the same charts and heatmap
 * read it. Each category is a group of its own (income is shown by category, not by the group Actual keeps it in). The total equals the Summary's Money received exactly: entries with no category in on-budget accounts are
 * what is left of each month's received once the income categories are taken out, and are listed as "Uncategorized".
 */
export function incomeBreakdown(ledger: Ledger, period: ResolvedPeriod, categories: ReadonlyMap<string, CategoryInfo>, monthly: readonly MonthlyPoint[]): SpendingBreakdown {
  const { facts, account } = ledger;
  const slot = new Map(period.months.map((m, i) => [m, i]));
  const cells = new Map<string, number[]>();
  const tally = new Map<string, number[]>();
  const add = (categoryId: string, month: string, amount: number, entries: number) => {
    const index = slot.get(month);
    if (index === undefined) return;
    const row = cells.get(categoryId) ?? period.months.map(() => 0);
    const n = tally.get(categoryId) ?? period.months.map(() => 0);
    row[index] += amount; n[index] += entries;
    cells.set(categoryId, row); tally.set(categoryId, n);
  };
  for (const row of facts.movement) {
    if (row.transferAccountId || row.categoryId === null || !account.has(row.accountId) || !facts.incomeCategories.has(row.categoryId)) continue;
    add(row.categoryId, row.month, row.amountMinor, row.count);
  }
  // A row the Asset Registry classifies has left income; take it back out of its category.
  for (const row of facts.reclassified) {
    if (row.categoryId === null || !account.has(row.accountId) || !facts.incomeCategories.has(row.categoryId)) continue;
    add(row.categoryId, row.month, 0 - row.amountMinor, -1);
  }
  const completeSlots = monthly.flatMap((m, i) => (m.hasData && !m.partial ? [i] : []));
  const finish = (values: number[], counts: number[]) => ({
    byMonth: values, counts, totalMinor: values.reduce((a, b) => a + b, 0),
    averageMinor: completeSlots.length ? Math.round(completeSlots.reduce((a, i) => a + values[i], 0) / completeSlots.length) : null,
  });
  const rows: SpendingRow[] = [...cells].map(([id, values]) => {
    const info = categories.get(id);
    // Income is listed by category: each is its own group, so the tab never opens a group to find the one category inside it.
    const name = info?.name ?? "Unknown category";
    return { id, name, group: name, hidden: info?.hidden ?? false, order: info?.order, ...finish(values, tally.get(id) ?? values.map(() => 0)) };
  });
  const categorised = period.months.map((_, i) => rows.reduce((a, r) => a + r.byMonth[i], 0));
  const uncategorized = monthly.map((m, i) => m.received - categorised[i]);
  if (uncategorized.some((v) => v !== 0)) rows.push({ id: null, name: "Uncategorized", group: "Uncategorized", hidden: false, ...finish(uncategorized, uncategorized.map(() => 0)) });
  const kept = rows.filter((r) => r.totalMinor !== 0 || r.byMonth.some((v) => v !== 0)).sort((a, b) => b.totalMinor - a.totalMinor);
  return { months: [...period.months], rows: kept, totalMinor: kept.reduce((a, r) => a + r.totalMinor, 0), hasHidden: kept.some((r) => r.hidden) };
}

export type SpendingFacts = {
  totalMinor: number;
  /** Average over the complete months with data; the current partial month is shown elsewhere but not counted. */
  averageMinor: number | null;
  averageMonths: number;
  largest: { name: string; totalMinor: number } | null;
  pace: { state: "ready"; earliestMinor: number; latestMinor: number; changePercent: number | null } | { state: "unavailable"; reason: string };
};

/** The latest three complete months against the earliest three, only when there are six or more so they never overlap. */
export function spendingFacts(breakdown: SpendingBreakdown, monthly: readonly MonthlyPoint[], pick: (m: MonthlyPoint) => number = (m) => m.spent): SpendingFacts {
  const complete = monthly.filter((m) => m.hasData && !m.partial);
  const sum = (points: readonly MonthlyPoint[]) => points.reduce((a, p) => a + pick(p), 0);
  const top = breakdown.rows[0];
  let pace: SpendingFacts["pace"];
  if (complete.length < 6) pace = { state: "unavailable", reason: "Needs at least six complete months in the period" };
  else {
    const earliest = Math.round(sum(complete.slice(0, 3)) / 3);
    const latest = Math.round(sum(complete.slice(-3)) / 3);
    pace = { state: "ready", earliestMinor: earliest, latestMinor: latest, changePercent: earliest > 0 ? Math.round(((latest - earliest) * 1000) / earliest) / 10 : null };
  }
  return {
    totalMinor: breakdown.totalMinor,
    averageMinor: complete.length ? Math.round(sum(complete) / complete.length) : null,
    averageMonths: complete.length,
    largest: top && top.totalMinor > 0 ? { name: top.name, totalMinor: top.totalMinor } : null,
    pace,
  };
}

/**
 * Where a month sits against the row's own average of complete months: -4 to -1 below it, 0 about the same (within 5%),
 * 1 to 4 above it. Neutral by design: it says nothing about whether more or less spending is good.
 */
export function heatBand(value: number, average: number | null): number {
  if (average === null || average <= 0) return 0;
  const d = (value / average - 1) * 100;
  return d <= -50 ? -4 : d <= -30 ? -3 : d <= -15 ? -2 : d < -5 ? -1 : d < 5 ? 0 : d < 15 ? 1 : d < 30 ? 2 : d < 60 ? 3 : 4;
}

// ─── Cash-change bridge ──────────────────────────────────────────────────────

export type BridgeLine = {
  key: string;
  label: string;
  amountMinor: number;
  /** A line made of transactions the Money in & out tab can open. */
  drill?: "contributed" | "withdrawn" | "repaid" | "borrowed";
};

export type CashBridgeLines = { openingMinor: number; lines: BridgeLine[]; unattributedMinor: number; closingMinor: number };

/**
 * Opening eligible cash, each kind of movement that changed it, and closing eligible cash. What the lines do not explain is
 * the "Unattributed" amount: it is whatever is left, not a value forced to zero, and it stays visible when it is not zero.
 */
export function cashBridgeLines(summary: Summary): CashBridgeLines {
  const b = summary.cashBridge;
  const lines: BridgeLine[] = [
    { key: "cashIncome", label: "Income (cash accounts)", amountMinor: b.operatingIncome },
    { key: "cashSpending", label: "Spending (cash accounts)", amountMinor: b.operatingSpending },
    { key: "unidentified", label: "Unidentified movements", amountMinor: b.unidentified },
    { key: "assetSales", label: "Asset sale proceeds", amountMinor: b.assetSales },
    { key: "card", label: "Paid to credit cards", amountMinor: b.card },
    { key: "contributed", label: "Put into investments", amountMinor: b.investmentOut, drill: "contributed" },
    { key: "withdrawn", label: "Withdrawn from investments", amountMinor: b.investmentIn, drill: "withdrawn" },
    { key: "repaid", label: "Loan principal repaid", amountMinor: b.loanOut, drill: "repaid" },
    { key: "borrowed", label: "Borrowed (received from loans)", amountMinor: b.loanIn, drill: "borrowed" },
    { key: "fixedDeposits", label: "Fixed / restricted deposits", amountMinor: b.fixedDeposits },
    { key: "assets", label: "Moved to and from other assets", amountMinor: b.assets },
    { key: "liabilities", label: "Moved to and from other liabilities", amountMinor: b.liabilities },
    { key: "excluded", label: "Transfers with excluded accounts", amountMinor: b.excluded },
    { key: "inTransit", label: "In transit between cash accounts", amountMinor: b.inTransit },
    { key: "openingBalances", label: "Opening balances", amountMinor: b.openingBalances },
  ];
  const explained = lines.reduce((a, l) => a + l.amountMinor, 0);
  return {
    openingMinor: summary.eligibleCash.opening,
    lines: lines.filter((l) => l.amountMinor !== 0),
    unattributedMinor: summary.eligibleCash.closing - summary.eligibleCash.opening - explained,
    closingMinor: summary.eligibleCash.closing,
  };
}

// ─── Payees ──────────────────────────────────────────────────────────────────

/** One row of the payee read: spending-category rows by payee, category and account. */
export type PayeeRow = { payeeId: string | null; categoryId: string; accountId: string; amountMinor: number; count: number; /** Part of a split transaction. */ isChild?: boolean };

export type PayeeSpending = { payeeId: string | null; name: string; totalMinor: number; count: number; averageMinor: number; topCategory: string | null };

/** Payees ranked by spending, with entries that have no payee kept apart (and how many of them are parts of split transactions). */
export type PayeeRanking = { payees: PayeeSpending[]; noPayee: (PayeeSpending & { splitParts: number }) | null };

/**
 * Spending by payee, largest first. Income categories, excluded accounts and registry-classified rows are out. With `side` set to
 * "income" it is money received by payer instead: only income categories count, and the amounts are as received.
 */
export function payeeSpending(
  rows: readonly PayeeRow[], ledger: Ledger, period: ResolvedPeriod, categories: ReadonlyMap<string, CategoryInfo>, names: ReadonlyMap<string, string>,
  limit = 15, side: "spending" | "income" = "spending",
): PayeeRanking {
  const { facts, account } = ledger;
  const income = side === "income";
  // A row is on this side when its category is an income category (money in) or not (spending); `sign` turns it into a positive total.
  const wanted = (categoryId: string) => facts.incomeCategories.has(categoryId) === income;
  const sign = income ? 1 : -1;
  const byPayee = new Map<string | null, { total: number; count: number; splitParts: number; byCategory: Map<string, number> }>();
  const entry = (payeeId: string | null) => {
    const existing = byPayee.get(payeeId) ?? { total: 0, count: 0, splitParts: 0, byCategory: new Map() };
    byPayee.set(payeeId, existing);
    return existing;
  };
  for (const row of rows) {
    if (!account.has(row.accountId) || !wanted(row.categoryId)) continue;
    const e = entry(row.payeeId);
    e.total += sign * row.amountMinor;
    e.count += row.count;
    if (row.isChild) e.splitParts += row.count;
    e.byCategory.set(row.categoryId, (e.byCategory.get(row.categoryId) ?? 0) + sign * row.amountMinor);
  }
  for (const row of facts.reclassified) {
    if (row.categoryId === null || row.month < period.startMonth || row.month > period.endMonth || !account.has(row.accountId) || !wanted(row.categoryId)) continue;
    const e = entry(row.payeeId);
    e.total -= sign * row.amountMinor;
    e.count -= 1;
    e.byCategory.set(row.categoryId, (e.byCategory.get(row.categoryId) ?? 0) - sign * row.amountMinor);
  }
  const build = (payeeId: string | null, e: { total: number; count: number; byCategory: Map<string, number> }): PayeeSpending => {
    const top = [...e.byCategory].sort((a, b) => b[1] - a[1])[0];
    return {
      payeeId, name: payeeId === null ? "No payee" : names.get(payeeId) ?? "Unknown payee", totalMinor: e.total, count: e.count,
      averageMinor: e.count > 0 ? Math.round(e.total / e.count) : e.total, topCategory: top ? categories.get(top[0])?.name ?? null : null,
    };
  };
  const none = byPayee.get(null);
  return {
    payees: [...byPayee].filter(([id, e]) => id !== null && e.total > 0).map(([id, e]) => build(id, e)).sort((a, b) => b.totalMinor - a.totalMinor).slice(0, limit),
    noPayee: none && none.total > 0 ? { ...build(null, none), splitParts: none.splitParts } : null,
  };
}

// ─── Category groups ─────────────────────────────────────────────────────────

/** How many groups get a colour of their own. */
export const GROUP_COLOURS = 10;

export type GroupSeries = {
  name: string;
  /** 0 to 9 for the ten largest groups, 10 for the others merged into "Other groups". */
  slot: number;
  /** The categories of the group that have spending (the transactions behind the group are exactly these, plus uncategorized when flagged). */
  categoryIds: string[];
  /** The group holds the on-budget entries with no category. */
  hasUncategorized: boolean;
  byMonth: number[];
  /** Entries per month; null when the group includes entries with no category, whose count is not known. */
  counts: number[] | null;
  totalMinor: number;
  /** The budget position of the group's first category; a group with none sorts last. */
  order: number;
  rows: SpendingRow[];
};

/**
 * The groups of a spending breakdown, largest first (ties by name), and the stacked series: the ten largest keep their own
 * colour slot and every other group is merged into "Other groups". The assignment depends only on this period's totals, so
 * every chart of the view uses the same colours.
 */
export function spendingGroups(breakdown: SpendingBreakdown): { groups: GroupSeries[]; stacked: GroupSeries[] } {
  const months = breakdown.months.length;
  const byName = new Map<string, SpendingRow[]>();
  for (const row of breakdown.rows) byName.set(row.group, [...(byName.get(row.group) ?? []), row]);
  const build = (name: string, rows: SpendingRow[], slot: number): GroupSeries => {
    const byMonth = Array.from({ length: months }, (_, i) => rows.reduce((a, r) => a + r.byMonth[i], 0));
    const known = rows.every((r) => r.id !== null);
    return {
      name, slot, rows, byMonth, totalMinor: byMonth.reduce((a, b) => a + b, 0), order: Math.min(Number.MAX_SAFE_INTEGER, ...rows.map((r) => r.order ?? Number.MAX_SAFE_INTEGER)),
      categoryIds: rows.flatMap((r) => (r.id === null ? [] : [r.id])), hasUncategorized: rows.some((r) => r.id === null),
      counts: known ? Array.from({ length: months }, (_, i) => rows.reduce((a, r) => a + r.counts[i], 0)) : null,
    };
  };
  const ordered = [...byName].map(([name, rows]) => build(name, rows, 0)).sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name));
  const groups = ordered.map((g, i) => ({ ...g, slot: Math.min(i, GROUP_COLOURS) }));
  const top = groups.slice(0, GROUP_COLOURS);
  const rest = groups.slice(GROUP_COLOURS);
  const stacked = rest.length ? [...top, build("Other groups", rest.flatMap((g) => g.rows), GROUP_COLOURS)] : top;
  return { groups, stacked };
}

// ─── Net worth: what changed it ──────────────────────────────────────────────

export type WaterfallDrill = "unidentified" | "investmentResults" | "valueChange" | "assetSale" | "excludedTransfer" | "inTransit";
export type NetWorthStep = { key: string; label: string; amountMinor: number; note: string; drill?: WaterfallDrill };

/**
 * The components of the change in net worth over the period, from the same flows the identity uses, and what they leave
 * unexplained. Zero steps are left out; the opening is the balance before the first day of the period, so the steps and the
 * balances use the same boundary. `unexplainedMinor` is shown whenever it is not zero and is never forced to zero.
 */
export function netWorthSteps(summary: Summary) {
  const f = summary.flows;
  const kept = f.income + f.uncategorizedIn + f.spending + f.uncategorizedOut;
  const all: NetWorthStep[] = [
    { key: "kept", label: "Money kept", amountMinor: kept, note: "Income less spending, including entries with no category in on-budget accounts" },
    { key: "unidentified", label: "Unidentified movements", amountMinor: f.unidentified, note: "Entries with no category in other off-budget accounts. Not income or spending: nothing is assumed", drill: "unidentified" },
    { key: "investmentResults", label: "Investment activity", amountMinor: f.investmentResults, note: "Entries with no category in your investment and retirement accounts: price changes, dividends, interest and fees recorded there. Not income or spending, and no return is calculated", drill: "investmentResults" },
    { key: "valueChange", label: "Changes in value", amountMinor: f.valueChanges, note: "Entries classified in Assets as a change in an asset's value", drill: "valueChange" },
    { key: "assetSale", label: "Asset sales", amountMinor: f.assetSales, note: "Proceeds and selling costs linked in Assets", drill: "assetSale" },
    { key: "opening", label: "Opening balances", amountMinor: f.openingBalances, note: "Starting balances of accounts opened in the period" },
    { key: "excluded", label: "Transfers with excluded accounts", amountMinor: f.excludedTransfers, note: "Money moved to or from accounts left out of Financial Insights", drill: "excludedTransfer" },
    { key: "inTransit", label: "In transit", amountMinor: f.inTransit, note: "Transfers whose two sides do not net to zero in the period", drill: "inTransit" },
  ];
  return {
    openingMinor: summary.netWorth.opening, closingMinor: summary.netWorth.closing, changeMinor: summary.netWorth.change,
    steps: all.filter((s) => s.key === "kept" || s.amountMinor !== 0), unexplainedMinor: summary.unexplained,
  };
}

// ─── What you own and owe ────────────────────────────────────────────────────

export type ClassKey = "cash" | "fixed" | "invest" | "property" | "vehicle" | "other" | "loans" | "cards" | "otherLiability";
export const ASSET_CLASSES: ClassKey[] = ["cash", "fixed", "invest", "property", "vehicle", "other"];
export const LIABILITY_CLASSES: ClassKey[] = ["loans", "cards", "otherLiability"];
export const CLASS_LABEL: Record<ClassKey, string> = { cash: "Cash & bank", fixed: "Fixed / restricted deposits", invest: "Investments", property: "Property", vehicle: "Vehicles", other: "Other assets", loans: "Loans", cards: "Credit cards", otherLiability: "Other liabilities" };

/** Balances by class, assets positive and liabilities negative, as the Accounts page classes them. */
export function classBalances(p: Positions): Record<ClassKey, number> {
  return { cash: p.eligibleCash, fixed: p.fixedDeposits, invest: p.investments, property: p.property, vehicle: p.vehicle, other: p.otherAssets, loans: p.loans, cards: p.cards, otherLiability: p.otherLiabilities };
}

/** Month-end balances by class for each month of the period, with the opening balances before the first day. */
export function compositionSeries(ledger: Ledger, period: ResolvedPeriod, opening: Positions) {
  const months = period.months.map((month) => ({ month, ...classBalances(positionsAt(ledger, month)) }));
  const netWorth = months.map((m) => ASSET_CLASSES.concat(LIABILITY_CLASSES).reduce((a, k) => a + m[k], 0));
  // A month before the budget has any data has balances of nothing, not balances of zero: charts and tables leave it unavailable.
  const hasData = period.months.map((month) => ledger.firstMonth !== null && month >= ledger.firstMonth);
  return { months, netWorth, hasData, opening: classBalances(opening) };
}

// ─── Debt repayments ─────────────────────────────────────────────────────────

export type DebtRow = {
  accountId: string;
  name: string;
  tracked: boolean;
  /** Everything recorded as paid into the loan account in the period, from any account that is counted: a repayment sent from an account left out of Financial Insights is not in it. */
  principalMinor: number;
  /** Null when the loan is not tracked in Loans: its interest cannot be told from other spending. */
  interestMinor: number | null;
  feesMinor: number | null;
};

export type DebtRepayments = {
  rows: DebtRow[];
  principalMinor: number;
  interestMinor: number;
  feesMinor: number;
  /** True when every loan listed is tracked, so interest and fees are complete. */
  complete: boolean;
  /** What the cash-change table counts as principal: money that left cash accounts for loans. It can be less than `principalMinor`. */
  fromCashMinor: number;
};

/** Recorded repayments of the loans in the period. Recorded figures only, never scheduled ones. */
export function debtRepayments(ledger: Ledger, period: ResolvedPeriod, trackedLoanIds: ReadonlySet<string>, fromCashMinor: number): DebtRepayments {
  const inWin = (month: string) => month >= period.startMonth && month <= period.endMonth;
  const principal = new Map<string, number>(), interest = new Map<string, number>(), fees = new Map<string, number>();
  for (const r of ledger.facts.transfersIn) {
    if (!inWin(r.month) || ledger.account.get(r.accountId)?.accountClass !== "loan" || ledger.facts.excluded.has(r.transferAccountId)) continue;
    principal.set(r.accountId, (principal.get(r.accountId) ?? 0) + r.amountMinor);
  }
  for (const r of ledger.facts.loanCosts) {
    if (!r.loanAccountId || !r.kind || !inWin(r.month)) continue;
    const into = r.kind === "interest" ? interest : fees;
    into.set(r.loanAccountId, (into.get(r.loanAccountId) ?? 0) + (0 - r.amountMinor));
  }
  const rows: DebtRow[] = [];
  for (const a of ledger.account.values()) {
    if (a.accountClass !== "loan") continue;
    const tracked = trackedLoanIds.has(a.id);
    const p = principal.get(a.id) ?? 0, i = interest.get(a.id) ?? 0, f = fees.get(a.id) ?? 0;
    if (!p && !i && !f) continue;
    rows.push({ accountId: a.id, name: a.name, tracked, principalMinor: p, interestMinor: tracked ? i : null, feesMinor: tracked ? f : null });
  }
  rows.sort((a, b) => b.principalMinor - a.principalMinor);
  const sum = (pick: (r: DebtRow) => number | null) => rows.reduce((a, r) => a + (pick(r) ?? 0), 0);
  return { rows, principalMinor: sum((r) => r.principalMinor), interestMinor: sum((r) => r.interestMinor), feesMinor: sum((r) => r.feesMinor), complete: rows.every((r) => r.tracked), fromCashMinor };
}
