import type { PickedTransaction, PickerConstraints, PickerFilterState } from "@/components/transactions/transactionPickerQuery";
import type { InsightsOptions } from "@/components/transactions/PickerInsights";
import type { PickerFilterKey } from "@/components/transactions/TransactionFilterBar";
import { computeFlows, type AccountFact, type Ledger } from "./measures";
import { resolvePeriod, type ResolvedPeriod } from "./period";
import { portfolioBridge } from "./wealth";

/**
 * What a figure on the page is made of, so it can open the real transactions behind it in the read-only list. Each target
 * is described with the same classification `measures.ts` uses, so a link and its figure cannot drift apart: the list is
 * a query for exactly those rows, and `expectedMinor` is the figure it should add up to. When the two differ, the list
 * says so rather than hiding it.
 */
export type DrillKind =
  | "received" | "spent" | "uncategorizedIn" | "uncategorizedOut" | "unidentified" | "investmentResults" | "valueChange" | "assetSale"
  | "excludedTransfer" | "contributed" | "withdrawn" | "repaid" | "borrowed"
  /** Loans & cards: what was paid into loan accounts (from any account), and the interest and fees the Loans tracking recorded for tracked loans. */
  | "loanPrincipal" | "loanInterest" | "loanFees"
  /** Cash movements: everyday income and spending in cash accounts, and transfers from cash to cards, fixed deposits, other assets and other liabilities. */
  | "cashIncome" | "cashSpending" | "cardPaid" | "fixedMoved" | "assetsMoved" | "liabilitiesMoved";

export type DrillTarget =
  /** Exact recorded statement membership, including starting balances or unresolved movements when appropriate. */
  | { kind: "statement"; name: string; ids: string[]; amountMinor: number; description?: string }
  | {
    kind: DrillKind; /** `YYYY-MM`; the whole period when absent. */ month?: string; /** With `month`: the range runs through this month. */ throughMonth?: string;
    /**
     * Investments, on `contributed`, `withdrawn` and `investmentResults`: the entries of one investment or
     * retirement account (`accountId`) or of all of them (`portfolio`), read from the account's side. Funding and withdrawals are then
     * every transfer with an account outside the portfolio, not only cash accounts. Loans & cards, on `loanPrincipal`,
     * `loanInterest` and `loanFees`: the entries of one loan (`accountId`) or of every loan.
     */
    accountId?: string; portfolio?: boolean;
  }
  /**
   * Spending in one category or in every category of a group (`categoryIds`), in one month or the whole period;
   * `includeUncategorized` adds the on-budget entries with no category (a group named "Uncategorized"). `amountMinor` is the
   * (positive) figure the link sits on.
   */
  | { kind: "category"; categoryIds: string[]; includeUncategorized?: boolean; /** Money received in these (income) categories, not spending: the list adds up to the amount as it is, and uncategorized means money in. */ income?: boolean; name: string; amountMinor: number; month?: string; /** With `month`: the range runs through this month. */ throughMonth?: string; /** Only the entries of these accounts in these categories, pair by pair (the interest and fees of credit cards, whose categories other accounts or cards may share). */ pairs?: { accountId: string; categoryId: string }[] }
  /** An "in transit" amount. Its rows have to be found first (see `explainInTransit`); then it opens as `inTransitRows`. */
  | { kind: "inTransit"; cashOnly: boolean }
  /** The transfers behind an "in transit" amount, found beforehand, with the reason each is there. */
  | { kind: "inTransitRows"; title: string; ids: string[]; reasons: Record<string, string>; expectedMinor: number }
  /** Spending at one payee (`payeeId` null is "No payee"). */
  | { kind: "payee"; payeeId: string | null; name: string; amountMinor: number; /** Money received from this payer, in income categories, not spending. */ income?: boolean }
  /**
   * Actual's own spending for budget categories (My budget), in one month or from `month` through `throughMonth`: the entries
   * of on-budget accounts, transfers that carry the category included. `amountMinor` is Actual's spent figure (positive is money spent).
   */
  | { kind: "budgetCell"; categoryIds: string[]; name: string; amountMinor: number; month: string; throughMonth?: string }
  /** One explained part of the difference between Actual's spending and the Spending tab (positive `amountMinor` is money spent). */
  | { kind: "budgetGap"; part: "categorizedTransfers" | "offBudget" | "registry"; amountMinor: number; month: string; throughMonth: string };

