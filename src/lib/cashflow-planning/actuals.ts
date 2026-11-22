import type { AccountClass } from "@/lib/account-class";
import type { Access } from "@/lib/account-class/access";
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
  /** Whether the money can be used now (see `accessOf`); null for a class without access, or no class. */
  access: Access | null;
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

/**
 * A tracked loan's coming repayments by month (positive minor units), from the Loans page's own projection: the whole
 * instalment paid from cash (`payment`), and the part of it that reaches the loan account (`principal`). They differ when
 * repayments are recorded as splits, with interest and fees on their own categorized lines (`split`).
 */
export type LoanForecast =
  | { state: "ready"; payment: Record<Month, number>; principal: Record<Month, number>; split: boolean; name: string }
  | { state: "unavailable"; reason: string };

/** An interest or fee line of a recorded repayment of a tracked loan: a categorized entry in a cash account. */
export type LoanCostLine = { id: string; month: Month; accountId: string; categoryId: string | null; amountMinor: number; loanAccountId: string };

/**
 * A transaction that may count in another month than the one it is dated in: its note carries a `#YYYY-MM` tag (`tagMonth`),
 * or the plan moves it. Read one by one, because the monthly read cannot tell them apart.
 */
export type ShiftedTransaction = { id: string; date: string; accountId: string; categoryId: string | null; transferAccountId: string | null; amountMinor: number; tagMonth: Month | null };

export type BudgetSnapshot = {
  /** Budgeted amount per category for each month that was read (positive minor units). */
  months: Record<Month, Record<string, number>>;
  /** The last month read, whose values stand in for later months. */
  lastMonth: Month | null;
  /** Months Actual has that could not be read: a gap between two budgeted months may be one of them. */
  unreadMonths?: number;
};

/** The optional reads a plan can do without: a failure leaves what follows them empty, which is not the user's doing. */
export type OptionalRead = "schedules" | "loans" | "shifts";

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
  loanCosts: LoanCostLine[];
  shifts: ShiftedTransaction[];
  budget: BudgetSnapshot | null;
  /** The optional reads that failed. Rows that depend on one say so instead of blaming their links. */
  failedReads?: readonly OptionalRead[];
};

// ─── Accounts ────────────────────────────────────────────────────────────────

/**
 * How an account counts when the user has not said: Checking and Cash accounts you can use now, and credit cards, are the plan's
 * cash (so a card purchase lowers it when it is made, and paying the card moves nothing); Savings, Fixed Deposits, investments and
 * retirement accounts are savings, locked or not (a goal can count a deposit that matures before it), and an Other Asset is savings
 * when you can use it now; everything else, a locked Checking or Cash account among them, is outside. An account without a class is
 * cash when it is on budget.
 */
export function defaultAccountRole(account: SnapAccount): PlanAccountRole {
  if (account.excluded) return "outside";
  switch (account.accountClass) {
    case null: return account.offBudget ? "outside" : "cash";
    case "bank":
    case "cash": return account.access === "locked" ? "outside" : "cash";
    case "credit-card": return "cash";
    case "savings":
    case "fixed-deposit":
    case "investment":
    case "retirement": return "savings";
    case "other-asset": return account.access === "available" ? "savings" : "outside";
    default: return "outside";
  }
}

export function accountRole(doc: Pick<PlanDocument, "accountRoles">, account: SnapAccount): PlanAccountRole {
  return doc.accountRoles[account.id] ?? defaultAccountRole(account);
}

/** Where a transfer with an account outside cash is shown when no row is linked to it. */
export function counterpartSection(role: PlanAccountRole | undefined, account: SnapAccount | undefined): SectionId {
  if (role === "savings") return "savings";
  switch (account?.accountClass) {
    case "loan":
    case "credit-card":
    case "other-liability": return "debt";
    case "property":
    case "vehicle":
    case "fixed-asset":
    case "other-asset": return "expenses";
    default: return "savings";
  }
}

/** A loan outside the plan's cash: money that comes from it is borrowing, money that goes to it is a repayment. */
export function isBorrowing(account: SnapAccount | undefined, role: PlanAccountRole | undefined): boolean {
  return account?.accountClass === "loan" && role !== "cash";
}

/**
 * The direction a link counts. A row that follows a loan without saying which way follows the repayments only: borrowed money
 * arriving from the loan is income, and would otherwise show as a negative repayment.
 */
