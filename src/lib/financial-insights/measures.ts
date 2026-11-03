import type { AccountClass } from "@/lib/account-class";
import { isCashEquivalent, type ReportingTreatment } from "@/lib/account-class/reporting";
import { addMonths, lastCompleteMonths, monthOf, type ResolvedPeriod } from "./period";

/**
 * Every Financial Insights measure is defined here, once, from the same facts. Tabs only render what this returns.
 * Pure: no I/O, no dates read from the clock. All amounts are signed integer minor units, as Actual stores them
 * (assets positive, debts negative), and a measure that cannot be calculated reliably is never zero.
 *
 * How a row is read, in this order, whatever the account's class:
 *  1. a transfer is never income or spending;
 *  2. a row the Asset Registry classifies (a value change, or a linked sale) goes to its own line;
 *  3. a categorized row follows its category: income in an income group, spending otherwise, never inferred from the sign;
 *  4. an uncategorized row in an on-budget account is income or spending by its sign;
 *  5. an uncategorized row in an off-budget account is not income or spending: in an Investment or Retirement account it is an
 *     investment result (a gain, loss, dividend or fee recorded without a category), in any other it is an unidentified movement.
 */

// ─── Facts ───────────────────────────────────────────────────────────────────

export type MovementRow = {
  /** `YYYY-MM`. */
  month: string;
  accountId: string;
  categoryId: string | null;
  /** The account on the other side when the row is a transfer. */
  transferAccountId: string | null;
  amountMinor: number;
  count: number;
};

export type DatedAmount = { month: string; accountId: string; amountMinor: number };

/**
 * A row the Asset Registry classifies, so it is not income or spending: a change in an asset's value, or a linked sale
 * (proceeds or selling cost). It leaves the bucket its category, or lack of one, would give it and goes to its own line.
 */
export type ReclassifiedRow = { /** The transaction, so a drilldown can leave it out of income and spending. */ id: string; payeeId: string | null; month: string; accountId: string; categoryId: string | null; amountMinor: number; to: "valueChange" | "assetSale" };

/** One interest or fee line the Loans tracking recorded for a tracked loan. */
export type LoanCostRow = { /** The transaction, so a drilldown can list it. */ id?: string; month: string; accountId: string; categoryId: string | null; amountMinor: number; /** The loan these lines belong to, and what they are, when the reader knows. */ loanAccountId?: string; kind?: "interest" | "fee" };

export type AccountFact = {
  id: string;
  name: string;
  /** Never "excluded": those accounts are not facts, they are only named in `FinancialFacts.excluded`. */
  accountClass: Exclude<AccountClass, "excluded">;
  treatment: ReportingTreatment | null;
  /** Actual's budget placement: it decides what an uncategorized entry means. */
  offBudget: boolean;
};

export type FinancialFacts = {
  accounts: readonly AccountFact[];
  /** Accounts the owner left out of Financial Insights. Nothing of theirs is counted; a transfer with one is shown on its own line. */
  excluded: ReadonlySet<string>;
  /** Category ids in an income group. */
  incomeCategories: ReadonlySet<string>;
  /** Everything dated up to today, except starting balances. */
  movement: readonly MovementRow[];
  startingBalances: readonly DatedAmount[];
  /** The positive part of the uncategorized non-transfer rows, so an on-budget cell can be split by sign. */
  uncategorizedIn: readonly DatedAmount[];
  /** The positive part of the transfer rows, by counterpart, so money in can be told from money out within a cell. */
  transfersIn: readonly (DatedAmount & { transferAccountId: string })[];
  reclassified: readonly ReclassifiedRow[];
  /** The recorded interest and fee lines of tracked loans (see `cashBuffer`). */
  loanCosts: readonly LoanCostRow[];
};

export type Status<T> =
  | { state: "ready"; value: T }
  | { state: "unavailable"; reason: string }
  | { state: "needsReview"; reason: string };

const ready = <T>(value: T): Status<T> => ({ state: "ready", value });
const unavailable = <T>(reason: string): Status<T> => ({ state: "unavailable", reason });
const needsReview = <T>(reason: string): Status<T> => ({ state: "needsReview", reason });

/** The result of the Asset Registry check for the selected period. */
export type AssetReview = { unavailableReason: string | null; rowCount: number };

// ─── Roles ───────────────────────────────────────────────────────────────────

/** How an account counts in the money picture. */
export type Role = "cash" | "fixed" | "card" | "investment" | "loan" | "asset" | "liability";

