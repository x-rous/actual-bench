import type { AccountClass } from "@/lib/account-class";
import { isCashEquivalent, type ReportingTreatment } from "@/lib/account-class/reporting";
import { median } from "./bufferScenario";
import { addMonths, lastCompleteMonths, monthOf, type ResolvedPeriod } from "./period";
import { money } from "@/features/financial-insights/format";

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

export type DatedAmount = { month: string; accountId: string; amountMinor: number; /** How many entries the amount sums, when the reader knows. */ count?: number };

/**
 * A row the Asset Registry classifies, so it is not income or spending: a change in an asset's value, or a linked sale
 * (proceeds or selling cost). It leaves the bucket its category, or lack of one, would give it and goes to its own line.
 */
export type ReclassifiedRow = { /** The transaction, so a drilldown can leave it out of income and spending. */ id: string; payeeId: string | null; month: string; accountId: string; categoryId: string | null; amountMinor: number; to: "valueChange" | "assetSale" };

/**
 * One interest or fee line the Loans tracking recorded for a tracked loan. `charged` is true for a charge the lender added to the
 * loan account as its own row (uncategorized, off budget): Spent counts it and the principal repaid is net of it. A split line of a
 * repayment (`charged` false) is a categorized row that spending already holds. Money out is negative.
 */
export type LoanCostRow = { /** The transaction, so a drilldown can list it. */ id?: string; month: string; accountId: string; categoryId: string | null; amountMinor: number; /** The loan these lines belong to, and what they are, when the reader knows. */ loanAccountId?: string; kind?: "interest" | "fee"; charged?: boolean };

