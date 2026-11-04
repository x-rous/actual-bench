import type { AccountClass } from "@/lib/account-class";
import { REPORTING_LABELS, isCashEquivalent, reportingRequirement } from "@/lib/account-class/reporting";
import { trackedEquity, type AssetDebtLink } from "@/lib/asset-registry/financing";
import { valueBridge, type ValueBridge } from "@/lib/asset-registry/valueBridge";
import { ASSET_CLASSES, CLASS_LABEL, LIABILITY_CLASSES, type ClassKey } from "./breakdowns";
import type { AccountFact, Ledger, Role } from "./measures";
import { addMonths, type ResolvedPeriod } from "./period";

/**
 * Wealth & investments, from the facts the page already holds. Pure: no I/O, no clock. Amounts are signed integer minor units
 * (assets positive, debts negative). The portfolio bridge is a projection of the same classification as `computeFlows`:
 * every movement row goes to exactly one line, so a figure here can only differ from Money in & out by how the line is drawn.
 * Nothing here is a return: it shows what went in, what came out, what was recorded inside and what is left unexplained.
 */

// ─── Portfolio bridge ────────────────────────────────────────────────────────

export type AccountBridge = {
  accountId: string;
  name: string;
  /** The label of the account's Financial Reporting treatment. */
  treatment: string;
  offBudget: boolean;
  /** Balance at the end of the month before the period starts. */
  opening: number;
  closing: number;
  /** Transfers in from accounts outside the portfolio (cash, cards, loans, assets, excluded accounts). */
  funding: number;
  /** Transfers out to accounts outside the portfolio (negative). */
  withdrawals: number;
  /** The part of funding that came from an excluded account, and the part of funding and withdrawals that is with cash accounts. */
  fundingFromExcluded: number;
  fundingFromCash: number;
  withdrawalsToCash: number;
  /** Transfers with another portfolio account: they cancel in the totals when both sides fall in the period. */
  between: number;
  /** Rows with no category in an off-budget account: price changes, dividends, interest and fees recorded there. */
  activity: number;
  activityCount: number;
  /** Starting balances of accounts opened in the period. */
  openingBalances: number;
  /** Closing less opening less every line; shown (inside Other), never forced to zero. */
  unexplained: number;
};

type Sums = Omit<AccountBridge, "accountId" | "name" | "treatment" | "offBudget">;
export type PortfolioBridge = { accounts: AccountBridge[]; total: Sums };

const inWindow = (month: string, period: ResolvedPeriod) => month >= period.startMonth && month <= period.endMonth;
const emptySums = (): Sums => ({
  opening: 0, closing: 0, funding: 0, withdrawals: 0, fundingFromExcluded: 0, fundingFromCash: 0, withdrawalsToCash: 0, between: 0, activity: 0, activityCount: 0,
  openingBalances: 0, unexplained: 0,
});

/** The label of the account's reporting treatment: automatic for most classes, the saved choice for the rest. */
export function treatmentLabel(account: AccountFact): string {
  const requirement = reportingRequirement(account.accountClass);
  if (requirement.kind === "automatic") return requirement.label;
  if (requirement.kind === "bank-default") return isCashEquivalent("bank", account.treatment) ? requirement.label : REPORTING_LABELS["fixed-deposit"];
  return account.treatment ? REPORTING_LABELS[account.treatment] : "Not set";
}