export function effectiveFlow(link: { flow?: "in" | "out" }, account: SnapAccount | undefined, role: PlanAccountRole | undefined): "in" | "out" | undefined {
  return link.flow ?? (isBorrowing(account, role) ? "out" : undefined);
}

/** The row that holds the transfers with an account in one direction, or null when no row does (then they are "Not in plan"). */
export function transferOwner(doc: Pick<PlanDocument, "rows" | "accountRoles">, snapshot: Snapshot, accountId: string, direction: "in" | "out"): string | null {
  const account = snapshot.accounts.find((a) => a.id === accountId);
  const role = account ? accountRole(doc, account) : undefined;
  const held: { rowId: string; flow?: "in" | "out" }[] = [];
  for (const row of doc.rows) for (const link of row.links.accounts) {
    if (link.id !== accountId) continue;
    const flow = effectiveFlow(link, account, role);
    if (!held.some((h) => !h.flow || !flow || h.flow === flow)) held.push({ rowId: row.id, flow });
  }
  return held.find((h) => h.flow === direction)?.rowId ?? held.find((h) => !h.flow)?.rowId ?? null;
}

// ─── Placement ───────────────────────────────────────────────────────────────

/** One placed piece of recorded movement. `target` is a row id, or a section for "Not in plan". */
export type Contribution = {
  target: string; month: Month;
  /** What it is: a category, the transfers with an account, or the uncategorized entries of an account. */
  /** `loanCost`: the interest and fee lines of a loan's repayments, counted with the loan (`id` is the loan account). */
  kind: "category" | "transfer" | "uncategorized" | "loanCost"; id: string;
  /** Natural minor units for the target's section. */
  amount: number;
};

/** A link a row holds that an earlier row already holds: recorded history goes to the earlier row, so the link has no effect on it. */
export type LinkConflict = { rowId: string; what: string; kind: "category" | "group" | "account"; /** The category, group or account. */ name: string; /** The earlier row that holds it. */ heldBy: string };

export type Placed = {
  cashIds: ReadonlySet<string>;
  savingsIds: ReadonlySet<string>;
  /** The savings accounts whose money cannot be used now: locked, or of a class without access that the plan counts as savings. */
  lockedSavingsIds: ReadonlySet<string>;
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
  /** The part of `savingsChange` in locked savings accounts. */
  lockedSavingsChange: Map<Month, number>;
  /** The first month with anything recorded in a cash account. */
  firstMonth: Month | null;
  /** Links that another row already holds, so they have no effect. */
  conflicts: LinkConflict[];
  /** What counting transactions in another month took out of (negative) or added to (positive) each month's flows, so the balances stay the real ones. Cash-signed. */
  moved: Map<Month, number>;
  /** Transactions counted in another month than their date, by id. */
  shifted: Map<string, { from: Month; to: Month; byTag: boolean }>;
  /** The same, by where they were placed: `target|month` for both the month they left and the one they joined. Natural amounts. */
  shiftNotes: Map<string, { id: string; amount: number; from: Month; to: Month }[]>;
};

export const unplannedTarget = (section: SectionId) => `unplanned:${section}`;

const bump = (map: Map<Month, number>, month: Month, amount: number) => { if (amount !== 0) map.set(month, (map.get(month) ?? 0) + amount); };

type PlacementDoc = Pick<PlanDocument, "rows" | "accountRoles" | "moves">;

