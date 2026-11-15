import type { Basis, Month, PlanDocument, PlanGroup, PlanRow, SectionId } from "./types";
import { accountRole, placeActuals, unplannedTarget, type Snapshot } from "./actuals";
import { createPlanDocument, createRow } from "./document";
import { addMonths, monthIndex } from "./months";
import { generateId } from "@/lib/uuid";

/**
 * A first plan from what Actual already holds, so nobody starts from an empty grid: one row for each thing that moved the
 * plan's cash over the last twelve complete months, each following its own history. The user then changes what they know
 * better (a raise, a loan that ends, a planned purchase). Pure.
 */

export type BuildOptions = {
  name: string;
  startMonth: Month;
  /** How long the plan is: `months`, or `years` years (5 when neither is given). */
  years?: number;
  months?: number;
  /** One expense row per category group, or one per category. */
  detail: "groups" | "categories";
  /** Credit cards as part of the plan's cash (a purchase counts when it is made), or outside it (only the payments to them count). */
  cards?: "cash" | "outside";
};

const LOOKBACK = 12;

export function buildPlanFromActuals(snapshot: Snapshot, options: BuildOptions): PlanDocument {
  const base = createPlanDocument({ name: options.name, startMonth: options.startMonth, years: options.years, months: options.months, useActuals: true });
  const doc = options.cards === "outside"
    ? { ...base, accountRoles: Object.fromEntries(snapshot.accounts.filter((a) => a.accountClass === "credit-card" && !a.excluded).map((a) => [a.id, "outside" as const])) }
    : base;
  const currentMonth = snapshot.today.slice(0, 7);
  const since = addMonths(currentMonth, -LOOKBACK);
  // With no rows, every movement lands in "Not in plan" with what it is: exactly the list of rows to create.
  const placed = placeActuals(doc, snapshot);
  const recent = placed.contributions.filter((c) => c.month >= since && c.month < currentMonth);

  const category = new Map(snapshot.categories.map((c) => [c.id, c]));
  const account = new Map(snapshot.accounts.map((a) => [a.id, a]));
  const categoryOrder = new Map(snapshot.categories.map((c, i) => [c.id, i]));
  const groupOrder = new Map<string, number>();
  for (const c of snapshot.categories) if (!groupOrder.has(c.groupId)) groupOrder.set(c.groupId, groupOrder.size);

  /** How steady a thing is: with something recorded in most months, the last three say more than the last twelve (a raise, a new rent). */
  const basisFor = (months: ReadonlySet<Month>): Basis => {
    const available = placed.firstMonth ? Math.min(LOOKBACK, monthIndex(currentMonth) - monthIndex(placed.firstMonth)) : 0;
    const steady = available >= 6 && months.size >= available - 1 && [1, 2, 3].every((k) => months.has(addMonths(currentMonth, -k)));
    return { kind: "average", months: steady ? 3 : 12 };
  };

  const groups: PlanGroup[] = [];
  const rows: PlanRow[] = [];
  const group = (section: SectionId, name: string): string => {
    const existing = groups.find((g) => g.section === section && g.name === name);
    if (existing) return existing.id;
    const created = { id: generateId(), name, section };
    groups.push(created);
    return created.id;
  };

  // ── Categories ─────────────────────────────────────────────────────────────
  const categoryMonths = new Map<string, Set<Month>>();
  for (const c of recent) {
    if (c.kind !== "category") continue;
    categoryMonths.set(c.id, (categoryMonths.get(c.id) ?? new Set()).add(c.month));
  }
  const usedCategories = [...categoryMonths.keys()].filter((id) => category.has(id)).sort((a, b) => categoryOrder.get(a)! - categoryOrder.get(b)!);

  const income = usedCategories.filter((id) => category.get(id)!.isIncome);
  for (const id of income) rows.push(createRow({ name: category.get(id)!.name, section: "income", basis: basisFor(categoryMonths.get(id)!), links: { categories: [id] } }));

  const expense = usedCategories.filter((id) => !category.get(id)!.isIncome);
  if (options.detail === "groups") {
    const byGroup = new Map<string, Set<Month>>();
    for (const id of expense) {
      const months = byGroup.get(category.get(id)!.groupId) ?? new Set<Month>();
      for (const m of categoryMonths.get(id)!) months.add(m);
      byGroup.set(category.get(id)!.groupId, months);
    }
    for (const groupId of [...byGroup.keys()].sort((a, b) => groupOrder.get(a)! - groupOrder.get(b)!)) {
      const name = snapshot.categories.find((c) => c.groupId === groupId)!.groupName;
      rows.push(createRow({ name, section: "expenses", basis: basisFor(byGroup.get(groupId)!), links: { categoryGroups: [groupId] } }));
    }
  } else {
    for (const id of expense) {
      const info = category.get(id)!;
      rows.push(createRow({ name: info.name, section: "expenses", groupId: group("expenses", info.groupName), basis: basisFor(categoryMonths.get(id)!), links: { categories: [id] } }));
    }
  }

  // ── Accounts outside the plan's cash ───────────────────────────────────────
  const transferMonths = new Map<string, Set<Month>>();
  for (const c of recent) {
    if (c.kind !== "transfer") continue;
    transferMonths.set(c.id, (transferMonths.get(c.id) ?? new Set()).add(c.month));
  }
  // A tracked loan gets a row even when nothing was paid yet: its schedule is what matters.
  for (const id of Object.keys(snapshot.loans)) if (snapshot.loans[id].state === "ready" && !transferMonths.has(id)) transferMonths.set(id, new Set());
  // Loans that paid money into cash in these months: borrowing, shown as income on its own row.
  const borrowedFrom = new Set(recent.filter((c) => c.kind === "transfer" && c.target === unplannedTarget("income")).map((c) => c.id));
  for (const id of [...transferMonths.keys()].sort((a, b) => (account.get(a)?.name ?? "").localeCompare(account.get(b)?.name ?? ""))) {
    const info = account.get(id);
    if (!info) continue;
    const role = accountRole(doc, info);
    const loan = snapshot.loans[id];
    if (role === "savings") {
      rows.push(createRow({ name: info.name, section: "savings", basis: basisFor(transferMonths.get(id)!), links: { accounts: [{ id }] } }));
    } else if (info.accountClass === "loan" || info.accountClass === "other-liability" || info.accountClass === "credit-card") {
      rows.push(createRow({ name: info.accountClass === "credit-card" ? `${info.name} payments` : info.name, section: "debt", basis: loan?.state === "ready" ? { kind: "loan" } : basisFor(transferMonths.get(id)!), links: { accounts: [info.accountClass === "loan" ? { id, flow: "out" } : { id }] } }));
      // Borrowing is not a monthly habit: the row shows what was drawn, and the next amounts are typed by hand.
      if (borrowedFrom.has(id)) rows.push(createRow({ name: `${info.name} borrowed`, section: "income", basis: { kind: "manual" }, links: { accounts: [{ id, flow: "in" }] } }));
    } else if (info.accountClass === "property" || info.accountClass === "vehicle" || info.accountClass === "other-asset") {
      // What was put into an asset is rarely a monthly habit: the row is there to plan the next amounts by hand.
      rows.push(createRow({ name: info.name, section: "expenses", groupId: options.detail === "categories" ? group("expenses", "Assets") : null, basis: { kind: "manual" }, links: { accounts: [{ id }] } }));
    } else {
      rows.push(createRow({ name: info.name, section: "savings", basis: basisFor(transferMonths.get(id)!), links: { accounts: [{ id }] } }));
    }
  }

  return { ...doc, groups, rows };
}