export function portfolioBridge(ledger: Ledger, period: ResolvedPeriod): PortfolioBridge {
  const { facts, role, account } = ledger;
  const before = addMonths(period.startMonth, -1);
  const portfolio = [...account.values()].filter((a) => role.get(a.id) === "investment");
  const sums = new Map<string, Sums>(portfolio.map((a) => [a.id, emptySums()]));

  // Transfers with an account outside the portfolio, by month, account and counterpart: the cell holds the net, the read of
  // positive rows holds what came in, so a contribution and a withdrawal in one month are never netted into one figure.
  const received = new Map<string, number>();
  for (const row of facts.transfersIn) {
    if (inWindow(row.month, period) && sums.has(row.accountId)) received.set(`${row.month}|${row.accountId}|${row.transferAccountId}`, (received.get(`${row.month}|${row.accountId}|${row.transferAccountId}`) ?? 0) + row.amountMinor);
  }
  const outside = new Map<string, { accountId: string; counterpart: string; net: number }>();
  for (const row of facts.movement) {
    const mine = sums.get(row.accountId);
    if (!mine || !inWindow(row.month, period)) continue;
    const owner = account.get(row.accountId)!;
    if (row.transferAccountId) {
      if (role.get(row.transferAccountId) === "investment") { mine.between += row.amountMinor; continue; }
      const key = `${row.month}|${row.accountId}|${row.transferAccountId}`;
      const cell = outside.get(key) ?? { accountId: row.accountId, counterpart: row.transferAccountId, net: 0 };
      cell.net += row.amountMinor;
      outside.set(key, cell);
    } else if (row.categoryId === null && owner.offBudget) {
      mine.activity += row.amountMinor;
      mine.activityCount += row.count;
    }
    // Anything else (an entry with a category, which an off-budget account does not normally hold) is on no line: it is left in Other.
  }
  for (const [key, cell] of outside) {
    const mine = sums.get(cell.accountId)!;
    const into = received.get(key) ?? 0;
    const out = cell.net - into;
    mine.funding += into;
    mine.withdrawals += out;
    if (facts.excluded.has(cell.counterpart)) mine.fundingFromExcluded += into;
    if (role.get(cell.counterpart) === "cash") { mine.fundingFromCash += into; mine.withdrawalsToCash += out; }
  }

  // A row the Asset Registry classifies (a linked sale) is not investment activity, as on Money in & out: it is left in Other.
  for (const row of facts.reclassified) {
    const mine = sums.get(row.accountId);
    if (mine && inWindow(row.month, period) && row.categoryId === null && account.get(row.accountId)!.offBudget) { mine.activity -= row.amountMinor; mine.activityCount -= 1; }
  }
  for (const row of facts.startingBalances) {
    const mine = sums.get(row.accountId);
    if (mine && inWindow(row.month, period)) mine.openingBalances += row.amountMinor;
  }

  const total = emptySums();
  const accounts = portfolio.map((a): AccountBridge => {
    const mine = sums.get(a.id)!;
    mine.opening = ledger.balanceAt(a.id, before);
    mine.closing = ledger.balanceAt(a.id, period.endMonth);
    mine.unexplained = mine.closing - mine.opening - (mine.funding + mine.withdrawals + mine.between + mine.activity + mine.openingBalances);
    for (const k of Object.keys(total) as (keyof Sums)[]) total[k] += mine[k];
    return { accountId: a.id, name: a.name, treatment: treatmentLabel(a), offBudget: a.offBudget, ...mine };
  });
  return { accounts, total };
}

/** The portfolio's lines for each month of the period, from the same bridge (a month is a period of one month), so a month's figures add up to the period's. */
export function portfolioMonthly(ledger: Ledger, period: ResolvedPeriod): PortfolioBridge["total"][] {
  return period.months.map((month) => portfolioBridge(ledger, { ...period, startMonth: month, endMonth: month, months: [month], startDate: `${month}-01`, endDate: month === period.endMonth ? period.endDate : `${month}-28`, partial: false }).total);
}

/** Everything that has no line of its own: transfers between investment accounts and what the lines do not explain. */
export const otherOf = (s: Sums) => s.between + s.unexplained;

/** What the lines of a bridge add up to; equal to its closing value unless something is unexplained. */
export const bridgeLines = (s: Sums) => s.funding + s.withdrawals + s.between + s.activity + s.openingBalances;

// ─── Portfolio value by month ────────────────────────────────────────────────

