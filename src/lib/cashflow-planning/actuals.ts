import type { AccountClass } from "@/lib/account-class";
import { isCashEquivalent, type ReportingTreatment } from "@/lib/account-class/reporting";
import type { DatedAmount, MovementRow } from "@/lib/financial-insights/measures";
import { SECTION_SIGN, type Month, type PlanAccountRole, type PlanDocument, type SectionId } from "./types";

/**
 * What a plan reads from Actual, and how each recorded movement is placed in it. Pure: the reads are in `reads.ts`.
 *
 * A plan follows a set of accounts, its **cash**. Every movement of a cash account is placed exactly once:
 *  1. a transfer between two cash accounts moves nothing; a month where its two sides do not cancel shows as in transit;
 *  2. a transfer with an account outside cash goes to the row linked to that account, else to the row of its category
 *     (Actual categorizes transfers that leave the budget), else to "Not in plan" in the section its counterpart suggests;
 *  3. anything else goes to the row linked to its category, or to its category group; an uncategorized entry goes to the row
 *     linked to its account;
 *  4. what no row claims is "Not in plan": income categories and uncategorized money in under Income, the rest under Expenses.
 * So a month's rows always add up to the change in the cash balance, whatever the plan links.
 */

export type SnapAccount = {
  id: string; name: string; offBudget: boolean; closed: boolean;
  /** The effective account class (the account's own or its group's), or null when it has none. */
  accountClass: AccountClass | null;
  treatment: ReportingTreatment | null;
  /** Left out of Financial Insights by the owner. */
  excluded: boolean;
  groupName: string | null;
};

export type SnapCategory = { id: string; name: string; groupId: string; groupName: string; isIncome: boolean; hidden: boolean };

export type SnapSchedule = {
  id: string; name: string; completed: boolean;
  /** Signed cash amount of one occurrence (minor units; money out is negative), or null when the schedule has none. */
  amount: number | null;
  /** Upcoming dates (`YYYY-MM-DD`) up to the read's horizon, or null when they could not be worked out. */
  dates: string[] | null;
  problem?: string;
};

/** What a tracked loan's account will receive each month (positive minor units), from the Loans page's own projection. */
export type LoanForecast =
  | { state: "ready"; byMonth: Record<Month, number>; name: string; /** Only the principal reaches the loan account: interest and fees are recorded on their own categorized lines. */ principalOnly?: boolean }
  | { state: "unavailable"; reason: string };

export type BudgetSnapshot = {
  /** Budgeted amount per category for each month that was read (positive minor units). */
  months: Record<Month, Record<string, number>>;
  /** The last month read, whose values stand in for later months. */
  lastMonth: Month | null;
};

export type Snapshot = {
  /** `YYYY-MM-DD`: nothing after it was read. */
  today: string;
  accounts: SnapAccount[];
  categories: SnapCategory[];
  movement: MovementRow[];
  startingBalances: DatedAmount[];
  /** The positive part of the uncategorized non-transfer entries, by month and account. */
  uncategorizedIn: DatedAmount[];
  /** The positive part of the transfers, by month, account and counterpart. */
  transfersIn: (DatedAmount & { transferAccountId: string })[];
  schedules: SnapSchedule[];
  /** By loan account id. */
  loans: Record<string, LoanForecast>;
  budget: BudgetSnapshot | null;
};

// ─── Accounts ────────────────────────────────────────────────────────────────

/**
 * How an account counts when the user has not said: Cash and Bank accounts and credit cards are the plan's cash (so a card
 * purchase lowers it when it is made, and paying the card moves nothing); a fixed deposit, an investment or a retirement
 * account is savings; everything else is outside. An account without a class is cash when it is on budget.
 */
export function defaultAccountRole(account: SnapAccount): PlanAccountRole {
  if (account.excluded) return "outside";
  switch (account.accountClass) {
    case null: return account.offBudget ? "outside" : "cash";
    case "cash":
    case "credit-card": return "cash";
    case "bank": return isCashEquivalent("bank", account.treatment) ? "cash" : "savings";
    case "investment":
    case "retirement": return "savings";
    default: return "outside";
  }
}

export function accountRole(doc: Pick<PlanDocument, "accountRoles">, account: SnapAccount): PlanAccountRole {
  return doc.accountRoles[account.id] ?? defaultAccountRole(account);
}