export type AccountFact = {
  id: string;
  name: string;
  /** Actual account group; absent or null means the account is ungrouped. */
  groupId?: string | null;
  /** Current group name, or null if the group is unavailable. */
  groupName?: string | null;
  /** Left-out accounts are not facts, they are only named in `FinancialFacts.excluded`. */
  accountClass: AccountClass;
  treatment: ReportingTreatment | null;
  /** Actual's budget placement: it decides what an uncategorized entry means. */
  offBudget: boolean;
  /** Whether the account is closed in Actual. Its historical balance remains in the ledger. */
  closed?: boolean;
  /** The account's balance counts as money you can reach (the "Accessible money" setting), resolved through `flagAllowed`. Absent means no. */
  accessible?: boolean;
  /** Uncategorized money in, in this off-budget Cash or Bank account, is income (the "Interest & income" setting), resolved through `flagAllowed`. Absent means no. */
  offBudgetIncome?: boolean;
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
  /** `warning`: the value is shown, with what may make it too high or too low; it is never a reason to hide the value. */
  | { state: "ready"; value: T; warning?: string }
  | { state: "unavailable"; reason: string }
  | { state: "needsReview"; reason: string };

const ready = <T>(value: T, warning?: string): Status<T> => (warning ? { state: "ready", value, warning } : { state: "ready", value });
const unavailable = <T>(reason: string): Status<T> => ({ state: "unavailable", reason });
const needsReview = <T>(reason: string): Status<T> => ({ state: "needsReview", reason });

/** The result of the Asset Registry check for the selected period. `amountMinor` is the sum of the absolute amounts of the entries to review. */
export type AssetReview = { unavailableReason: string | null; rowCount: number; amountMinor: number };

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
  // Each account's months in order with the running balance at the end of each, so a balance at any month is one search, not a sum
  // over its whole history (it is asked for every account at every month of a chart).
  const running = new Map([...byAccount].map(([id, months]) => {
    const ordered = [...months].sort(([a], [b]) => a.localeCompare(b));
    let total = 0;
    return [id, { months: ordered.map(([m]) => m), balances: ordered.map(([, amount]) => (total += amount)) }] as const;
  }));
  return {
    facts, account, role, firstMonth,
    balanceAt: (accountId, month) => {
      const history = running.get(accountId);
      if (!history) return 0;
      // The last month at or before `month`.
      let low = 0, high = history.months.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (history.months[mid] <= month) low = mid + 1; else high = mid;
      }
      return low === 0 ? 0 : history.balances[low - 1];
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
  /** Uncategorized money out in off-budget accounts, and everything uncategorized in off-budget accounts not set to count money in as income: not income or spending. */
  unidentified: number;
  unidentifiedCount: number;
  /** Uncategorized money in, in off-budget Cash and Bank accounts set to count it as income (interest, for example). Already part of `income`; kept apart so the Income tab can name it. */
  offBudgetIncome: number;
  /** Interest and fees the lender charged as their own rows in the accounts of tracked loans (negative = cost). Part of Spent. */
  loanCharges: number;
  /** Uncategorized non-transfer entries in loan accounts that are not tagged charges (an untracked loan's interest among them). Not income, not spending. */
  loanAccountOther: number;
  loanAccountOtherCount: number;
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
  income: 0, spending: 0, uncategorizedIn: 0, uncategorizedOut: 0, unidentified: 0, unidentifiedCount: 0, offBudgetIncome: 0, loanCharges: 0, loanAccountOther: 0, loanAccountOtherCount: 0, investmentResults: 0, investmentResultsCount: 0, valueChanges: 0, assetSales: 0,
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

/** Spent: a positive amount. Costs of every kind in one place: categories, on-budget uncategorized money out, and loan charges. */
export const spentOf = (flows: Flows): number => 0 - (flows.spending + flows.uncategorizedOut + flows.loanCharges);
/** Received: a positive amount. */
export const receivedOf = (flows: Flows): number => flows.income + flows.uncategorizedIn;

export type Computed = { flows: Flows; cashBridge: CashBridge };

/** Takes a classified row back out of the line its category (or lack of one) gave it. */
function takeOut(flows: Flows, cash: CashBridge | null, account: AccountFact, role: Role, incomeCategories: ReadonlySet<string>, row: { categoryId: string | null; amountMinor: number }) {
  const { categoryId, amountMinor } = row;
  if (categoryId !== null) {
    if (incomeCategories.has(categoryId)) flows.income -= amountMinor;
    else flows.spending -= amountMinor;
    if (cash) { if (incomeCategories.has(categoryId)) cash.operatingIncome -= amountMinor; else cash.operatingSpending -= amountMinor; }
  } else if (account.offBudget && role === "investment") {
    flows.investmentResults -= amountMinor;
    flows.investmentResultsCount -= 1;
  } else if (account.offBudget && role === "loan") {
    flows.loanAccountOther -= amountMinor;
    flows.loanAccountOtherCount -= 1;
  } else if (account.offBudget && account.offBudgetIncome && amountMinor > 0) {
    // Money in, in an off-budget Cash or Bank account set to count it as income.
    flows.income -= amountMinor;
    flows.offBudgetIncome -= amountMinor;
    if (cash) cash.operatingIncome -= amountMinor;
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
  const uncatInCount = new Map<string, number>();
  for (const row of facts.uncategorizedIn) {
    if (!inWindow(row.month, period)) continue;
    const key = `${row.month}|${row.accountId}`;
    uncatIn.set(key, (uncatIn.get(key) ?? 0) + row.amountMinor);
    uncatInCount.set(key, (uncatInCount.get(key) ?? 0) + (row.count ?? 0));
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
    } else if (owner.offBudget && own === "loan") {
      // An entry in a loan account that is not a transfer: often interest or fees the lender charged. Charges of a tracked loan are moved to `loanCharges` below.
      flows.loanAccountOther += amount;
      flows.loanAccountOtherCount += row.count;
    } else if (owner.offBudget && owner.offBudgetIncome) {
      // An off-budget Cash or Bank account set to count money in as income: the positive part is income, the rest stays unidentified.
      // The cell holds both signs; the entries that are money in are counted by the read of the positive part (when it counts them).
      const key = `${row.month}|${row.accountId}`;
      const positive = uncatIn.get(key) ?? 0;
      const rest = amount - positive;
      flows.income += positive;
      flows.offBudgetIncome += positive;
      flows.unidentified += rest;
      flows.unidentifiedCount += Math.max(0, row.count - (uncatInCount.get(key) ?? 0));
      if (own === "cash") { cash.operatingIncome += positive; cash.unidentified += rest; }
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

  // The lender's charges of tracked loans are costs: they leave "other entries" and join Spent. A split line (`charged` false) is
  // already in spending through its category; a charge that carries a category is too, so only uncategorized rows move.
  for (const row of facts.loanCosts) {
    if (!row.charged || row.categoryId !== null || !inWindow(row.month, period) || !isLoanCostInSpent(ledger, row)) continue;
    flows.loanAccountOther -= row.amountMinor;
    flows.loanAccountOtherCount -= 1;
    flows.loanCharges += row.amountMinor;
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
    takeOut(flows, own === "cash" ? cash : null, owner, own ?? "cash", facts.incomeCategories, row);
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

/** Which line of `Positions` an account's balance belongs to: the one definition behind Summary's "What you own and owe" and the Balance Sheet. */
export function positionKey(account: AccountFact, role: Role | undefined): keyof Positions {
  switch (account.accountClass) {
    case "property": return "property";
    case "vehicle": return "vehicle";
    case "other-asset": return "otherAssets";
    case "loan": return "loans";
    case "credit-card": return "cards";
    case "other-liability": return "otherLiabilities";
    default:
      switch (role) {
        case "fixed": return "fixedDeposits";
        case "investment": return "investments";
        default: return "eligibleCash";
      }
  }
}

export function positionsAt(ledger: Ledger, month: string): Positions {
  const p: Positions = { eligibleCash: 0, fixedDeposits: 0, investments: 0, property: 0, vehicle: 0, otherAssets: 0, loans: 0, cards: 0, otherLiabilities: 0 };
  for (const account of ledger.account.values()) p[positionKey(account, ledger.role.get(account.id))] += ledger.balanceAt(account.id, month);
  return p;
}

/**
 * The savings rate: money kept as a percent of what was received, one decimal. The one definition, for a whole period (`summarize`)
 * and for a single month (the Progress tab). Unavailable when nothing was received, and as unavailable as the money kept itself.
 */
export function savingsRateOf(moneyKept: Status<number>, received: number): Status<number> {
  if (moneyKept.state !== "ready") return moneyKept;
  if (received <= 0) return unavailable("There was no income in this period");
  return ready(Math.round((moneyKept.value * 1000) / received) / 10, moneyKept.warning);
}

/** What is owed on credit cards at the end of `month`, a positive amount: a card in credit is ignored. */
export function cardsOwedAt(ledger: Ledger, month: string): number {
  let owed = 0;
  for (const account of ledger.account.values()) if (account.accountClass === "credit-card") owed += Math.max(0, 0 - ledger.balanceAt(account.id, month));
  return owed;
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

  const received = receivedOf(flows);
  const spent = spentOf(flows);
  const kept = received - spent;
  let moneyKept: Status<number>;
  if (review.unavailableReason) moneyKept = needsReview(review.unavailableReason);
  else if (review.rowCount > 0) {
    // Shown with the amount at issue, never withheld: the value is Received less Spent, and these entries may be counted twice in it.
    moneyKept = ready(kept, `${review.rowCount} ${review.rowCount === 1 ? "entry" : "entries"} (${money(review.amountMinor)}) ${review.rowCount === 1 ? "is" : "are"} classified in Assets as capital put into an asset without a recorded transfer, so this may count ${review.rowCount === 1 ? "it" : "them"} twice`);
  } else moneyKept = ready(kept);
  const savingsRate = savingsRateOf(moneyKept, received);

  const explained = flows.income + flows.spending + flows.uncategorizedIn + flows.uncategorizedOut + flows.unidentified + flows.loanCharges + flows.loanAccountOther + flows.investmentResults + flows.valueChanges + flows.assetSales + flows.openingBalances + flows.excludedTransfers + flows.inTransit;
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
  /** Cash & bank less what is owed on credit cards (`grossCashMinor` − `cardsOwedMinor`): what the months are measured on. Never negative. */
  cashMinor: number;
  /** Eligible cash today, before cards. */
  grossCashMinor: number;
  /** What is owed on credit cards today (a positive amount); a card in credit is ignored. */
  cardsOwedMinor: number;
  monthlyNeedMinor: number;
  /** Average monthly spending, without the interest and fees of tracked loans (their repayments are counted whole). */
  spendingMinor: number;
  spendingMonths: number;
  loans: BufferLoan[];
  /** Today's positive balances of the accounts set to "Accessible money" (investments you could reach), in minor units. Absent when no account is set. */
  accessibleMinor?: number;
  /** Those accounts and their balances (positive only), largest first. Absent when no account is set. */
  accessibleAccounts?: { accountId: string; name: string; balanceMinor: number }[];
  /** (`cashMinor` + `accessibleMinor`) ÷ `monthlyNeedMinor`: the months of cover if the accessible accounts were counted too. Absent when no account is set. */
  monthsWithAccessible?: number;
};

/** The loans' recorded interest and fee lines in a window, only where the row is counted in Spent (see `loanCostRowsIn`). Money out is negative. */
export function loanCostsIn(ledger: Ledger, window: ResolvedPeriod): number {
  return loanCostRowsIn(ledger, window).reduce((sum, row) => sum + row.amountMinor, 0);
}

const reclassifiedIdCache = new WeakMap<object, ReadonlySet<string>>();
/** The ids of the entries the Asset Registry classifies (a change in value or a sale), cached per set of facts. */
function reclassifiedIds(facts: FinancialFacts): ReadonlySet<string> {
  let ids = reclassifiedIdCache.get(facts);
  if (!ids) { ids = new Set(facts.reclassified.map((r) => r.id)); reclassifiedIdCache.set(facts, ids); }
  return ids;
}

/**
 * Whether a tagged loan cost row is part of Spent, by the same rules `computeFlows` reads rows with: a categorized row in an expense
 * category; an uncategorized money-out row of an on-budget account; or a charge the lender added to the account of a tracked loan.
 */
export function isLoanCostInSpent(ledger: Ledger, row: LoanCostRow): boolean {
  const owner = ledger.account.get(row.accountId);
  if (!owner) return false;
  // An entry the Asset Registry classifies as a change in value or a sale is not spending, whatever else it is (categorized, split from a repayment or charged by the lender).
  if (row.id !== undefined && reclassifiedIds(ledger.facts).has(row.id)) return false;
  if (row.categoryId !== null) return !ledger.facts.incomeCategories.has(row.categoryId);
  if (row.charged) return ledger.role.get(row.accountId) === "loan" && owner.offBudget;
  return !owner.offBudget && row.amountMinor < 0;
}

/** The loan interest and fee rows of a window that are counted in Spent, so a figure can say what it took out of each category. */
export function loanCostRowsIn(ledger: Ledger, window: ResolvedPeriod): LoanCostRow[] {
  return ledger.facts.loanCosts.filter((row) => inWindow(row.month, window) && isLoanCostInSpent(ledger, row));
}

/**
 * How many months eligible cash, less what is owed on credit cards, would cover, as of today and regardless of the selected period. It uses Actual's
 * recorded obligations. Need = average monthly spending over the last complete months (twelve where available, all of them
 * from three to eleven, unavailable below three) plus what each loan costs each month, in full:
 *  - a tracked loan whose schedule reconciles with Actual: its scheduled repayment (principal, interest and fees); its
 *    interest and fee lines the Loans tracking recorded for it (`facts.loanCosts`, identified by row, never by category) come
 *    out of the spending average so they are not counted twice;
 *  - a tracked loan that does not reconcile makes the buffer unavailable, naming the loan;
 *  - any other loan owed: the average of the transfers recorded into its account over the last complete months (at least
 *    three), which is what was paid in, and can include interest the lender charged, because its interest cannot be told from other spending.
 * An untracked model is never used. The buffer is unavailable, never zero, when any part cannot be known.
 */
export function cashBuffer(ledger: Ledger, today: string, schedules: ReadonlyMap<string, LoanScheduleInput>, options: { /** How many complete months a typical month is taken over (12 by default). */ months?: number; /** How an untracked loan's typical month is worked out from its monthly paid-in sums (the average by default). */ method?: "average" | "median"; /** A typical month's spending worked out elsewhere (a median); the average of the months is used when it is not given. */ spendingMinor?: number } = {}): Status<CashBuffer> {
  const current = monthOf(today);
  const months = lastCompleteMonths(today, ledger.firstMonth, options.months ?? 12);
  if (months.length < 3) return unavailable("Insufficient history: at least three complete months are needed");
  const window: ResolvedPeriod = {
    startMonth: months[0], endMonth: months[months.length - 1], months, startDate: `${months[0]}-01`, endDate: `${months[months.length - 1]}-28`,
    partial: false, label: "",
  };
  const { flows } = computeFlows(ledger, window);
  const loanCosts = loanCostsIn(ledger, window);
  // `loanCosts` is money out (negative); adding it takes exactly those lines back out of spending (lender charges included: they are in Spent too).
  const spendingMinor = spentOf(flows) + loanCosts;

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
    const loanMonths = lastCompleteMonths(today, first, options.months ?? 12);
    if (loanMonths.length < 3) return unavailable(`${account.name} is not tracked in Loans and has fewer than three complete months of recorded repayments`);
    const paidByMonth = new Map(loanMonths.map((m) => [m, 0]));
    for (const row of ledger.facts.movement) {
      if (row.accountId === account.id && row.transferAccountId && row.amountMinor > 0 && paidByMonth.has(row.month)) paidByMonth.set(row.month, paidByMonth.get(row.month)! + row.amountMinor);
    }
    const paid = [...paidByMonth.values()];
    // The same choice as for spending: one extra lump-sum payment does not lift the median.
    loans.push({ accountId: account.id, name: account.name, monthlyMinor: options.method === "median" ? median(paid) : Math.round(paid.reduce((a, v) => a + v, 0) / loanMonths.length), source: "recorded" });
  }

  const averageSpending = options.spendingMinor ?? Math.round(spendingMinor / months.length);
  const monthlyNeedMinor = averageSpending + loans.reduce((sum, l) => sum + l.monthlyMinor, 0);
  if (monthlyNeedMinor <= 0) return unavailable("There is no regular spending to measure against");
  const grossCashMinor = positionsAt(ledger, current).eligibleCash;
  if (grossCashMinor < 0) return unavailable("Cash & bank is below zero");
  // Card purchases are in the spending average, and what is already owed on the cards is committed out of this cash.
  const cardsOwedMinor = cardsOwedAt(ledger, current);
  const cashMinor = grossCashMinor - cardsOwedMinor;
  if (cashMinor < 0) return unavailable("What you owe on credit cards is more than your cash & bank");
  // Accounts set to "Accessible money" (investments you could reach): a second figure, never part of the main one.
  const accessibleAccounts = [...ledger.account.values()].filter((a) => a.accessible).map((a) => ({ accountId: a.id, name: a.name, balanceMinor: Math.max(0, ledger.balanceAt(a.id, current)) })).sort((a, b) => b.balanceMinor - a.balanceMinor);
  const accessibleMinor = accessibleAccounts.reduce((sum, a) => sum + a.balanceMinor, 0);
  return ready({
    months: cashMinor / monthlyNeedMinor, cashMinor, grossCashMinor, cardsOwedMinor, monthlyNeedMinor, spendingMinor: averageSpending, spendingMonths: months.length, loans,
    ...(accessibleAccounts.length ? { accessibleMinor, accessibleAccounts, monthsWithAccessible: (cashMinor + accessibleMinor) / monthlyNeedMinor } : {}),
  });
}