export type PortfolioSeries = { months: string[]; accounts: { accountId: string; name: string; values: (number | null)[] }[]; totals: (number | null)[] };

/** Month-end value per portfolio account. A month before the budget has any data is unavailable, never zero. */
export function portfolioSeries(ledger: Ledger, period: ResolvedPeriod): PortfolioSeries {
  const portfolio = [...ledger.account.values()].filter((a) => ledger.role.get(a.id) === "investment");
  const known = (month: string) => ledger.firstMonth !== null && month >= ledger.firstMonth;
  const accounts = portfolio.map((a) => ({ accountId: a.id, name: a.name, values: period.months.map((m) => (known(m) ? ledger.balanceAt(a.id, m) : null)) }))
    .filter((a) => a.values.some((v) => v !== null && v !== 0));
  const totals = period.months.map((m, i) => (known(m) ? accounts.reduce((sum, a) => sum + (a.values[i] ?? 0), 0) : null));
  return { months: period.months, accounts, totals };
}

// ─── Asset values, equity and loan-to-value ──────────────────────────────────

/** One row of an account's book as the Asset Registry attributes it. */
export type BookRow = { assetId: string | null; date: string; classification: string | null; amountMinor: number };
/** An account's attributed book, or null when it could not be read; `available` is false when it does not reconcile with Actual. */
export type AssetBook = { available: boolean; rows: readonly BookRow[] };
export type RegistryAsset = { id: string; name: string; actualAccountId: string; status: string };
/** A loan the registry links to, and the Actual account that holds its balance. */
export type LoanRef = { debtId: string; accountId: string | null; signConvention: "negative-is-debt" | "positive-is-debt" };

export type EquityPoint = { assetValueMinor: number | null; debtMinor: number | null; equityMinor: number | null; /** Debt ÷ asset value, in percent with one decimal. */ ltvPercent: number | null; gaps: string[] };

export type AssetValueRow =
  | { kind: "registered"; assetId: string; name: string; accountId: string; accountClass: AccountClass; state: "ready"; bridge: ValueBridge; linked: boolean; equity: { start: EquityPoint; end: EquityPoint } }
  | { kind: "registered"; assetId: string; name: string; accountId: string; accountClass: AccountClass; state: "unavailable"; reason: string; closingMinor: number; openingMinor: number; linked: boolean }
  | { kind: "unregistered"; accountId: string; name: string; accountClass: AccountClass; openingMinor: number; closingMinor: number };

/**
 * An account that is a fixed asset: Property, Vehicle, or an Other Asset marked Fixed asset. An Other Asset that is a current or
 * non-current holding (money owed to you, a long-term deposit) is not one: it has no place among the assets of the Assets module.
 */
export const isFixedAssetAccount = (a: Pick<AccountFact, "accountClass" | "treatment">): boolean => a.accountClass === "property" || a.accountClass === "vehicle" || (a.accountClass === "other-asset" && a.treatment === "fixed-asset");

/** Positive Actual debt of a linked loan on a month end (the account's own balance), or null when that account is not counted here. */
function debtOn(ledger: Ledger, loan: LoanRef | undefined, month: string): number | null {
  if (!loan?.accountId || !ledger.account.has(loan.accountId)) return null;
  const balance = ledger.balanceAt(loan.accountId, month);
  return loan.signConvention === "negative-is-debt" ? -balance : balance;
}

function equityAt(asset: RegistryAsset, date: string, month: string, rows: readonly BookRow[], links: readonly AssetDebtLink[], loans: ReadonlyMap<string, LoanRef>, ledger: Ledger): EquityPoint {
  const value = rows.filter((r) => r.assetId === asset.id && r.date <= date).reduce((sum, r) => sum + r.amountMinor, 0);
  const debtIds = [...new Set(links.filter((l) => l.assetId === asset.id).map((l) => l.debtId))];
  const result = trackedEquity(asset.id, date, [...links], value, debtIds.map((debtId) => ({ debtId, magnitudeMinor: debtOn(ledger, loans.get(debtId), month) })));
  const ltv = result.allocatedDebtMinor !== null && value !== null && value > 0 ? Math.round((result.allocatedDebtMinor * 1000) / value) / 10 : null;
  return { assetValueMinor: value, debtMinor: result.allocatedDebtMinor, equityMinor: result.equityMinor, ltvPercent: ltv, gaps: result.gaps };
}