/** Where a transfer with an account outside cash is shown when no row is linked to it. */
function counterpartSection(role: PlanAccountRole | undefined, account: SnapAccount | undefined): SectionId {
  if (role === "savings") return "savings";
  switch (account?.accountClass) {
    case "loan":
    case "credit-card":
    case "other-liability": return "debt";
    case "property":
    case "vehicle":
    case "other-asset": return "expenses";
    default: return "savings";
  }
}

// ─── Placement ───────────────────────────────────────────────────────────────

/** One placed piece of recorded movement. `target` is a row id, or a section for "Not in plan". */
export type Contribution = {
  target: string; month: Month;
  /** What it is: a category, the transfers with an account, or the uncategorized entries of an account. */
  kind: "category" | "transfer" | "uncategorized"; id: string;
  /** Natural minor units for the target's section. */
  amount: number;
};

export type LinkConflict = { rowId: string; what: string };

export type Placed = {
  cashIds: ReadonlySet<string>;
  savingsIds: ReadonlySet<string>;
  /** Natural amounts by row id and month. */
  rowActual: Map<string, Map<Month, number>>;
  /** Natural amounts by section and month for what no row claims. */
  unplanned: Record<SectionId, Map<Month, number>>;
  contributions: Contribution[];
  /** Cash-signed, by month. */
  cashChange: Map<Month, number>;
  inTransit: Map<Month, number>;
  startingCash: Map<Month, number>;
  savingsChange: Map<Month, number>;
  /** The first month with anything recorded in a cash account. */
  firstMonth: Month | null;
  /** Links that another row already holds, so they have no effect. */
  conflicts: LinkConflict[];
};

export const unplannedTarget = (section: SectionId) => `unplanned:${section}`;

const bump = (map: Map<Month, number>, month: Month, amount: number) => { if (amount !== 0) map.set(month, (map.get(month) ?? 0) + amount); };