export function roleOf(account: AccountFact): Role {
  switch (account.accountClass) {
    case "cash": return "cash";
    case "bank": return isCashEquivalent("bank", account.treatment) ? "cash" : "fixed";
    case "credit-card": return "card";
    case "investment":
    case "retirement": return "investment";
    case "loan": return "loan";
    case "property":
    case "vehicle":
    case "other-asset": return "asset";
    case "other-liability": return "liability";
  }
}

// ─── Ledger ──────────────────────────────────────────────────────────────────

export type Ledger = {
  facts: FinancialFacts;
  account: ReadonlyMap<string, AccountFact>;
  role: ReadonlyMap<string, Role>;
  /** The first month with any movement; null when the budget has none. */
  firstMonth: string | null;
  /** Balance of one account at the end of `month`. */
  balanceAt: (accountId: string, month: string) => number;
};

export function buildLedger(facts: FinancialFacts): Ledger {
  const account = new Map(facts.accounts.map((a) => [a.id, a]));
  const role = new Map(facts.accounts.map((a) => [a.id, roleOf(a)]));
  const byAccount = new Map<string, Map<string, number>>();
  const add = (accountId: string, month: string, amount: number) => {
    if (!account.has(accountId)) return;
    const months = byAccount.get(accountId) ?? new Map<string, number>();
    months.set(month, (months.get(month) ?? 0) + amount);
    byAccount.set(accountId, months);
  };
  let firstMonth: string | null = null;
  // Only the accounts counted here mark where the data begins: an account left out must not move it.
  for (const row of facts.movement) {
    add(row.accountId, row.month, row.amountMinor);
    if (account.has(row.accountId) && (!firstMonth || row.month < firstMonth)) firstMonth = row.month;
  }
  // The data begins with the first movement: a month holding only a starting balance is not a month of activity, and counting it
  // would pull averages down. A budget with nothing but starting balances still has balances to show, so it begins with the first of those.
  let firstStarting: string | null = null;
  for (const row of facts.startingBalances) {
    add(row.accountId, row.month, row.amountMinor);
    if (account.has(row.accountId) && (!firstStarting || row.month < firstStarting)) firstStarting = row.month;
  }
  if (!firstMonth) firstMonth = firstStarting;
  const sorted = new Map([...byAccount].map(([id, months]) => [id, [...months].sort(([a], [b]) => a.localeCompare(b))]));
  return {
    facts, account, role, firstMonth,
    balanceAt: (accountId, month) => {
      let total = 0;
      for (const [m, amount] of sorted.get(accountId) ?? []) {
        if (m > month) break;
        total += amount;
      }
      return total;
    },
  };
}

// ─── Period activity ─────────────────────────────────────────────────────────

/** Signed flows over a period: positive raises net worth. */
export type Flows = {
  income: number;
  spending: number;
  /** Uncategorized entries in on-budget accounts, by sign. */
  uncategorizedIn: number;
  uncategorizedOut: number;
  /** Uncategorized entries in off-budget accounts: not income or spending. */
  unidentified: number;
  unidentifiedCount: number;
  /** Uncategorized entries in off-budget Investment and Retirement accounts: price changes, dividends, interest and fees recorded there. Not income or spending. */
  investmentResults: number;
  investmentResultsCount: number;
  /** Rows the Asset Registry classifies as a change in an asset's value. */
  valueChanges: number;
  /** Rows the Asset Registry links to the sale of an asset. */
  assetSales: number;
  openingBalances: number;
  /** Transfers between an included account and an excluded one: they change net worth and are not income or spending. */
  excludedTransfers: number;
  /** Every transfer row, summed. Zero when both sides of every transfer fall inside the period. */
  inTransit: number;
};

const emptyFlows = (): Flows => ({
  income: 0, spending: 0, uncategorizedIn: 0, uncategorizedOut: 0, unidentified: 0, unidentifiedCount: 0, investmentResults: 0, investmentResultsCount: 0, valueChanges: 0, assetSales: 0,
  openingBalances: 0, excludedTransfers: 0, inTransit: 0,
});