/**
 * One row per registered property, vehicle or other asset (the Asset Registry's own `valueBridge`, over the rows it attributes to
 * the asset), with equity and loan-to-value at the end of the period and the day before it starts (`trackedEquity`, with the
 * loan accounts' balances). An asset account that is not registered shows opening and closing only.
 */
export function assetValues(input: { ledger: Ledger; period: ResolvedPeriod; assets: readonly RegistryAsset[]; books: ReadonlyMap<string, AssetBook | null>; links: readonly AssetDebtLink[]; loans: readonly LoanRef[]; /** Why an account was not read at all (for example, too many entries). */ unreadable?: ReadonlyMap<string, string> }): AssetValueRow[] {
  const { ledger, period, assets, books, links } = input;
  const loans = new Map(input.loans.map((l) => [l.debtId, l]));
  const before = addMonths(period.startMonth, -1);
  const startDate = new Date(Date.parse(`${period.startDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const rows: AssetValueRow[] = [];
  const registered = new Set<string>();
  for (const asset of assets) {
    const owner = ledger.account.get(asset.actualAccountId);
    if (!owner || asset.status === "archived") continue;
    // A fixed asset by class and treatment. An asset whose account has lost that (an Other Asset now marked as a current or
    // non-current holding) stays in the list as unavailable, so its linked loan and its value are not silently dropped.
    if (!isFixedAssetAccount(owner)) {
      if (owner.accountClass === "property" || owner.accountClass === "vehicle" || owner.accountClass === "other-asset") {
        rows.push({ kind: "registered", assetId: asset.id, name: asset.name, accountId: asset.actualAccountId, accountClass: owner.accountClass, linked: links.some((l) => l.assetId === asset.id), state: "unavailable", reason: "Its account is no longer a fixed asset in Financial Reporting, so Assets and Financial Insights disagree about it; review it in Assets", openingMinor: ledger.balanceAt(asset.actualAccountId, before), closingMinor: ledger.balanceAt(asset.actualAccountId, period.endMonth) });
      }
      continue;
    }
    registered.add(asset.actualAccountId);
    const book = books.get(asset.actualAccountId) ?? null;
    const linked = links.some((l) => l.assetId === asset.id);
    const base = { kind: "registered" as const, assetId: asset.id, name: asset.name, accountId: asset.actualAccountId, accountClass: owner.accountClass, linked };
    if (!book || !book.available) {
      rows.push({ ...base, state: "unavailable", reason: input.unreadable?.get(asset.actualAccountId) ?? (book ? "The account does not reconcile with Actual, so its value history cannot be relied on" : "The account could not be read"), openingMinor: ledger.balanceAt(asset.actualAccountId, before), closingMinor: ledger.balanceAt(asset.actualAccountId, period.endMonth) });
      continue;
    }
    const own = book.rows.filter((r) => r.assetId === asset.id);
    rows.push({
      ...base, state: "ready", bridge: valueBridge([...own], period.startDate, period.endDate),
      equity: { start: equityAt(asset, startDate, before, book.rows, links, loans, ledger), end: equityAt(asset, period.endDate, period.endMonth, book.rows, links, loans, ledger) },
    });
  }
  for (const a of ledger.account.values()) {
    if (!isFixedAssetAccount(a) || registered.has(a.id)) continue;
    rows.push({ kind: "unregistered", accountId: a.id, name: a.name, accountClass: a.accountClass, openingMinor: ledger.balanceAt(a.id, before), closingMinor: ledger.balanceAt(a.id, period.endMonth) });
  }
  return rows;
}

/** Equity across the linked assets: the sum, or why it cannot be given. */
export type HomeEquity =
  | { state: "notLinked" }
  | { state: "unavailable"; reason: string }
  | { state: "ready"; endMinor: number; startMinor: number | null; ltvPercent: number | null };

export function homeEquity(rows: readonly AssetValueRow[]): HomeEquity {
  const linked = rows.filter((r): r is Extract<AssetValueRow, { kind: "registered" }> => r.kind === "registered" && r.linked);
  if (linked.length === 0) return { state: "notLinked" };
  let end = 0, start = 0, startKnown = true, startValue = 0, debt = 0, value = 0;
  for (const r of linked) {
    if (r.state !== "ready") return { state: "unavailable", reason: `${r.name}: ${r.reason}` };
    const e = r.equity.end;
    if (e.equityMinor === null || e.debtMinor === null || e.assetValueMinor === null) return { state: "unavailable", reason: `${r.name}: ${e.gaps[0] ?? "an input is missing"}` };
    end += e.equityMinor; debt += e.debtMinor; value += e.assetValueMinor;
    if (r.equity.start.equityMinor === null) startKnown = false; else { start += r.equity.start.equityMinor; startValue += r.equity.start.assetValueMinor ?? 0; }
  }
  // An asset that had no value at the start of the period has no equity to compare with.
  return { state: "ready", endMinor: end, startMinor: startKnown && startValue !== 0 ? start : null, ltvPercent: value > 0 ? Math.round((debt * 1000) / value) / 10 : null };
}

// ─── Everything you own and owe ──────────────────────────────────────────────

export type HoldingRow = { accountId: string; name: string; treatment: string; openingMinor: number; closingMinor: number; changeMinor: number };
export type HoldingGroup = { key: ClassKey; label: string; openingMinor: number; closingMinor: number; changeMinor: number; rows: HoldingRow[] };

export function classKeyOf(account: AccountFact, role: Role | undefined): ClassKey {
  switch (account.accountClass) {
    case "property": return "property";
    case "vehicle": return "vehicle";
    case "other-asset": return "other";
    case "loan": return "loans";
    case "credit-card": return "cards";
    case "other-liability": return "otherLiability";
    default: return role === "fixed" ? "fixed" : role === "investment" ? "invest" : "cash";
  }
}

/** Every counted account, grouped by class, at the start and end of the period. Liabilities are negative and appear once. */
export function holdings(ledger: Ledger, period: ResolvedPeriod): { groups: HoldingGroup[]; netWorth: { openingMinor: number; closingMinor: number } } {
  const before = addMonths(period.startMonth, -1);
  const groups = new Map<ClassKey, HoldingGroup>();
  for (const a of ledger.account.values()) {
    const key = classKeyOf(a, ledger.role.get(a.id));
    const group = groups.get(key) ?? { key, label: CLASS_LABEL[key], openingMinor: 0, closingMinor: 0, changeMinor: 0, rows: [] };
    const openingMinor = ledger.balanceAt(a.id, before), closingMinor = ledger.balanceAt(a.id, period.endMonth);
    group.rows.push({ accountId: a.id, name: a.name, treatment: treatmentLabel(a), openingMinor, closingMinor, changeMinor: closingMinor - openingMinor });
    group.openingMinor += openingMinor; group.closingMinor += closingMinor; group.changeMinor += closingMinor - openingMinor;
    groups.set(key, group);
  }
  const ordered = [...ASSET_CLASSES, ...LIABILITY_CLASSES].flatMap((k) => (groups.has(k) ? [groups.get(k)!] : []));
  return { groups: ordered, netWorth: { openingMinor: ordered.reduce((s, g) => s + g.openingMinor, 0), closingMinor: ordered.reduce((s, g) => s + g.closingMinor, 0) } };
}