export type DrillContext = {
  ledger: Ledger;
  period: ResolvedPeriod;
  today: string;
  /** Transactions the Asset Registry classifies (value changes, linked sales): they are not income or spending. */
  reclassifiedIds: ReadonlySet<string>;
};

export type DrillScope = {
  title: string;
  description: string;
  constraints: PickerConstraints;
  lockedLabels: { where: string };
  /** Fixed filters (those not offered to the user) apply as rules. */
  defaults: Partial<PickerFilterState>;
  /** The filters the user may still use inside the scope. */
  filters: PickerFilterKey[];
  /** Only when too many entries are left out to name in the query; the charts are then not offered. */
  rowFilter?: (row: PickedTransaction) => boolean;
  /** The charts above the list, or null when they would not add up to the list. */
  insights: InsightsOptions | null;
  /** Replaces the Notes column, for lists that say why each entry is there. */
  noteColumn?: { header: string; of: (row: PickedTransaction) => string | null };
  /** What the listed rows should add up to (signed, as in the list); null when there is no single figure. */
  expectedMinor: number | null;
};

/** More registry-classified entries than this are checked on the loaded rows instead of named in the query. */
const MAX_NAMED = 300;
const monthName = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });

const TITLES: Record<DrillKind, string> = {
  received: "Money received",
  spent: "Money spent",
  uncategorizedIn: "Money in with no category",
  uncategorizedOut: "Money out with no category",
  unidentified: "Unidentified movements",
  investmentResults: "Investment activity",
  valueChange: "Changes in value",
  assetSale: "Asset sales",
  excludedTransfer: "Transfers with excluded accounts",
  contributed: "Put into investments",
  withdrawn: "Withdrawn from investments",
  repaid: "Repaid to loans",
  borrowed: "Borrowed from loans",
  loanPrincipal: "Principal repaid to loans",
  loanInterest: "Loan interest",
  loanFees: "Loan fees",
  cashIncome: "Income in cash accounts",
  cashSpending: "Spending in cash accounts",
  cardPaid: "Paid to credit cards",
  fixedMoved: "Fixed / restricted deposits",
  assetsMoved: "Moved to and from other assets",
  liabilitiesMoved: "Moved to and from other liabilities",
};

const DESCRIPTIONS: Record<DrillKind, string> = {
  received: "Income-category entries and uncategorized money in on-budget accounts. Transfers and entries the Asset Registry classifies are not included.",
  spent: "Expense-category entries and uncategorized money out of on-budget accounts, refunds included. Transfers and entries the Asset Registry classifies are not included.",
  uncategorizedIn: "Entries with no category in on-budget accounts, money in. They count as received.",
  uncategorizedOut: "Entries with no category in on-budget accounts, money out. They count as spent.",
  unidentified: "Entries with no category in off-budget accounts other than investment accounts. They change your net worth but are not income or spending.",
  investmentResults: "Entries with no category in your investment and retirement accounts: price changes, dividends, interest and fees recorded there. They change your net worth but are not income or spending.",
  valueChange: "Entries the Asset Registry classifies as a change in an asset's value.",
  assetSale: "Entries the Asset Registry links to the sale of an asset.",
  excludedTransfer: "Money moved between an included account and an account you excluded.",
  contributed: "Money moved from cash accounts into investment or retirement accounts.",
  withdrawn: "Money moved from investment or retirement accounts into cash accounts.",
  repaid: "Money moved from cash accounts into loan accounts.",
  borrowed: "Money moved from loan accounts into cash accounts.",
  loanPrincipal: "Money moved into loan accounts from any of your accounts, cash and cards included. It lowers what you owe and is not spending.",
  loanInterest: "The interest lines the Loans tracking recorded for loans tracked in Loans. They are spending, already counted in Spending.",
  loanFees: "The fee lines the Loans tracking recorded for loans tracked in Loans. They are spending, already counted in Spending.",
  cashIncome: "Entries with an income category, and uncategorized money in on-budget accounts, in your cash accounts: income, refunds of it included. Transfers and entries the Asset Registry classifies are not in it.",
  cashSpending: "Entries with an expense category, and uncategorized money out of on-budget accounts, in your cash accounts: spending, refunds included. Transfers and entries the Asset Registry classifies are not in it.",
  cardPaid: "Money moved between cash accounts and credit cards: payments to cards, and refunds or transfers back.",
  fixedMoved: "Money moved between cash accounts and fixed / restricted deposits.",
  assetsMoved: "Money moved between cash accounts and your other assets, such as property, vehicles or other assets.",
  liabilitiesMoved: "Money moved between cash accounts and your other liabilities.",
};