/** Depends only on the plan's rows (ids, sections, links, loan setting), account roles and moved transactions, never on its amounts: see `placementKey`. */
export function placeActuals(doc: PlacementDoc, snapshot: Snapshot): Placed {
  const accountOf = new Map(snapshot.accounts.map((a) => [a.id, a]));
  const roleOf = new Map(snapshot.accounts.map((a) => [a.id, accountRole(doc, a)]));
  const cashIds = new Set(snapshot.accounts.filter((a) => roleOf.get(a.id) === "cash").map((a) => a.id));
  const savingsIds = new Set(snapshot.accounts.filter((a) => roleOf.get(a.id) === "savings").map((a) => a.id));
  const lockedSavingsIds = new Set(snapshot.accounts.filter((a) => savingsIds.has(a.id) && a.access !== "available").map((a) => a.id));
  const category = new Map(snapshot.categories.map((c) => [c.id, c]));
  const sectionOf = new Map(doc.rows.map((r) => [r.id, r.section]));
  const currentMonth = snapshot.today.slice(0, 7);

  const conflicts: LinkConflict[] = [];
  const categoryRow = new Map<string, string>(), groupRow = new Map<string, string>();
  const accountRows = new Map<string, { rowId: string; flow?: "in" | "out" }[]>();
  for (const row of doc.rows) {
    for (const id of row.links.categories) {
      if (categoryRow.has(id)) conflicts.push({ rowId: row.id, what: `${category.get(id)?.name ?? "A category"} is already followed by another row`, kind: "category", name: category.get(id)?.name ?? "A category", heldBy: categoryRow.get(id)! });
      else categoryRow.set(id, row.id);
    }
    for (const id of row.links.categoryGroups) {
      if (groupRow.has(id)) {
        const name = snapshot.categories.find((c) => c.groupId === id)?.groupName ?? "A category group";
        conflicts.push({ rowId: row.id, what: `${name} (group) is already followed by another row`, kind: "group", name, heldBy: groupRow.get(id)! });
      }
      else groupRow.set(id, row.id);
    }
    for (const link of row.links.accounts) {
      const held = accountRows.get(link.id) ?? [];
      const flow = effectiveFlow(link, accountOf.get(link.id), roleOf.get(link.id));
      const clash = held.find((h) => !h.flow || !flow || h.flow === flow);
      if (clash) conflicts.push({ rowId: row.id, what: `${accountOf.get(link.id)?.name ?? "An account"} is already followed by another row`, kind: "account", name: accountOf.get(link.id)?.name ?? "An account", heldBy: clash.rowId });
      else accountRows.set(link.id, [...held, { rowId: row.id, flow }]);
    }
  }
  const rowForCategory = (id: string | null): string | undefined => {
    if (!id) return undefined;
    return categoryRow.get(id) ?? (category.get(id) ? groupRow.get(category.get(id)!.groupId) : undefined);
  };
  const claim = (accountId: string, flow: "in" | "out"): string | undefined => {
    const links = accountRows.get(accountId) ?? [];
    return links.find((l) => l.flow === flow)?.rowId ?? links.find((l) => !l.flow)?.rowId;
  };

  const placed: Placed = {
    cashIds, savingsIds, lockedSavingsIds, rowActual: new Map(), contributions: [], conflicts,
    unplanned: { income: new Map(), expenses: new Map(), savings: new Map(), debt: new Map() },
    cashChange: new Map(), inTransit: new Map(), startingCash: new Map(), savingsChange: new Map(), lockedSavingsChange: new Map(), firstMonth: null,
    moved: new Map(), shifted: new Map(), shiftNotes: new Map(),
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
  for (const row of snapshot.transfersIn) bump(transferIn, key(row.month, row.accountId, row.transferAccountId), row.amountMinor);
  const uncategorizedIn = new Map<string, number>();
  for (const row of snapshot.uncategorizedIn) bump(uncategorizedIn, key(row.month, row.accountId, ""), row.amountMinor);

  // ── What really happened to the balances, untouched by any move between months ──
  type Cell = { month: Month; accountId: string; categoryId: string | null; transferAccountId: string | null; amountMinor: number };
  const cells = new Map<string, Cell>();
  const cellKey = (c: Omit<Cell, "amountMinor">) => `${c.month}|${c.accountId}|${c.categoryId ?? ""}|${c.transferAccountId ?? ""}`;
  const addCell = (c: Cell) => { const k = cellKey(c); const cell = cells.get(k); if (cell) cell.amountMinor += c.amountMinor; else cells.set(k, { ...c }); };
  for (const row of snapshot.movement) {
    if (savingsIds.has(row.accountId)) bump(placed.savingsChange, row.month, row.amountMinor);
    if (lockedSavingsIds.has(row.accountId)) bump(placed.lockedSavingsChange, row.month, row.amountMinor);
    if (!cashIds.has(row.accountId)) continue;
    bump(placed.cashChange, row.month, row.amountMinor);
    if (!placed.firstMonth || row.month < placed.firstMonth) placed.firstMonth = row.month;
    if (row.transferAccountId && cashIds.has(row.transferAccountId)) { bump(placed.inTransit, row.month, row.amountMinor); continue; }
    addCell({ month: row.month, accountId: row.accountId, categoryId: row.categoryId, transferAccountId: row.transferAccountId, amountMinor: row.amountMinor });
  }

  /** Where one transaction is placed: used to mark the cells a moved transaction left and joined. */
  const targetOf = (t: { accountId: string; categoryId: string | null; transferAccountId: string | null; amountMinor: number }): { target: string; section: SectionId } => {
    const flow = t.amountMinor >= 0 ? "in" : "out";
    let rowId: string | undefined, fallback: SectionId;
    if (t.transferAccountId) {
      const borrowed = flow === "in" && isBorrowing(accountOf.get(t.transferAccountId), roleOf.get(t.transferAccountId));
      rowId = (accountRows.get(t.transferAccountId) ?? []).length ? claim(t.transferAccountId, flow) : borrowed ? undefined : rowForCategory(t.categoryId);
      fallback = borrowed ? "income" : counterpartSection(roleOf.get(t.transferAccountId), accountOf.get(t.transferAccountId));
    } else if (t.categoryId) {
      rowId = rowForCategory(t.categoryId);
      fallback = category.get(t.categoryId)?.isIncome ? "income" : "expenses";
    } else {
      rowId = claim(t.accountId, flow);
      fallback = flow === "in" ? "income" : "expenses";
    }
    const section = rowId ? sectionOf.get(rowId)! : fallback;
    return { target: rowId ?? unplannedTarget(section), section };
  };

  // ── Transactions counted in another month: the plan's own choice wins over a tag in the note ──
  for (const t of snapshot.shifts) {
    const from = t.date.slice(0, 7);
    const chosen = doc.moves[t.id];
    const to = chosen ?? t.tagMonth;
    // A month that has not ended holds no actuals to join, and a transfer inside cash moves nothing to begin with.
    if (!to || to === from || to > currentMonth || !cashIds.has(t.accountId) || (t.transferAccountId && cashIds.has(t.transferAccountId))) continue;
    const base = { accountId: t.accountId, categoryId: t.categoryId, transferAccountId: t.transferAccountId };
    addCell({ ...base, month: from, amountMinor: -t.amountMinor });
    addCell({ ...base, month: to, amountMinor: t.amountMinor });
    if (t.amountMinor > 0) {
      const map = t.transferAccountId ? transferIn : t.categoryId ? null : uncategorizedIn;
      const other = t.transferAccountId ?? "";
      if (map) { bump(map, key(from, t.accountId, other), -t.amountMinor); bump(map, key(to, t.accountId, other), t.amountMinor); }
    }
    bump(placed.moved, from, t.amountMinor);
    bump(placed.moved, to, -t.amountMinor);
    placed.shifted.set(t.id, { from, to, byTag: chosen === undefined });
    const where = targetOf(t);
    const note = { id: t.id, amount: t.amountMinor * SECTION_SIGN[where.section], from, to };
    for (const month of [from, to]) placed.shiftNotes.set(`${where.target}|${month}`, [...(placed.shiftNotes.get(`${where.target}|${month}`) ?? []), note]);
  }

  // ── Placement ──
  // Transfers with an account outside cash, by month and counterpart: their total, and the same by category.
  type Outside = { month: Month; counterpart: string; total: number; moneyIn: number; byCategory: Map<string | null, number> };
  const outside = new Map<string, Outside>();
  const seenIn = new Set<string>();
  const seenUncategorized = new Set<string>();

  for (const row of cells.values()) {
    if (row.transferAccountId) {
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
    const inKey = key(row.month, row.accountId, "");
    if (seenUncategorized.has(inKey)) continue;
    seenUncategorized.add(inKey);
    const moneyIn = Math.max(0, uncategorizedIn.get(inKey) ?? Math.max(0, row.amountMinor));
    const moneyOut = row.amountMinor - moneyIn;
    put(claim(row.accountId, "in"), "income", row.month, moneyIn, "uncategorized", row.accountId);
    put(claim(row.accountId, "out"), "expenses", row.month, moneyOut, "uncategorized", row.accountId);
  }

  for (const cell of outside.values()) {
    const fallback = counterpartSection(roleOf.get(cell.counterpart), accountOf.get(cell.counterpart));
    // The recorded positive part; when that read has nothing for the cell, a positive total is all money in.
    const moneyIn = Math.max(cell.moneyIn, 0, cell.total);
    const moneyOut = cell.total - moneyIn;
    // Money that arrives from a loan is borrowing: it comes in as income, and is never netted against the repayments.
    const borrowed = moneyIn > 0 && isBorrowing(accountOf.get(cell.counterpart), roleOf.get(cell.counterpart));
    if ((accountRows.get(cell.counterpart) ?? []).length === 0) {
      if (borrowed) {
        put(undefined, "income", cell.month, moneyIn, "transfer", cell.counterpart);
        // What was repaid in the same month follows its category when it has one.
        const categories = [...cell.byCategory.keys()].filter((c) => c);
        const rowId = categories.length === 1 ? rowForCategory(categories[0]) : undefined;
        put(rowId, fallback, cell.month, moneyOut, rowId ? "category" : "transfer", rowId ? categories[0]! : cell.counterpart);
        continue;
      }
      // No row follows the account: each part follows its category, as Actual's budget does.
      for (const [categoryId, amount] of cell.byCategory) {
        const rowId = rowForCategory(categoryId);
        if (rowId) put(rowId, fallback, cell.month, amount, "category", categoryId!);
        else put(undefined, fallback, cell.month, amount, "transfer", cell.counterpart);
      }
      continue;
    }
    put(claim(cell.counterpart, "in"), borrowed ? "income" : fallback, cell.month, moneyIn, "transfer", cell.counterpart);
    put(claim(cell.counterpart, "out"), fallback, cell.month, moneyOut, "transfer", cell.counterpart);
  }

  // ── Whole repayments: the interest and fee lines of a loan's repayments leave their category and count with the loan ──
  const wholeLoanRow = new Map<string, string>();
  for (const row of doc.rows) {
    if (row.basis.kind !== "loan" || row.basis.count === "principal") continue;
    for (const link of row.links.accounts) if (!wholeLoanRow.has(link.id) && claim(link.id, "out") === row.id) wholeLoanRow.set(link.id, row.id);
  }
  for (const line of snapshot.loanCosts) {
    const rowId = wholeLoanRow.get(line.loanAccountId);
    if (!rowId || !line.categoryId || !cashIds.has(line.accountId)) continue;
    const month = placed.shifted.get(line.id)?.to ?? line.month;
    put(rowForCategory(line.categoryId), category.get(line.categoryId)?.isIncome ? "income" : "expenses", month, -line.amountMinor, "category", line.categoryId);
    put(rowId, "debt", month, line.amountMinor, "loanCost", line.loanAccountId);
  }

  for (const row of snapshot.startingBalances) {
    if (savingsIds.has(row.accountId)) bump(placed.savingsChange, row.month, row.amountMinor);
    if (lockedSavingsIds.has(row.accountId)) bump(placed.lockedSavingsChange, row.month, row.amountMinor);
    if (!cashIds.has(row.accountId)) continue;
    bump(placed.cashChange, row.month, row.amountMinor);
    bump(placed.startingCash, row.month, row.amountMinor);
  }
  return placed;
}

/** Everything `placeActuals` reads from a plan, as one string: while it is unchanged the placement can be reused. */
export function placementKey(doc: PlacementDoc): string {
  return JSON.stringify([doc.accountRoles, doc.moves, doc.rows.map((r) => [r.id, r.section, r.links, r.basis.kind === "loan" ? r.basis.count ?? "whole" : null])]);
}

/** The pieces behind one row (or one section's "Not in plan") in the given months, largest first, with their names. */
export function contributionsOf(placed: Placed, snapshot: Snapshot, target: string, months: ReadonlySet<Month>, keepZero = false): { kind: Contribution["kind"]; id: string; label: string; amount: number }[] {
  const names = new Map<string, string>();
  for (const c of snapshot.categories) names.set(`category:${c.id}`, c.name);
  for (const a of snapshot.accounts) { names.set(`transfer:${a.id}`, `Transfers: ${a.name}`); names.set(`uncategorized:${a.id}`, `Uncategorized in ${a.name}`); names.set(`loanCost:${a.id}`, `Interest and fees: ${a.name}`); }
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
    .filter((entry) => keepZero || entry.amount !== 0)
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
export function placeActualsCached(doc: PlacementDoc, snapshot: Snapshot): Placed {
  const key = placementKey(doc);
  const cached = placements.get(snapshot);
  if (cached?.key === key) return cached.placed;
  const placed = placeActuals(doc, snapshot);
  placements.set(snapshot, { key, placed });
  return placed;
}