export type CashBridge = {
  /** Income categories, and the money in among the on-budget uncategorized rows, in cash accounts. */
  operatingIncome: number;
  /** Spending categories (refunds netted), and the money out among the on-budget uncategorized rows, in cash accounts. */
  operatingSpending: number;
  /** Uncategorized rows in off-budget cash accounts. */
  unidentified: number;
  assetSales: number;
  card: number;
  investment: number;
  loan: number;
  /** The same transfers by direction, seen from the cash account: money put in (negative) and money received (positive). */
  investmentOut: number;
  investmentIn: number;
  loanOut: number;
  loanIn: number;
  fixedDeposits: number;
  /** Transfers with an excluded account. */
  excluded: number;
  assets: number;
  liabilities: number;
  /** Between your own cash accounts, or with one side not recorded up to today: zero when both sides fall in the period. */
  inTransit: number;
  openingBalances: number;
};

const inWindow = (month: string, period: ResolvedPeriod) => month >= period.startMonth && month <= period.endMonth;

export type Computed = { flows: Flows; cashBridge: CashBridge };

/** Takes a classified row back out of the line its category (or lack of one) gave it. */
function takeOut(flows: Flows, cash: CashBridge | null, account: AccountFact, investment: boolean, incomeCategories: ReadonlySet<string>, row: { categoryId: string | null; amountMinor: number }) {
  const { categoryId, amountMinor } = row;
  if (categoryId !== null) {
    if (incomeCategories.has(categoryId)) flows.income -= amountMinor;
    else flows.spending -= amountMinor;
    if (cash) { if (incomeCategories.has(categoryId)) cash.operatingIncome -= amountMinor; else cash.operatingSpending -= amountMinor; }
  } else if (account.offBudget && investment) {
    flows.investmentResults -= amountMinor;
    flows.investmentResultsCount -= 1;
  } else if (account.offBudget) {
    flows.unidentified -= amountMinor;
    flows.unidentifiedCount -= 1;
    if (cash) cash.unidentified -= amountMinor;
  } else {
    if (amountMinor > 0) flows.uncategorizedIn -= amountMinor;
    else flows.uncategorizedOut -= amountMinor;
    if (cash) { if (amountMinor > 0) cash.operatingIncome -= amountMinor; else cash.operatingSpending -= amountMinor; }
  }
}

/**
 * The ledger as seen for each month on its own: the same accounts and balances, with only that month's rows. A month-by-month
 * calculation that reads every row for every month costs months × rows; this sorts the rows into their months once.
 */
export function ledgersByMonth(ledger: Ledger, months: readonly string[]): Map<string, Ledger> {
  const wanted = new Set(months);
  const bucket = <T extends { month: string }>(rows: readonly T[]) => {
    const byMonth = new Map<string, T[]>();
    for (const row of rows) {
      if (!wanted.has(row.month)) continue;
      const list = byMonth.get(row.month);
      if (list) list.push(row); else byMonth.set(row.month, [row]);
    }
    return byMonth;
  };
  const movement = bucket(ledger.facts.movement);
  const startingBalances = bucket(ledger.facts.startingBalances);
  const uncategorizedIn = bucket(ledger.facts.uncategorizedIn);
  const transfersIn = bucket(ledger.facts.transfersIn);
  const reclassified = bucket(ledger.facts.reclassified);
  return new Map(months.map((month) => [month, {
    ...ledger,
    facts: {
      ...ledger.facts,
      movement: movement.get(month) ?? [], startingBalances: startingBalances.get(month) ?? [], uncategorizedIn: uncategorizedIn.get(month) ?? [],
      transfersIn: transfersIn.get(month) ?? [], reclassified: reclassified.get(month) ?? [],
    },
  }]));
}

