import { isCashEquivalent } from "@/lib/account-class/reporting";
import { classificationOf } from "./assetReview";
import type { CategoryInfo } from "./breakdowns";
import { isLoanCostInSpent, type Ledger } from "./measures";
import { addMonths, type ResolvedPeriod } from "./period";
import type { AssetEntry, SavedClassification } from "./assetReview";

/** One recorded Actual split child or ordinary transaction. All amounts are signed integer minor units. */
export type StatementEntry = {
  id: string; date: string; accountId: string; categoryId: string | null; amountMinor: number;
  transferAccountId: string | null; transferId: string | null; parentId: string | null; startingBalance: boolean;
};

/** A transaction-backed statement line; refunds and reversals retain their signs. Amounts are integer minor units. */
export type StatementLine = {
  key: string; label: string; amountMinor: number; ids: string[]; detail?: string;
  /** The transactions to open when the rows behind the line do not add up to its figure as they are recorded (they are shown from the other side of a transfer). */
  drill?: { ids: string[]; amountMinor: number };
};
export type StatementGroup = StatementLine & { rows: StatementLine[] };
export type StatementSection = { key: string; label: string; rows: StatementLine[]; amountMinor: number };
/** Read-only statements. Balance agreement and classification completeness are independent. Amounts are integer minor units. */
export type Statements = {
  cash: { openingMinor: number; closingMinor: number; changeMinor: number; sections: StatementSection[]; adjustments: StatementLine[]; differenceMinor: number };
  pnl: { income: StatementGroup[]; expenses: StatementGroup[]; incomeMinor: number; expensesMinor: number; surplusMinor: number; basisIssue: string | null };
  unresolved: StatementLine[];
  /** Recorded uncategorized activity inside off-budget Investment / Retirement accounts; outside cash flow and P&L. */
  investmentActivity: StatementLine;
  bridge: { label: string; amountMinor: number }[];
  classificationComplete: boolean;
};

const total = (rows: readonly { amountMinor: number }[]) => rows.reduce((sum, row) => sum + row.amountMinor, 0);
const line = (key: string, label: string, detail?: string): StatementLine => ({ key, label, detail, amountMinor: 0, ids: [] });
const add = (to: StatementLine, entry: StatementEntry) => { to.amountMinor += entry.amountMinor; to.ids.push(entry.id); };

/**
 * The transactions a section subtotal opens, or none when they cannot add up to it. A line that opens from the other side of a
 * transfer (it has its own `drill` with a different figure) cannot be listed together with the others, so the subtotal is then a plain figure
 * and its lines open one by one.
 */
export function subtotalIds(rows: readonly StatementLine[]): string[] {
  // Also when the figures happen to agree (a zero principal): the line's rows are not the rows that make it up.
  const apart = (r: StatementLine) => !!r.drill && (r.drill.amountMinor !== r.amountMinor || r.drill.ids.length !== r.ids.length || r.drill.ids.some((id, i) => id !== r.ids[i]));
  return rows.some(apart) ? [] : rows.flatMap((r) => r.ids);
}

/**
 * A statement projection of the shared ledger, using recorded rows for exact membership and drill-downs.
 * Follows Received/Spent: categories determine income/expense; uncategorized on-budget rows follow their sign.
 * Uncategorized off-budget investment rows are investment activity, separately from genuinely unidentified movements.
 * No budget allocations or projected loan amounts enter here.
 * An unsplit payment to a loan is not proven principal. A recorded split identifies its transfer leg as principal;
 * otherwise its composition remains unresolved, including when a loan model could calculate a proposed split.
 */