export function drillScope(target: Exclude<DrillTarget, { kind: "inTransit" }>, ctx: DrillContext): DrillScope {
  const { ledger, today } = ctx;
  const { facts, account, role } = ledger;
  const range = target.kind !== "statement" && target.kind !== "payee" && target.kind !== "inTransitRows" && target.month ? { start: target.month, end: ("throughMonth" in target && target.throughMonth) || target.month } : null;
  const window = range ? resolvePeriod({ kind: "custom", startMonth: range.start, endMonth: range.end }, today, ledger.firstMonth) : ctx.period;
  const to = window.endDate < today ? window.endDate : today;
  const when = range ? (range.start === range.end ? monthName(range.start) : `${monthName(range.start)} – ${monthName(range.end)}`) : ctx.period.label;
  const incomeIds = [...facts.incomeCategories];
  const ids = (predicate: (a: AccountFact) => boolean) => [...account.values()].filter(predicate).map((a) => a.id);
  const onBudget = ids((a) => !a.offBudget);
  const offBudget = ids((a) => a.offBudget && role.get(a.id) !== "investment");
  const investmentAccounts = ids((a) => a.offBudget && role.get(a.id) === "investment");
  const cash = ids((a) => role.get(a.id) === "cash");
  const withRole = (r: string) => ids((a) => role.get(a.id) === r);
  const notIncome = incomeIds.map((id) => ({ category: { $ne: id } }));
  const noCategory = (accounts: string[], sign?: "in" | "out") => ({
    $and: [{ category: null }, { account: { $oneof: accounts.length ? accounts : ["-"] } }, ...(sign ? [{ amount: sign === "in" ? { $gt: 0 } : { $lt: 0 } }] : [])],
  });
  const base = {
    constraints: { excludeAccountIds: [...facts.excluded] } as PickerConstraints,
    defaults: { date: { preset: "custom", from: window.startDate, to } } as Partial<PickerFilterState>,
    filters: ["search", "amount", "tags", "payees"] as PickerFilterKey[],
  };
  if (target.kind === "statement") {
    const named = target.ids.length <= MAX_NAMED;
    const wanted = new Set(target.ids);
    return {
      title: `${target.name} · ${when}`, description: target.description ?? "The recorded transactions behind this statement line. Transfers, split children and refunds retain their recorded signs. Nothing can be changed here.",
      constraints: { ...base.constraints, ...(named ? { where: { id: { $oneof: target.ids.length ? target.ids : ["-"] } } } : {}) },
      lockedLabels: { where: target.name }, defaults: base.defaults, filters: base.filters,
      rowFilter: named ? undefined : (row) => wanted.has(row.id), insights: null, expectedMinor: target.amountMinor,
    };
  }
  // Starting balances and registry-classified entries are named in the query, so the charts add up to the list. A very long
  // list of the latter falls back to a check on the loaded rows, and the charts are not offered.
  const leftOut = [...ctx.reclassifiedIds];
  const byRows = leftOut.length > MAX_NAMED;
  const exclusions: Partial<PickerConstraints> = { excludeStartingBalance: true, ...(byRows ? {} : { excludeIds: leftOut }) };
  const rowFilter = byRows ? (row: PickedTransaction) => !ctx.reclassifiedIds.has(row.id) : undefined;
  // The same colour roles as the page: received blue, spent orange, and up/down for a signed list.
  const COLOURS: Record<InsightsOptions["kind"], NonNullable<InsightsOptions["colours"]>> = {
    income: { accent: "var(--fi-income)", negative: "var(--fi-down)" },
    spending: { accent: "var(--fi-spend)", negative: "var(--fi-income)" },
    mixed: { accent: "var(--fi-up)", negative: "var(--fi-down)" },
  };
  const charts = (kind: InsightsOptions["kind"], hide?: InsightsOptions["hide"], more: Partial<InsightsOptions> = {}): InsightsOptions | null => (byRows ? null : { kind, hide, colours: COLOURS[kind], ...more });

  if (target.kind === "inTransitRows") {
    return {
      title: target.title, description: "Transfers between your accounts that do not net to zero inside the period. The reason on each row is what is recorded; nothing is assumed and nothing is changed.",
      constraints: { excludeAccountIds: [...facts.excluded], where: { id: { $oneof: target.ids.length ? target.ids : ["-"] } } }, lockedLabels: { where: "In transit" }, filters: ["search", "amount"],
      defaults: { date: { preset: "all" } }, insights: null, expectedMinor: target.expectedMinor,
      noteColumn: { header: "Why it is here", of: (row) => target.reasons[row.id] ?? null },
    };
  }
  if (target.kind === "category") {
    const ids = target.categoryIds;
    const parts = [...(ids.length ? [{ category: { $oneof: ids } }] : []), ...(target.includeUncategorized ? [noCategory(onBudget, target.income ? "in" : "out")] : [])];
    const many = ids.length + (target.includeUncategorized ? 1 : 0) > 1;
    return {
      title: `${target.name} · ${when}`, description: target.income ? (many ? "Money received in every category of this group, refunds of it netted. Hidden categories are included." : "Money received in this category, refunds of it netted. Hidden categories are included.") : many ? "Spending in every category of this group, refunds included. Hidden categories are included." : "Spending in this category, refunds included. Hidden categories are included.",
      constraints: { ...base.constraints, ...exclusions, excludeTransferPayees: true, where: target.pairs ? (target.pairs.length > 0 ? { $or: target.pairs.map((p) => ({ $and: [{ account: { $oneof: [p.accountId] } }, { category: { $oneof: [p.categoryId] } }] })) } : { id: "-" }) : parts.length > 1 ? { $or: parts } : parts[0] ?? { id: "-" } }, lockedLabels: { where: target.name }, filters: ["search", "amount", "tags", "payees"],
      defaults: base.defaults, rowFilter, insights: charts(target.income ? "income" : "spending", many ? ["groups"] : ["categories", "groups"]), expectedMinor: target.income ? target.amountMinor : 0 - target.amountMinor,
    };
  }
  if (target.kind === "budgetCell" || target.kind === "budgetGap") {
    // Actual's budget counts the entries of on-budget accounts; accounts that are off budget or excluded are left out.
    const leftOutAccounts = [...new Set([...facts.excluded, ...ids((a) => a.offBudget)])];
    if (target.kind === "budgetCell") {
      const many = target.categoryIds.length > 1;
      return {
        title: `${target.name} · ${when}`,
        description: `Actual's own spending for ${many ? "these budget categories" : "this budget category"}: entries in on-budget accounts, transfers that carry ${many ? "a category" : "the category"} and refunds included. Entries dated after today are not listed.`,
        constraints: { excludeAccountIds: leftOutAccounts, where: { category: { $oneof: target.categoryIds.length ? target.categoryIds : ["-"] } } }, lockedLabels: { where: target.name },
        filters: base.filters, defaults: base.defaults, insights: charts("spending", many ? ["groups"] : ["categories", "groups"]), expectedMinor: 0 - target.amountMinor,
      };
    }
    if (target.part === "registry") {
      const named = facts.reclassified.filter((r) => r.categoryId !== null && !facts.incomeCategories.has(r.categoryId) && r.month >= window.startMonth && r.month <= window.endMonth && account.get(r.accountId) && !account.get(r.accountId)!.offBudget).map((r) => r.id);
      return {
        title: `Entries the Asset Registry classifies · ${when}`,
        description: "Entries in on-budget accounts with an expense category that the Asset Registry classifies as a change in value or a sale. Actual still counts them in the category; the Spending tab does not.",
        constraints: { excludeAccountIds: leftOutAccounts, where: { id: { $oneof: named.length ? named : ["-"] } } }, lockedLabels: { where: "Asset Registry entries" },
        filters: base.filters, defaults: base.defaults, insights: null, expectedMinor: 0 - target.amountMinor,
      };
    }
    const transfers = target.part === "categorizedTransfers";
    return {
      title: `${transfers ? "Categorized transfers" : "Categorized entries in off-budget accounts"} · ${when}`,
      description: transfers
        ? "Transfers out of on-budget accounts that carry an expense category. Actual counts them in that category's spending; the Spending tab treats a transfer as neither income nor spending."
        : "Entries with an expense category in your off-budget accounts. The Spending tab counts them; Actual's budget only counts on-budget accounts.",
      constraints: transfers
        ? { excludeAccountIds: leftOutAccounts, where: { $and: [{ category: { $ne: null } }, ...notIncome, { "payee.transfer_acct": { $ne: null } }] } }
        : { ...base.constraints, ...exclusions, excludeTransferPayees: true, where: { $and: [{ category: { $ne: null } }, ...notIncome, { account: { $oneof: ids((a) => a.offBudget).length ? ids((a) => a.offBudget) : ["-"] } }] } },
      lockedLabels: { where: transfers ? "Categorized transfers" : "Off-budget accounts" }, filters: base.filters, defaults: base.defaults,
      rowFilter: transfers ? undefined : rowFilter, insights: charts("spending", ["groups"]), expectedMinor: 0 - target.amountMinor,
    };
  }
  if (target.kind === "payee") {
    return {
      title: `${target.name} · ${ctx.period.label}`, description: target.income ? "Money received from this payer, in income categories, refunds of it netted." : "Spending at this payee, in expense categories, refunds included.",
      constraints: { ...base.constraints, ...exclusions, requireCategory: true, excludeTransferPayees: true, where: target.income ? (incomeIds.length ? { category: { $oneof: incomeIds } } : { id: "-" }) : { $and: notIncome } }, lockedLabels: { where: target.name },
      filters: ["search", "amount", "tags"],
      defaults: { ...base.defaults, payees: target.payeeId === null ? { ids: [], not: false, none: true } : { ids: [target.payeeId], not: false, none: false } },
      rowFilter, insights: charts(target.income ? "income" : "spending", ["payees"]), expectedMinor: target.income ? target.amountMinor : 0 - target.amountMinor,
    };
  }

  const { flows, cashBridge } = computeFlows(ledger, window);
  const wealth = target.accountId !== undefined || target.portfolio ? portfolioBridge(ledger, window) : null;
  const scope = (where: object | undefined, extra: Partial<PickerConstraints>, expectedMinor: number, kind: InsightsOptions["kind"], own = false, more: Partial<InsightsOptions> = {}): DrillScope => ({
    title: `${TITLES[target.kind]} · ${when}`, description: DESCRIPTIONS[target.kind],
    constraints: { ...base.constraints, ...(own ? {} : exclusions), ...extra, ...(where ? { where } : {}) }, lockedLabels: { where: TITLES[target.kind] },
    defaults: base.defaults, filters: base.filters, rowFilter: own ? undefined : rowFilter, insights: charts(kind, undefined, more), expectedMinor,
  });
  if (target.kind === "loanPrincipal" || target.kind === "loanInterest" || target.kind === "loanFees") {
    const loans = withRole("loan");
    const mine = target.accountId !== undefined ? loans.filter((id) => id === target.accountId) : loans;
    const named = target.accountId !== undefined ? ` · ${account.get(target.accountId)?.name ?? "loan"}` : "";
    const inWindow = (month: string) => month >= window.startMonth && month <= window.endMonth;
    const labelled = (s: DrillScope): DrillScope => ({ ...s, title: `${TITLES[target.kind]}${named} · ${when}` });
    if (target.kind === "loanPrincipal") {
      // As debtRepayments reads them: positive transfer rows into a loan, from anything but an excluded account.
      const figure = facts.transfersIn.filter((r) => inWindow(r.month) && mine.includes(r.accountId) && !facts.excluded.has(r.transferAccountId)).reduce((sum, r) => sum + r.amountMinor, 0);
      return labelled(scope(
        { $and: [{ account: { $oneof: mine.length ? mine : ["-"] } }, { "payee.transfer_acct": { $ne: null } }, ...[...facts.excluded].map((id) => ({ "payee.transfer_acct": { $ne: id } }))] },
        { amountSign: "positive" }, figure, "spending", true,
        { initialView: "accounts", noun: "repaid to loans", colours: { accent: "var(--fi-invest)", negative: "var(--fi-down)" } },
      ));
    }
    const kind = target.kind === "loanInterest" ? "interest" : "fee";
    const rows = facts.loanCosts.filter((r) => r.kind === kind && r.id && r.loanAccountId && mine.includes(r.loanAccountId) && inWindow(r.month));
    return labelled(scope({ id: { $oneof: rows.length ? rows.map((r) => r.id!) : ["-"] } }, {}, rows.reduce((sum, r) => sum + r.amountMinor, 0), "spending", true, { initialView: "accounts" }));
  }
  if (wealth && (target.kind === "contributed" || target.kind === "withdrawn" || target.kind === "investmentResults")) {
    const mine = target.accountId !== undefined ? wealth.accounts.filter((a) => a.accountId === target.accountId) : wealth.accounts;
    const figure = (pick: (a: (typeof mine)[number]) => number) => mine.reduce((sum, a) => sum + pick(a), 0);
    const accountIds = mine.map((a) => a.accountId);
    const of = (list: string[]) => (list.length ? list : ["-"]);
    const named = target.accountId !== undefined ? ` · ${account.get(target.accountId)?.name ?? "account"}` : "";
    const labelled = (s: DrillScope): DrillScope => ({ ...s, title: `${TITLES[target.kind]}${named} · ${when}` });
    if (target.kind === "investmentResults") {
      // Only off-budget accounts have investment results (an on-budget account's uncategorized entries are income or spending).
      const offBudgetIds = mine.filter((a) => a.offBudget).map((a) => a.accountId);
      return labelled(scope(noCategory(offBudgetIds), { excludeTransferPayees: true }, figure((a) => a.activity), "mixed", false, { initialView: "accounts" }));
    }
    // Funding and withdrawals: transfers between the account(s) and anything outside the portfolio, money in or money out.
    const portfolioIds = withRole("investment");
    const funding = target.kind === "contributed";
    return labelled(scope(
      { $and: [{ account: { $oneof: of(accountIds) } }, { "payee.transfer_acct": { $ne: null } }, ...portfolioIds.map((id) => ({ "payee.transfer_acct": { $ne: id } }))] },
      { amountSign: funding ? "positive" : "negative" }, figure((a) => (funding ? a.funding : a.withdrawals)), funding ? "income" : "spending", true,
      { initialView: "accounts", noun: funding ? "put into investments" : "withdrawn", colours: funding ? { accent: "var(--fi-invest)", negative: "var(--fi-down)" } : { accent: "var(--fi-income)", negative: "var(--fi-down)" } },
    ));
  }
  switch (target.kind) {
    case "received":
      return scope({ $or: [...(incomeIds.length ? [{ category: { $oneof: incomeIds } }] : []), noCategory(onBudget, "in")] }, { excludeTransferPayees: true }, flows.income + flows.uncategorizedIn, "income");
    case "spent":
      return scope({ $or: [{ $and: [{ category: { $ne: null } }, ...notIncome] }, noCategory(onBudget, "out")] }, { excludeTransferPayees: true }, flows.spending + flows.uncategorizedOut, "spending");
    case "uncategorizedIn":
      return scope(noCategory(onBudget, "in"), { excludeTransferPayees: true }, flows.uncategorizedIn, "income", false, { initialView: "accounts" });
    case "uncategorizedOut":
      return scope(noCategory(onBudget, "out"), { excludeTransferPayees: true }, flows.uncategorizedOut, "spending", false, { initialView: "accounts" });
    case "investmentResults":
      return scope(noCategory(investmentAccounts), { excludeTransferPayees: true }, flows.investmentResults, "mixed", false, { initialView: "accounts" });
    case "unidentified":
      return scope(noCategory(offBudget), { excludeTransferPayees: true }, flows.unidentified, "mixed", false, { initialView: "accounts" });
    case "valueChange":
    case "assetSale": {
      const to_ = target.kind === "valueChange" ? "valueChange" : "assetSale";
      const rows = facts.reclassified.filter((r) => r.to === to_ && r.month >= window.startMonth && r.month <= window.endMonth && account.has(r.accountId));
      return scope({ id: { $oneof: rows.length ? rows.map((r) => r.id) : ["-"] } }, {}, to_ === "valueChange" ? flows.valueChanges : flows.assetSales, "mixed", true, { initialView: "accounts" });
    }
    case "excludedTransfer":
      return scope({ "payee.transfer_acct": { $oneof: facts.excluded.size ? [...facts.excluded] : ["-"] } }, {}, flows.excludedTransfers, "mixed", true, { initialView: "accounts" });
    case "cashIncome":
      return scope(
        { $and: [{ account: { $oneof: cash.length ? cash : ["-"] } }, { $or: [...(incomeIds.length ? [{ category: { $oneof: incomeIds } }] : []), noCategory(onBudget.filter((id) => cash.includes(id)), "in")] }] },
        { excludeTransferPayees: true }, cashBridge.operatingIncome, "income", false, { initialView: "accounts" },
      );
    case "cashSpending":
      return scope(
        { $and: [{ account: { $oneof: cash.length ? cash : ["-"] } }, { $or: [{ $and: [{ category: { $ne: null } }, ...notIncome] }, noCategory(onBudget.filter((id) => cash.includes(id)), "out")] }] },
        { excludeTransferPayees: true }, cashBridge.operatingSpending, "spending", false, { initialView: "accounts" },
      );
    case "cardPaid":
    case "fixedMoved":
    case "assetsMoved":
    case "liabilitiesMoved": {
      const other = withRole({ cardPaid: "card", fixedMoved: "fixed", assetsMoved: "asset", liabilitiesMoved: "liability" }[target.kind]);
      const expected = { cardPaid: cashBridge.card, fixedMoved: cashBridge.fixedDeposits, assetsMoved: cashBridge.assets, liabilitiesMoved: cashBridge.liabilities }[target.kind];
      return scope(
        { $and: [{ account: { $oneof: cash.length ? cash : ["-"] } }, { "payee.transfer_acct": { $oneof: other.length ? other : ["-"] } }] },
        {}, expected, "mixed", true, { initialView: "accounts" },
      );
    }
    case "contributed":
    case "withdrawn":
    case "repaid":
    case "borrowed": {
      const toInvestments = target.kind === "contributed" || target.kind === "withdrawn";
      const outgoing = target.kind === "contributed" || target.kind === "repaid";
      const other = withRole(toInvestments ? "investment" : "loan");
      const expected = { contributed: cashBridge.investmentOut, withdrawn: cashBridge.investmentIn, repaid: cashBridge.loanOut, borrowed: cashBridge.loanIn }[target.kind];
      return scope(
        { $and: [{ account: { $oneof: cash.length ? cash : ["-"] } }, { "payee.transfer_acct": { $oneof: other.length ? other : ["-"] } }] },
        { amountSign: outgoing ? "negative" : "positive" }, expected, outgoing ? "spending" : "income", true,
        { initialView: "accounts", noun: { contributed: "put into investments", withdrawn: "withdrawn", repaid: "repaid", borrowed: "borrowed" }[target.kind], colours: target.kind === "contributed" ? { accent: "var(--fi-invest)", negative: "var(--fi-down)" } : target.kind === "withdrawn" ? { accent: "var(--fi-income)", negative: "var(--fi-down)" } : { accent: "var(--fi-loan)", negative: "var(--fi-down)" } },
      );
    }
  }
}