/** Depends only on the plan's rows (ids, sections, links) and account roles, never on its amounts: see `placementKey`. */
export function placeActuals(doc: Pick<PlanDocument, "rows" | "accountRoles">, snapshot: Snapshot): Placed {
  const accountOf = new Map(snapshot.accounts.map((a) => [a.id, a]));
  const roleOf = new Map(snapshot.accounts.map((a) => [a.id, accountRole(doc, a)]));
  const cashIds = new Set(snapshot.accounts.filter((a) => roleOf.get(a.id) === "cash").map((a) => a.id));
  const savingsIds = new Set(snapshot.accounts.filter((a) => roleOf.get(a.id) === "savings").map((a) => a.id));
  const category = new Map(snapshot.categories.map((c) => [c.id, c]));
  const sectionOf = new Map(doc.rows.map((r) => [r.id, r.section]));

  const conflicts: LinkConflict[] = [];
  const categoryRow = new Map<string, string>(), groupRow = new Map<string, string>();
  const accountRows = new Map<string, { rowId: string; flow?: "in" | "out" }[]>();
  for (const row of doc.rows) {
    for (const id of row.links.categories) {
      if (categoryRow.has(id)) conflicts.push({ rowId: row.id, what: `${category.get(id)?.name ?? "A category"} is already followed by another row` });
      else categoryRow.set(id, row.id);
    }
    for (const id of row.links.categoryGroups) {
      if (groupRow.has(id)) conflicts.push({ rowId: row.id, what: "A category group is already followed by another row" });
      else groupRow.set(id, row.id);
    }
    for (const link of row.links.accounts) {
      const held = accountRows.get(link.id) ?? [];
      const clash = held.some((h) => !h.flow || !link.flow || h.flow === link.flow);
      if (clash) conflicts.push({ rowId: row.id, what: `${accountOf.get(link.id)?.name ?? "An account"} is already followed by another row` });
      else accountRows.set(link.id, [...held, { rowId: row.id, flow: link.flow }]);
    }
  }
  const rowForCategory = (id: string | null): string | undefined => {
    if (!id) return undefined;
    return categoryRow.get(id) ?? (category.get(id) ? groupRow.get(category.get(id)!.groupId) : undefined);
  };

  const placed: Placed = {
    cashIds, savingsIds, rowActual: new Map(), contributions: [], conflicts,
    unplanned: { income: new Map(), expenses: new Map(), savings: new Map(), debt: new Map() },
    cashChange: new Map(), inTransit: new Map(), startingCash: new Map(), savingsChange: new Map(), firstMonth: null,
  };
  /** `cash` is the signed effect on the plan's cash. */
  const put = (rowId: string | undefined, fallback: SectionId, month: Month, cash: number, kind: Contribution["kind"], id: string) => {
    if (cash === 0) return;
    const section = rowId ? sectionOf.get(rowId)! : fallback;
    const amount = cash * SECTION_SIGN[section];
    if (rowId) {
      const months = placed.rowActual.get(rowId) ?? new Map<Month, number>();
      bump(months, month, amount);
      placed.rowActual.set(rowId, months);
    } else bump(placed.unplanned[section], month, amount);
    placed.contributions.push({ target: rowId ?? unplannedTarget(section), month, kind, id, amount });
  };

  const key = (month: Month, a: string, b: string) => `${month}|${a}|${b}`;
  const transferIn = new Map<string, number>();
  for (const row of snapshot.transfersIn) transferIn.set(key(row.month, row.accountId, row.transferAccountId), (transferIn.get(key(row.month, row.accountId, row.transferAccountId)) ?? 0) + row.amountMinor);
  const uncategorizedIn = new Map<string, number>();
  for (const row of snapshot.uncategorizedIn) uncategorizedIn.set(key(row.month, row.accountId, ""), (uncategorizedIn.get(key(row.month, row.accountId, "")) ?? 0) + row.amountMinor);

  // Transfers with an account outside cash, by month and counterpart: their total, and the same by category.
  type Outside = { month: Month; counterpart: string; total: number; moneyIn: number; byCategory: Map<string | null, number> };
  const outside = new Map<string, Outside>();
  const seenIn = new Set<string>();

  for (const row of snapshot.movement) {
    const savings = savingsIds.has(row.accountId);
    if (savings) bump(placed.savingsChange, row.month, row.amountMinor);
    if (!cashIds.has(row.accountId)) continue;
    bump(placed.cashChange, row.month, row.amountMinor);
    if (!placed.firstMonth || row.month < placed.firstMonth) placed.firstMonth = row.month;

    if (row.transferAccountId) {
      if (cashIds.has(row.transferAccountId)) { bump(placed.inTransit, row.month, row.amountMinor); continue; }
      const k = key(row.month, "", row.transferAccountId);
      const cell = outside.get(k) ?? { month: row.month, counterpart: row.transferAccountId, total: 0, moneyIn: 0, byCategory: new Map() };
      cell.total += row.amountMinor;
      cell.byCategory.set(row.categoryId, (cell.byCategory.get(row.categoryId) ?? 0) + row.amountMinor);
      // The positive part is known per cash account and counterpart: count each of those once.
      const inKey = key(row.month, row.accountId, row.transferAccountId);
      if (!seenIn.has(inKey)) { seenIn.add(inKey); cell.moneyIn += transferIn.get(inKey) ?? 0; }
      outside.set(k, cell);
      continue;
    }

    if (row.categoryId) {
      const info = category.get(row.categoryId);
      put(rowForCategory(row.categoryId), info?.isIncome ? "income" : "expenses", row.month, row.amountMinor, "category", row.categoryId);
      continue;
    }

    // Uncategorized, not a transfer: split by sign, each part to the row that follows the account in that direction.
    const moneyIn = Math.max(0, uncategorizedIn.get(key(row.month, row.accountId, "")) ?? Math.max(0, row.amountMinor));
    const moneyOut = row.amountMinor - moneyIn;
    const links = accountRows.get(row.accountId) ?? [];
    const claim = (flow: "in" | "out") => links.find((l) => l.flow === flow)?.rowId ?? links.find((l) => !l.flow)?.rowId;
    put(claim("in"), "income", row.month, moneyIn, "uncategorized", row.accountId);
    put(claim("out"), "expenses", row.month, moneyOut, "uncategorized", row.accountId);
  }

  for (const cell of outside.values()) {
    const links = accountRows.get(cell.counterpart) ?? [];
    const fallback = counterpartSection(roleOf.get(cell.counterpart), accountOf.get(cell.counterpart));
    if (links.length === 0) {
      // No row follows the account: each part follows its category, as Actual's budget does.
      for (const [categoryId, amount] of cell.byCategory) {
        const rowId = rowForCategory(categoryId);
        if (rowId) put(rowId, fallback, cell.month, amount, "category", categoryId!);
        else put(undefined, fallback, cell.month, amount, "transfer", cell.counterpart);
      }
      continue;
    }
    // The recorded positive part; when that read has nothing for the cell, a positive total is all money in.
    const moneyIn = Math.max(cell.moneyIn, 0, cell.total);
    const moneyOut = cell.total - moneyIn;
    const claim = (flow: "in" | "out") => links.find((l) => l.flow === flow)?.rowId ?? links.find((l) => !l.flow)?.rowId;
    put(claim("in"), fallback, cell.month, moneyIn, "transfer", cell.counterpart);
    put(claim("out"), fallback, cell.month, moneyOut, "transfer", cell.counterpart);
  }

  for (const row of snapshot.startingBalances) {
    if (savingsIds.has(row.accountId)) bump(placed.savingsChange, row.month, row.amountMinor);
    if (!cashIds.has(row.accountId)) continue;
    bump(placed.cashChange, row.month, row.amountMinor);
    bump(placed.startingCash, row.month, row.amountMinor);
  }
  return placed;
}