export function buildStatements(input: {
  ledger: Ledger; period: ResolvedPeriod; categories: ReadonlyMap<string, CategoryInfo>; entries: readonly StatementEntry[];
  assetEntries: readonly AssetEntry[] | null; savedClassifications: readonly SavedClassification[]; basisIssue: string | null;
}): Statements {
  const { ledger, period, categories } = input;
  const entries = input.entries.filter((r) => ledger.account.has(r.accountId) && r.date >= period.startDate && r.date <= period.endDate);
  // Separate reads can see an external edit. Check category/transfer cells and counts, not only net cash, so a noncash
  // change or a same-value reclassification cannot silently certify a result against an older shared snapshot.
  const expected = new Map<string, { amountMinor: number; count: number }>(), observed = new Map<string, { amountMinor: number; count: number }>();
  const cell = (month: string, accountId: string, categoryId: string | null, counterpart: string | null) => JSON.stringify([month, accountId, categoryId, counterpart]);
  for (const row of ledger.facts.movement) {
    if (!ledger.account.has(row.accountId) || row.month < period.startMonth || row.month > period.endMonth) continue;
    const key = cell(row.month, row.accountId, row.categoryId, row.transferAccountId);
    const value = expected.get(key) ?? { amountMinor: 0, count: 0 };
    value.amountMinor += row.amountMinor; value.count += row.count; expected.set(key, value);
  }
  for (const entry of entries) {
    if (entry.startingBalance) continue;
    const key = cell(entry.date.slice(0, 7), entry.accountId, entry.categoryId, entry.transferAccountId);
    const value = observed.get(key) ?? { amountMinor: 0, count: 0 };
    value.amountMinor += entry.amountMinor; value.count += 1; observed.set(key, value);
  }
  const detailed = new Map(entries.map((entry) => [entry.id, entry]));
  const saved = new Map(input.savedClassifications.map((r) => [r.actualTransactionId, r]));
  const classifiedEvidence = [...ledger.facts.reclassified, ...(input.assetEntries ?? []).filter((entry) => classificationOf(entry, saved) !== null).map((entry) => ({ ...entry, month: entry.date.slice(0, 7) }))];
  const classifiedChanged = classifiedEvidence.some((row) => {
    const entry = detailed.get(row.id);
    if (!ledger.account.has(row.accountId) || (!entry && (row.month < period.startMonth || row.month > period.endMonth))) return false;
    return !entry || entry.accountId !== row.accountId || entry.date.slice(0, 7) !== row.month || ("date" in row && entry.date !== row.date) || entry.categoryId !== row.categoryId || entry.amountMinor !== row.amountMinor;
  });
  const evidenceChanged = classifiedChanged || expected.size !== observed.size || [...observed].some(([key, value]) => expected.get(key)?.amountMinor !== value.amountMinor || expected.get(key)?.count !== value.count);
  const basisIssue = input.basisIssue ?? (evidenceChanged ? "Statement evidence differs from the shared transaction snapshot; Refresh Financial Insights to re-read both" : null);
  const cashIds = new Set(ledger.facts.accounts.filter((a) => isCashEquivalent(a.accountClass, a.treatment)).map((a) => a.id));
  const reclassified = new Map(ledger.facts.reclassified.map((r) => [r.id, r.to]));
  const capitalIds = new Set((input.assetEntries ?? []).filter((r) => ["acquisition", "added-capital"].includes(classificationOf(r, saved) ?? "")).map((r) => r.id));
  // The split lines of a repayment, paid from a cash account; a charge the lender added to the loan account is not a cash payment.
  const paidCosts = new Set(ledger.facts.loanCosts.filter((r) => r.kind && r.id && !r.charged).map((r) => r.id!));
  // A parent is evidence only when the recorded split has an identified expense alongside its principal transfer.
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const expenseParents = new Set(entries.filter((r) => r.parentId && !r.transferAccountId && r.categoryId && categories.has(r.categoryId) && !ledger.facts.incomeCategories.has(r.categoryId)).map((r) => r.parentId));
  // Interest and fees the lender charged as their own rows of a tracked loan's account: recorded expenses with no cash movement of their own.
  const chargedIds = new Set(ledger.facts.loanCosts.filter((r) => r.charged && r.id && r.categoryId === null && isLoanCostInSpent(ledger, r)).map((r) => r.id!));
  const chargedByLoan = new Map<string, StatementEntry[]>();
  for (const entry of entries) if (chargedIds.has(entry.id) && !entry.startingBalance && !entry.transferAccountId) chargedByLoan.set(entry.accountId, [...(chargedByLoan.get(entry.accountId) ?? []), entry]);
  // The cash payments into those loans that do not identify their own split. Where there are some, the charged amount is what
  // they paid in interest and fees and the rest is principal; where there are none, the charge is an accrual that cash has not paid.
  const unsplitPayment = (entry: StatementEntry) => {
    const other = entry.transferAccountId ? ledger.account.get(entry.transferAccountId) : undefined;
    return cashIds.has(entry.accountId) && !entry.startingBalance && !!entry.transferId && entry.amountMinor < 0 && other?.accountClass === "loan" && !cashIds.has(other.id) && !(entry.parentId && expenseParents.has(entry.parentId));
  };
  const paymentSum = new Map<string, number>();
  for (const e of entries) if (unsplitPayment(e) && chargedByLoan.has(e.transferAccountId!)) paymentSum.set(e.transferAccountId!, (paymentSum.get(e.transferAccountId!) ?? 0) + e.amountMinor);
  const paidLoans = new Set(paymentSum.keys());
  const chargeSum = (loanId: string) => (chargedByLoan.get(loanId) ?? []).reduce((sum, e) => sum + e.amountMinor, 0);
  // Interest and fees are paid in cash only up to what was paid to the loan. A loan charged more than it was paid has all its payments
  // read as interest and fees (no principal), and the rest of the charge stays an expense that no cash has paid.
  // A loan the lender credited on balance (a reversal larger than its charges) has nothing paid in cash: its payments are all principal and the credit stays a noncash P&L item.
  const appliedLoans = new Set([...paidLoans].filter((id) => chargeSum(id) < 0));
  const overCharged = new Set([...appliedLoans].filter((id) => chargeSum(id) < paymentSum.get(id)!));
  const operating = [line("receipts", "Categorized cash receipts"), line("payments", "Categorized cash payments"), line("card", "Credit-card settlements", "Ordinary card settlements are operating payments. Purchase categories remain in P&L; no allocation of a settlement to particular purchases is inferred."), line("interest", "Recorded loan interest and fees paid"), line("uncategorized-in", "Uncategorized cash receipts"), line("uncategorized-out", "Uncategorized cash payments")];
  const investing = [line("invest-out", "Put into investments and retirement"), line("invest-in", "Withdrawn from investments and retirement"), line("fixed-out", "Placed in fixed / restricted deposits"), line("fixed-in", "Released from fixed / restricted deposits"), line("asset-out", "Fixed-asset purchases and capital added"), line("asset-in", "Fixed-asset transfers received"), line("sales", "Asset sale proceeds and selling costs")];
  const financing = [line("borrowed", "Borrowing received from loans"), line("principal", "Recorded loan principal repaid"), line("principal-net", "Loan payments less interest and fees the lender charged", "Payments to loans whose lender charges interest and fees as their own entries. What the lender charged is shown as interest and fees paid under operating activities; the rest is principal. Opened from the loan accounts: what was paid in, less what was charged.")];
  const lenderCharges = line("lender-charges", "Interest and fees charged by lenders", "Interest and fees the lender charged as their own entries in the accounts of loans tracked in Loans. They are recorded expenses; the cash that pays them is the loan payments.");
  const principalNetIds: string[] = [];
  const starting = line("starting", "Starting balances introduced in the period", "Recorded starting balances change the cash population; they are not income or an activity cash flow.");
  const internal = line("internal", "In transit / unmatched cash transfers", "Cash-to-cash transfers cancel when both sides have equal amounts within the period. This is the recorded net left over; inspect the transfers before attributing a cause.");
  const unresolved = new Map<string, StatementLine>();
  const cashUnknown = new Map<string, StatementLine>();
  const unknown = (entry: StatementEntry, key: string, label: string, detail: string) => {
    const rows = cashIds.has(entry.accountId) ? cashUnknown : unresolved;
    const existing = rows.get(key) ?? line(key, label, detail);
    add(existing, entry); rows.set(key, existing);
  };
  const categoryRows = new Map<string, StatementLine>();
  const uncategorizedIncome = line("uncategorized-income", "Uncategorized income", "Uncategorized non-transfer receipts in on-budget accounts, counted by sign as in the Income tab, and in off-budget Cash and Bank accounts set to count uncategorized money in as income.");
  const uncategorizedExpenses = line("uncategorized-expenses", "Uncategorized expenses", "Uncategorized non-transfer payments in on-budget accounts, counted by sign as in the Spending tab. Card purchases count when recorded, not again when settled.");
  const investmentActivity = line("investment-activity", "Recorded investment activity", "Uncategorized non-transfer entries in off-budget Investment and Retirement accounts. These may be recorded gains, losses, dividends, interest or fees; they are investment activity, not available-cash movements or P&L income/expenses. No return or realized profit is inferred.");
  let cardPnlMinor = 0, otherNoncashPnlMinor = 0;
  for (const entry of entries) {
    const cash = cashIds.has(entry.accountId);
    const owner = ledger.account.get(entry.accountId)!;
    if (entry.startingBalance) { if (cash) add(starting, entry); continue; }
    if (chargedIds.has(entry.id) && !entry.transferAccountId) {
      add(lenderCharges, entry);
      if (appliedLoans.has(entry.accountId)) { if (!overCharged.has(entry.accountId)) add(operating[3], entry); } else otherNoncashPnlMinor += entry.amountMinor;
      continue;
    }
    if (entry.transferAccountId) {
      if (!cash) continue;
      const other = ledger.account.get(entry.transferAccountId);
      if (cashIds.has(entry.transferAccountId)) {
        const otherSide = entry.transferId ? entriesById.get(entry.transferId) : undefined;
        const matched = otherSide && otherSide.transferId === entry.id && otherSide.accountId === entry.transferAccountId && otherSide.transferAccountId === entry.accountId && otherSide.amountMinor === -entry.amountMinor;
        if (!matched) add(internal, entry);
        continue;
      }
      if (!other) {
        unknown(entry, "scope", "Transfers with excluded or unavailable accounts", "The cash side is recorded, but the counterpart is outside the reporting scope or unavailable. Its purpose is not inferred."); continue;
      }
      if (other.accountClass === "investment" || other.accountClass === "retirement") add(investing[entry.amountMinor < 0 ? 0 : 1], entry);
      else if (other.accountClass === "bank" && other.treatment === "fixed-deposit") add(investing[entry.amountMinor < 0 ? 2 : 3], entry);
      else if (other.accountClass === "property" || other.accountClass === "vehicle" || (other.accountClass === "other-asset" && other.treatment === "fixed-asset")) add(investing[entry.amountMinor < 0 ? 4 : 5], entry);
      else if (other.accountClass === "credit-card" && entry.amountMinor < 0) add(operating[2], entry);
      else if (other.accountClass === "loan" && entry.amountMinor > 0) add(financing[0], entry);
      else if (other.accountClass === "loan" && entry.parentId && expenseParents.has(entry.parentId)) add(financing[1], entry);
      else if (unsplitPayment(entry) && paidLoans.has(other.id)) {
        if (overCharged.has(other.id)) add(operating[3], entry);
        else { add(financing[2], entry); principalNetIds.push(entry.transferId!); }
      }
      else if (other.accountClass === "loan") unknown(entry, "loan-allocation", "Loan payments: allocation unidentified", "The recorded payment does not identify separate principal and interest/fee amounts. A calculated loan schedule is not used to split it.");
      else unknown(entry, `transfer-${other.accountClass}`, `Transfers with ${other.accountClass === "other-liability" ? "other liabilities" : other.accountClass === "other-asset" ? "other assets" : "credit cards"}: purpose unidentified`, "The account class does not establish the purpose of this cash movement.");
      continue;
    }
    const classified = reclassified.get(entry.id);
    if (classified) {
      if (cash && classified === "assetSale") add(investing[6], entry);
      else if (cash) unknown(entry, "cash-value", "Value adjustments recorded in cash accounts", "An explicit Asset Registry value classification is excluded from P&L. Its effect on the recorded cash balance remains visible for review.");
      continue;
    }
    if (capitalIds.has(entry.id)) {
      unknown(entry, "capital", "Asset capital without a recorded transfer", "The registry identifies capital added, but no recorded transfer establishes its cash counterpart. P&L needs review; no purchase is guessed."); continue;
    }
    if (entry.categoryId === null) {
      if (!owner.offBudget) {
        const income = entry.amountMinor > 0;
        add(income ? uncategorizedIncome : uncategorizedExpenses, entry);
        if (cash) add(operating[income ? 4 : 5], entry);
        else if (owner.accountClass === "credit-card") cardPnlMinor += entry.amountMinor;
        else otherNoncashPnlMinor += entry.amountMinor;
      } else if (owner.offBudgetIncome && entry.amountMinor > 0) {
        // An off-budget Cash or Bank account set to count uncategorized money in as income, as Received does.
        add(uncategorizedIncome, entry);
        if (cash) add(operating[4], entry); else otherNoncashPnlMinor += entry.amountMinor;
      } else if (owner.accountClass === "investment" || owner.accountClass === "retirement") add(investmentActivity, entry);
      else unknown(entry, "uncategorized", cash ? "Uncategorized cash movements" : "Unidentified noncash movements", "Uncategorized non-transfer entries in off-budget accounts other than Investment or Retirement. Their purpose is not established, so they stay outside income and expenses.");
      continue;
    }
    if (!categories.has(entry.categoryId)) {
      unknown(entry, "unknown-category", "Entries with unavailable categories", "The recorded category is unavailable in the current category list. Its income or expense classification cannot be verified."); continue;
    }
    const info = categories.get(entry.categoryId)!;
    const row = categoryRows.get(entry.categoryId) ?? line(entry.categoryId, info.name);
    add(row, entry); categoryRows.set(entry.categoryId, row);
    if (cash) add(operating[paidCosts.has(entry.id) ? 3 : info.isIncome ? 0 : 1], entry);
    else if (owner.accountClass === "credit-card") cardPnlMinor += entry.amountMinor;
    else otherNoncashPnlMinor += entry.amountMinor;
  }
  const groups = (income: boolean): StatementGroup[] => {
    const byGroup = new Map<string, StatementGroup>();
    const ordered = [...categoryRows].sort(([a], [b]) => (categories.get(a)?.order ?? 0) - (categories.get(b)?.order ?? 0) || a.localeCompare(b));
    for (const [id, row] of ordered) {
      const info = categories.get(id)!;
      if (info.isIncome !== income) continue;
      const key = info.groupId ?? info.groupName;
      const group = byGroup.get(key) ?? { ...line(key, info.groupName), rows: [] };
      group.rows.push({ ...row, label: `${row.label}${info.hidden ? " (hidden)" : ""}` });
      group.amountMinor += row.amountMinor; group.ids.push(...row.ids); byGroup.set(key, group);
    }
    const result = [...byGroup.values()];
    const uncategorized = income ? uncategorizedIncome : uncategorizedExpenses;
    if (!income && lenderCharges.ids.length) result.push({ ...lenderCharges, label: "Loans", rows: [lenderCharges] });
    if (uncategorized.ids.length) result.push({ ...uncategorized, label: "Uncategorized", rows: [uncategorized] });
    return result;
  };
  // The charged amount comes out of the payments: what was paid in interest and fees is not principal.
  const chargedPaid = [...appliedLoans].filter((id) => !overCharged.has(id)).flatMap((id) => chargedByLoan.get(id) ?? []);
  for (const id of overCharged) otherNoncashPnlMinor += chargeSum(id) - paymentSum.get(id)!;
  financing[2].amountMinor -= total(chargedPaid);
  financing[2].ids.push(...chargedPaid.map((e) => e.id));
  // Opened from the loan accounts: the payments received there, less the charges, add up to the principal (the cash flow shows it as money out).
  financing[2].drill = { ids: [...principalNetIds, ...chargedPaid.map((e) => e.id)], amountMinor: 0 - financing[2].amountMinor };
  const income = groups(true), expenses = groups(false);
  const sections = [
    { key: "operating", label: "Operating activities", rows: operating },
    { key: "investing", label: "Investing activities", rows: investing },
    { key: "financing", label: "Financing activities", rows: financing },
  ].map((s) => ({ ...s, rows: s.rows.filter((r) => r.ids.length > 0), amountMinor: total(s.rows) }));
  const adjustments = [...cashUnknown.values(), ...(starting.ids.length ? [starting] : []), ...(internal.ids.length ? [internal] : [])];
  const balance = (month: string) => [...cashIds].reduce((sum, id) => sum + ledger.balanceAt(id, month), 0);
  const openingMinor = balance(addMonths(period.startMonth, -1)), closingMinor = balance(period.endMonth);
  const changeMinor = closingMinor - openingMinor;
  const differenceMinor = changeMinor - total(sections) - total(adjustments);
  const incomeMinor = total(income), expensesMinor = total(expenses), surplusMinor = incomeMinor + expensesMinor;
  const bridge = [
    { label: "Net surplus / deficit", amountMinor: surplusMinor },
    { label: "Card purchases versus cash settlements", amountMinor: -cardPnlMinor + operating[2].amountMinor },
    { label: "Income / expenses in other noncash accounts", amountMinor: -otherNoncashPnlMinor },
    { label: "Net investing activities", amountMinor: sections[1].amountMinor },
    { label: "Net financing activities", amountMinor: sections[2].amountMinor },
    { label: "Unclassified cash movements and adjustments", amountMinor: total(adjustments) },
    { label: "Unexplained difference", amountMinor: differenceMinor },
  ];
  return {
    cash: { openingMinor, closingMinor, changeMinor, sections, adjustments, differenceMinor },
    pnl: { income, expenses, incomeMinor, expensesMinor, surplusMinor, basisIssue },
    unresolved: [...cashUnknown.values(), ...unresolved.values()], investmentActivity, bridge,
    classificationComplete: !basisIssue && cashUnknown.size === 0 && unresolved.size === 0 && internal.ids.length === 0 && differenceMinor === 0,
  };
}