export function computeFlows(ledger: Ledger, period: ResolvedPeriod): Computed {
  const { facts, role, account } = ledger;
  const flows = emptyFlows();
  const cash: CashBridge = {
    operatingIncome: 0, operatingSpending: 0, unidentified: 0, assetSales: 0, card: 0, investment: 0, loan: 0, investmentOut: 0, investmentIn: 0, loanOut: 0, loanIn: 0, fixedDeposits: 0, excluded: 0, assets: 0, liabilities: 0, inTransit: 0, openingBalances: 0,
  };
  const uncatIn = new Map<string, number>();
  for (const row of facts.uncategorizedIn) {
    if (inWindow(row.month, period)) uncatIn.set(`${row.month}|${row.accountId}`, (uncatIn.get(`${row.month}|${row.accountId}`) ?? 0) + row.amountMinor);
  }

  // Transfers between a cash account and an investment or a loan, by month, account and counterpart: the cell holds the net, the
  // read of positive rows holds what came in, so the two directions can be told apart without netting a contribution against a withdrawal.
  const directed = new Map<string, { role: "investment" | "loan"; net: number }>();
  const received = new Map<string, number>();
  for (const row of facts.transfersIn) {
    if (inWindow(row.month, period)) received.set(`${row.month}|${row.accountId}|${row.transferAccountId}`, (received.get(`${row.month}|${row.accountId}|${row.transferAccountId}`) ?? 0) + row.amountMinor);
  }
  for (const row of facts.movement) {
    if (!inWindow(row.month, period)) continue;
    const own = role.get(row.accountId);
    const owner = account.get(row.accountId);
    if (!own || !owner) continue;
    const amount = row.amountMinor;
    if (row.transferAccountId && facts.excluded.has(row.transferAccountId)) {
      flows.excludedTransfers += amount;
      if (own === "cash") cash.excluded += amount;
    } else if (row.transferAccountId) {
      flows.inTransit += amount;
      if (own === "cash") {
        const other = role.get(row.transferAccountId);
        if (other === "cash") cash.inTransit += amount;
        else if (other === "card") cash.card += amount;
        else if (other === "investment" || other === "loan") {
          if (other === "investment") cash.investment += amount; else cash.loan += amount;
          const key = `${row.month}|${row.accountId}|${row.transferAccountId}`;
          const cell = directed.get(key) ?? { role: other, net: 0 };
          cell.net += amount;
          directed.set(key, cell);
        }
        else if (other === "fixed") cash.fixedDeposits += amount;
        else if (other === "asset") cash.assets += amount;
        else cash.liabilities += amount;
      }
    } else if (row.categoryId !== null) {
      if (facts.incomeCategories.has(row.categoryId)) flows.income += amount;
      else flows.spending += amount;
      if (own === "cash") { if (facts.incomeCategories.has(row.categoryId)) cash.operatingIncome += amount; else cash.operatingSpending += amount; }
    } else if (owner.offBudget && own === "investment") {
      flows.investmentResults += amount;
      flows.investmentResultsCount += row.count;
    } else if (owner.offBudget) {
      flows.unidentified += amount;
      flows.unidentifiedCount += row.count;
      if (own === "cash") cash.unidentified += amount;
    } else {
      // The cell holds both signs; the positive part is read separately, so the rest is money out.
      const positive = uncatIn.get(`${row.month}|${row.accountId}`) ?? 0;
      flows.uncategorizedIn += positive;
      flows.uncategorizedOut += amount - positive;
      if (own === "cash") { cash.operatingIncome += positive; cash.operatingSpending += amount - positive; }
    }
  }

  for (const [key, cell] of directed) {
    const into = received.get(key) ?? 0;
    if (cell.role === "investment") { cash.investmentIn += into; cash.investmentOut += cell.net - into; }
    else { cash.loanIn += into; cash.loanOut += cell.net - into; }
  }

  for (const row of facts.reclassified) {
    const owner = account.get(row.accountId);
    if (!inWindow(row.month, period) || !owner) continue;
    const own = role.get(row.accountId);
    takeOut(flows, own === "cash" ? cash : null, owner, own === "investment", facts.incomeCategories, row);
    if (row.to === "valueChange") flows.valueChanges += row.amountMinor;
    else {
      flows.assetSales += row.amountMinor;
      if (own === "cash") cash.assetSales += row.amountMinor;
    }
  }

  for (const row of facts.startingBalances) {
    if (!inWindow(row.month, period) || !role.has(row.accountId)) continue;
    flows.openingBalances += row.amountMinor;
    if (role.get(row.accountId) === "cash") cash.openingBalances += row.amountMinor;
  }
  return { flows, cashBridge: cash };
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export type Positions = {
  eligibleCash: number;
  fixedDeposits: number;
  investments: number;
  property: number;
  vehicle: number;
  otherAssets: number;
  loans: number;
  cards: number;
  otherLiabilities: number;
};

export type SeriesPoint = { month: string; netWorthMinor: number | null; cashMinor: number | null; partial: boolean };

export type Summary = {
  period: ResolvedPeriod;
  /** Balances at the end of the month before the period starts (before its first day). */
  opening: Positions;
  closing: Positions;
  /** Assets as a positive amount. */
  assets: number;
  /** What is owed, as a positive amount. */
  liabilities: number;
  netWorth: { opening: number; closing: number; change: number };
  eligibleCash: { opening: number; closing: number; change: number };
  invested: number;
  /** Income, including uncategorized money in (on-budget). */
  received: number;
  /** Spending, including uncategorized money out (on-budget); refunds reduce it. A positive amount. */
  spent: number;
  moneyKept: Status<number>;
  /** Percent of what was received; one decimal. */
  savingsRate: Status<number>;
  flows: Flows;
  cashBridge: CashBridge;
  /** Change in net worth minus every explained flow; zero when the facts are complete. */
  unexplained: number;
  series: SeriesPoint[];
};

export function positionsAt(ledger: Ledger, month: string): Positions {
  const p: Positions = { eligibleCash: 0, fixedDeposits: 0, investments: 0, property: 0, vehicle: 0, otherAssets: 0, loans: 0, cards: 0, otherLiabilities: 0 };
  for (const account of ledger.account.values()) {
    const balance = ledger.balanceAt(account.id, month);
    switch (account.accountClass) {
      case "property": p.property += balance; break;
      case "vehicle": p.vehicle += balance; break;
      case "other-asset": p.otherAssets += balance; break;
      case "loan": p.loans += balance; break;
      case "credit-card": p.cards += balance; break;
      case "other-liability": p.otherLiabilities += balance; break;
      default:
        switch (ledger.role.get(account.id)) {
          case "fixed": p.fixedDeposits += balance; break;
          case "investment": p.investments += balance; break;
          default: p.eligibleCash += balance;
        }
    }
  }
  return p;
}

const sumPositions = (p: Positions) => Object.values(p).reduce((a, b) => a + b, 0);

export function summarize(ledger: Ledger, period: ResolvedPeriod, review: AssetReview): Summary {
  const closing = positionsAt(ledger, period.endMonth);
  const opening = positionsAt(ledger, addMonths(period.startMonth, -1));
  const { flows, cashBridge } = computeFlows(ledger, period);

  const assets = closing.eligibleCash + closing.fixedDeposits + closing.investments + closing.property + closing.vehicle + closing.otherAssets;
  const liabilities = 0 - (closing.loans + closing.cards + closing.otherLiabilities);
  const netWorth = { opening: sumPositions(opening), closing: sumPositions(closing), change: sumPositions(closing) - sumPositions(opening) };
  const eligibleCash = { opening: opening.eligibleCash, closing: closing.eligibleCash, change: closing.eligibleCash - opening.eligibleCash };

  const received = flows.income + flows.uncategorizedIn;
  const spent = 0 - (flows.spending + flows.uncategorizedOut);
  const kept = received - spent;
  let moneyKept: Status<number>;
  if (review.unavailableReason) moneyKept = needsReview(review.unavailableReason);
  else if (review.rowCount > 0) {
    moneyKept = needsReview(`${review.rowCount} ${review.rowCount === 1 ? "entry is" : "entries are"} classified in Assets as capital put into an asset without a recorded transfer, so the money may also be counted as spending`);
  } else moneyKept = ready(kept);
  let savingsRate: Status<number>;
  if (moneyKept.state !== "ready") savingsRate = moneyKept;
  else if (received <= 0) savingsRate = unavailable("There was no income in this period");
  else savingsRate = ready(Math.round((moneyKept.value * 1000) / received) / 10);

  const explained = flows.income + flows.spending + flows.uncategorizedIn + flows.uncategorizedOut + flows.unidentified + flows.investmentResults + flows.valueChanges + flows.assetSales + flows.openingBalances + flows.excludedTransfers + flows.inTransit;
  const series: SeriesPoint[] = period.months.map((month, index) => {
    if (!ledger.firstMonth || month < ledger.firstMonth) return { month, netWorthMinor: null, cashMinor: null, partial: false };
    const at = positionsAt(ledger, month);
    return { month, netWorthMinor: sumPositions(at), cashMinor: at.eligibleCash, partial: period.partial && index === period.months.length - 1 };
  });

  return {
    period, opening, closing, assets, liabilities, netWorth, eligibleCash, invested: closing.investments, received, spent,
    moneyKept, savingsRate, flows, cashBridge, unexplained: netWorth.change - explained, series,
  };
}

// ─── Cash buffer ─────────────────────────────────────────────────────────────

/** What the Loans module's reconciled schedule says a tracked loan costs each month, or why it cannot say. */
export type LoanScheduleInput = { state: "ready"; monthlyMinor: number } | { state: "unavailable"; reason: string };

export type BufferLoan = { accountId: string; name: string; monthlyMinor: number; source: "schedule" | "recorded" };

export type CashBuffer = {
  months: number;
  cashMinor: number;
  monthlyNeedMinor: number;
  /** Average monthly spending, without the interest and fees of tracked loans (their repayments are counted whole). */
  spendingMinor: number;
  spendingMonths: number;
  loans: BufferLoan[];
};

/**
 * How many months eligible cash would cover, as of today and regardless of the selected period. It uses Actual's
 * recorded obligations. Need = average monthly spending over the last complete months (twelve where available, all of them
 * from three to eleven, unavailable below three) plus what each loan costs each month, in full:
 *  - a tracked loan whose schedule reconciles with Actual: its scheduled repayment (principal, interest and fees); its
 *    interest and fee lines the Loans tracking recorded for it (`facts.loanCosts`, identified by row, never by category) come
 *    out of the spending average so they are not counted twice;
 *  - a tracked loan that does not reconcile makes the buffer unavailable, naming the loan;
 *  - any other loan owed: the average of the transfers recorded into its account over the last complete months (at least
 *    three), which is principal only, because its interest cannot be told from other spending.
 * An untracked model is never used. The buffer is unavailable, never zero, when any part cannot be known.
 */
export function cashBuffer(ledger: Ledger, today: string, schedules: ReadonlyMap<string, LoanScheduleInput>): Status<CashBuffer> {
  const current = monthOf(today);
  const months = lastCompleteMonths(today, ledger.firstMonth, 12);
  if (months.length < 3) return unavailable("Insufficient history: at least three complete months are needed");
  const window: ResolvedPeriod = {
    startMonth: months[0], endMonth: months[months.length - 1], months, startDate: `${months[0]}-01`, endDate: `${months[months.length - 1]}-28`,
    partial: false, label: "",
  };
  const { flows } = computeFlows(ledger, window);
  // The loans' recorded interest and fee lines, only where the row is counted as spending (it is in the budget and is money out).
  let loanCosts = 0;
  for (const row of ledger.facts.loanCosts) {
    const owner = ledger.account.get(row.accountId);
    if (!owner || !inWindow(row.month, window)) continue;
    const spending = row.categoryId !== null ? !ledger.facts.incomeCategories.has(row.categoryId) : !owner.offBudget && row.amountMinor < 0;
    if (spending) loanCosts += row.amountMinor;
  }
  // `loanCosts` is money out (negative); adding it takes exactly those lines back out of spending.
  const spendingMinor = 0 - (flows.spending + flows.uncategorizedOut) + loanCosts;

  const loans: BufferLoan[] = [];
  for (const account of ledger.account.values()) {
    if (account.accountClass !== "loan" || ledger.balanceAt(account.id, current) >= 0) continue;
    const schedule = schedules.get(account.id);
    if (schedule?.state === "unavailable") return unavailable(`${account.name}: ${schedule.reason}`);
    if (schedule?.state === "ready") {
      loans.push({ accountId: account.id, name: account.name, monthlyMinor: schedule.monthlyMinor, source: "schedule" });
      continue;
    }
    let first: string | null = null;
    for (const row of ledger.facts.movement) if (row.accountId === account.id && (!first || row.month < first)) first = row.month;
    const loanMonths = lastCompleteMonths(today, first, 6);
    if (loanMonths.length < 3) return unavailable(`${account.name} is not tracked in Loans and has fewer than three complete months of recorded repayments`);
    let paid = 0;
    for (const row of ledger.facts.movement) {
      if (row.accountId === account.id && row.transferAccountId && row.amountMinor > 0 && loanMonths.includes(row.month)) paid += row.amountMinor;
    }
    loans.push({ accountId: account.id, name: account.name, monthlyMinor: Math.round(paid / loanMonths.length), source: "recorded" });
  }

  const averageSpending = Math.round(spendingMinor / months.length);
  const monthlyNeedMinor = averageSpending + loans.reduce((sum, l) => sum + l.monthlyMinor, 0);
  if (monthlyNeedMinor <= 0) return unavailable("There is no regular spending to measure against");
  const cashMinor = positionsAt(ledger, current).eligibleCash;
  if (cashMinor < 0) return unavailable("Cash & bank is below zero");
  return ready({ months: cashMinor / monthlyNeedMinor, cashMinor, monthlyNeedMinor, spendingMinor: averageSpending, spendingMonths: months.length, loans });
}