/** Everything `placeActuals` reads from a plan, as one string: while it is unchanged the placement can be reused. */
export function placementKey(doc: Pick<PlanDocument, "rows" | "accountRoles">): string {
  return JSON.stringify([doc.accountRoles, doc.rows.map((r) => [r.id, r.section, r.links])]);
}

/** The pieces behind one row (or one section's "Not in plan") in the given months, largest first, with their names. */
export function contributionsOf(placed: Placed, snapshot: Snapshot, target: string, months: ReadonlySet<Month>): { kind: Contribution["kind"]; id: string; label: string; amount: number }[] {
  const names = new Map<string, string>();
  for (const c of snapshot.categories) names.set(`category:${c.id}`, c.name);
  for (const a of snapshot.accounts) { names.set(`transfer:${a.id}`, `Transfers: ${a.name}`); names.set(`uncategorized:${a.id}`, `Uncategorized in ${a.name}`); }
  const sums = new Map<string, { kind: Contribution["kind"]; id: string; amount: number }>();
  for (const c of placed.contributions) {
    if (c.target !== target || !months.has(c.month)) continue;
    const k = `${c.kind}:${c.id}`;
    const entry = sums.get(k) ?? { kind: c.kind, id: c.id, amount: 0 };
    entry.amount += c.amount;
    sums.set(k, entry);
  }
  return [...sums.entries()]
    .map(([k, entry]) => ({ ...entry, label: names.get(k) ?? (entry.kind === "category" ? "Deleted category" : "Unknown account") }))
    .filter((entry) => entry.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/** The balance of each given account at the end of `month`, from everything recorded up to it. */
export function accountBalances(snapshot: Snapshot, accountIds: ReadonlySet<string>, month: Month): Map<string, number> {
  const balances = new Map<string, number>();
  for (const id of accountIds) balances.set(id, 0);
  for (const row of snapshot.movement) if (row.month <= month && accountIds.has(row.accountId)) balances.set(row.accountId, balances.get(row.accountId)! + row.amountMinor);
  for (const row of snapshot.startingBalances) if (row.month <= month && accountIds.has(row.accountId)) balances.set(row.accountId, balances.get(row.accountId)! + row.amountMinor);
  return balances;
}

const placements = new WeakMap<Snapshot, { key: string; placed: Placed }>();

/** `placeActuals`, kept per snapshot while the plan's links and account roles are unchanged: typing amounts does not redo it. */
export function placeActualsCached(doc: Pick<PlanDocument, "rows" | "accountRoles">, snapshot: Snapshot): Placed {
  const key = placementKey(doc);
  const cached = placements.get(snapshot);
  if (cached?.key === key) return cached.placed;
  const placed = placeActuals(doc, snapshot);
  placements.set(snapshot, { key, placed });
  return placed;
}