/** Exact statement figures, including unresolved movements and both reconciliations. Monetary cells are decimal whole units. */
export function statementsCsvRows(model: Statements, period: ResolvedPeriod): (string | number)[][] {
  const rows: (string | number)[][] = [
    ["Financial Insights", "Statements"], ["Period", period.label], ["From", period.startDate], ["As of", period.endDate],
    ["Basis", "Actual recorded transactions; categories and on-budget uncategorized entries by sign; no estimated accruals"],
    ["Classification", model.classificationComplete ? "Complete" : "Needs review"], ["P&L status", model.pnl.basisIssue ?? "Recorded result"], [],
    ["Statement", "Section", "Line", "Amount", "Entries", "Explanation"],
  ];
  const append = (statement: string, section: string, label: string, amount: number, count: number | "" = "", detail = "") => rows.push([statement, section, label, (amount / 100).toFixed(2), count, detail]);
  append("Cash flow", "Balances", "Opening cash", model.cash.openingMinor);
  for (const section of model.cash.sections) {
    for (const row of section.rows) append("Cash flow", section.label, row.label, row.amountMinor, row.ids.length, row.detail);
    append("Cash flow", section.label, "Subtotal", section.amountMinor);
  }
  for (const row of model.cash.adjustments) append("Cash flow", "Unclassified / adjustments", row.label, row.amountMinor, row.ids.length, row.detail);
  append("Cash flow", "Reconciliation", "Unexplained difference", model.cash.differenceMinor);
  append("Cash flow", "Reconciliation", "Net cash movement", model.cash.changeMinor);
  append("Cash flow", "Balances", "Closing cash", model.cash.closingMinor);
  for (const [label, groups, amount] of [["Income", model.pnl.income, model.pnl.incomeMinor], ["Expenses", model.pnl.expenses, model.pnl.expensesMinor]] as const) {
    for (const group of groups) {
      for (const row of group.rows) append("P&L", `${label}: ${group.label}`, row.label, row.amountMinor, row.ids.length);
      append("P&L", `${label}: ${group.label}`, "Group subtotal", group.amountMinor);
    }
    append("P&L", label, `Total ${label.toLowerCase()}`, amount);
  }
  append("P&L", "Result", model.pnl.basisIssue ? "Provisional surplus / deficit — needs review" : "Net surplus / deficit", model.pnl.surplusMinor);
  for (const row of model.unresolved) append("Review", "Excluded from P&L", row.label, row.amountMinor, row.ids.length, row.detail);
  if (model.investmentActivity.ids.length) append("Other activity", "Investment activity", model.investmentActivity.label, model.investmentActivity.amountMinor, model.investmentActivity.ids.length, model.investmentActivity.detail);
  for (const row of model.bridge) append("P&L to cash", "Reconciliation", row.label, row.amountMinor);
  append("P&L to cash", "Reconciliation", "Net cash movement", model.cash.changeMinor);
  return rows;
}
