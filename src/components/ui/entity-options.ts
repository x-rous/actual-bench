import type { ReactNode } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";

/**
 * Builds the option lists behind the account, category and payee pickers, so
 * every feature groups, orders and marks them the same way. Each builder takes
 * plain data (the staged store, a server's account list, a loan directory) and
 * a few switches for what a feature must leave out; the defaults suit a form
 * field that edits existing data.
 *
 * Order is the order given, which is Actual's own. Payees are the exception:
 * Actual keeps them alphabetical, so they are sorted here.
 */

type Named = { id: string; name: string };

type Common<T> = {
  /** Ids to leave out: the account already chosen in another field, say. */
  exclude?: readonly (string | null | undefined)[];
  /** Any other restriction a feature needs. */
  filter?: (item: T) => boolean;
};

const section = (name: string): ComboboxOption => ({
  id: `section:${name}`,
  name,
  isGroupHeader: true,
  section: true,
});

const groupHeader = (group: Named & { hidden?: boolean }): ComboboxOption => ({
  id: `group:${group.id}`,
  name: group.name,
  isGroupHeader: true,
  hidden: group.hidden,
});

function keep<T extends Named>(items: readonly T[], { exclude, filter }: Common<T>, rule: (item: T) => boolean) {
  const excluded = new Set(exclude ?? []);
  return items.filter((item) => !excluded.has(item.id) && rule(item) && (filter?.(item) ?? true));
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export type AccountItem = Named & {
  /** Absent for accounts with no budget status (another server's, a simulated one): the list is then flat. */
  offBudget?: boolean;
  closed?: boolean;
  groupId?: string | null;
};

export type AccountOptionsConfig<T extends AccountItem = AccountItem> = Common<T> & {
  /** Closed accounts: dimmed and marked (default), shown plainly, shown but not selectable, or left out. */
  closed?: "dim" | "show" | "disable" | "exclude";
  /** Which budget side to offer. Default both. */
  budget?: "both" | "on" | "off";
};

/**
 * On budget, then Off budget; inside each, ungrouped accounts first and then
 * one heading per account group. Groups only appear when the budget has them.
 */
export function buildAccountOptions<T extends AccountItem>(
  accounts: readonly T[],
  groups: readonly Named[] = [],
  config: AccountOptionsConfig<T> = {}
): ComboboxOption[] {
  const { closed = "dim", budget = "both" } = config;
  const kept = keep(accounts, config, (a) =>
    !(closed === "exclude" && a.closed) &&
    (budget === "both" || (budget === "off") === !!a.offBudget)
  );
  const toOption = (a: T): ComboboxOption => ({
    id: a.id,
    name: a.name,
    hidden: closed === "dim" && !!a.closed,
    disabled: closed === "disable" && !!a.closed,
    trailing: a.closed && closed !== "show" ? "closed" : undefined,
  });

  if (!kept.some((a) => a.offBudget !== undefined)) return kept.map(toOption);

  const known = new Set(groups.map((g) => g.id));
  const result: ComboboxOption[] = [];
  for (const offBudget of [false, true]) {
    const inSection = kept.filter((a) => !!a.offBudget === offBudget);
    if (inSection.length === 0) continue;
    result.push(section(offBudget ? "Off budget" : "On budget"));
    result.push(...inSection.filter((a) => !a.groupId || !known.has(a.groupId)).map(toOption));
    for (const group of groups) {
      const members = inSection.filter((a) => a.groupId === group.id);
      if (members.length === 0) continue;
      result.push(groupHeader(group), ...members.map(toOption));
    }
  }
  return result;
}

// ─── Categories ──────────────────────────────────────────────────────────────

export type CategoryItem = Named & {
  groupId?: string;
  /** Groups by name where no group id is known (a directory that only carries names). */
  groupName?: string;
  isIncome?: boolean;
  hidden?: boolean;
};

export type CategoryGroupItem = Named & {
  isIncome?: boolean;
  hidden?: boolean;
  /** The group's own order of its categories, where known. */
  categoryIds?: readonly string[];
};

type Visibility = {
  /** Hidden ones: dimmed and marked (default), shown plainly, or left out. */
  hidden?: "dim" | "show" | "exclude";
  /** Which side of the budget to offer. Default both. */
  side?: "both" | "expense" | "income";
};

export type CategoryOptionsConfig<T extends CategoryItem = CategoryItem> = Common<T> &
  Visibility & {
    /** Text at the end of a row, such as the category's balance. */
    trailing?: (category: T) => ReactNode;
  };

/** The groups a category list implies, when the caller has no group list of its own. */
function groupsFrom(categories: readonly CategoryItem[]): CategoryGroupItem[] {
  const groups = new Map<string, CategoryGroupItem>();
  for (const c of categories) {
    const id = c.groupId ?? c.groupName ?? "";
    if (!groups.has(id)) groups.set(id, { id, name: c.groupName ?? "", isIncome: c.isIncome });
  }
  return [...groups.values()];
}

const sideRule = (side: Visibility["side"], isIncome: boolean | undefined) =>
  side === "both" || side === undefined || (side === "income") === !!isIncome;

/**
 * Expense, then Income; inside each, one heading per category group. A
 * category in a hidden group counts as hidden.
 */
export function buildCategoryOptions<T extends CategoryItem>(
  categories: readonly T[],
  groups?: readonly CategoryGroupItem[],
  config: CategoryOptionsConfig<T> = {}
): ComboboxOption[] {
  const { hidden = "dim", side = "both", trailing } = config;
  const allGroups = groups ?? groupsFrom(categories);
  const groupOf = new Map(allGroups.map((g) => [g.id, g]));
  const groupKey = (c: T) => (groups ? c.groupId : c.groupId ?? c.groupName ?? "");
  const isHidden = (c: T) => !!c.hidden || !!groupOf.get(groupKey(c) ?? "")?.hidden;
  const isIncome = (c: T) => c.isIncome ?? groupOf.get(groupKey(c) ?? "")?.isIncome;

  const kept = keep(categories, config, (c) =>
    !(hidden === "exclude" && isHidden(c)) && sideRule(side, isIncome(c))
  );
  const toOption = (c: T): ComboboxOption => {
    const dim = hidden === "dim" && isHidden(c);
    return { id: c.id, name: c.name, hidden: dim, trailing: trailing?.(c) ?? (dim ? "hidden" : undefined) };
  };

  const membersOf = (g: CategoryGroupItem) => {
    const members = kept.filter((c) => groupKey(c) === g.id);
    if (!g.categoryIds) return members;
    // The group's own order where it has one; anything it does not list goes last.
    const rank = new Map(g.categoryIds.map((id, i) => [id, i]));
    return members.sort((x, y) => (rank.get(x.id) ?? Infinity) - (rank.get(y.id) ?? Infinity));
  };
  // A category with no known, named group still belongs to its side, ahead of the groups.
  const isLoose = (c: T) => !groupOf.get(groupKey(c) ?? "")?.name;

  const sectioned = kept.some((c) => isIncome(c) !== undefined);
  const result: ComboboxOption[] = [];
  for (const income of sectioned ? [false, true] : [undefined]) {
    const inSide = (c: T) => income === undefined || !!isIncome(c) === income;
    const loose = kept.filter((c) => inSide(c) && isLoose(c));
    const blocks = allGroups
      .filter((g) => g.name && (income === undefined || !!g.isIncome === income))
      .map((g) => ({ g, members: membersOf(g).filter(inSide) }))
      .filter(({ members }) => members.length > 0);
    if (loose.length === 0 && blocks.length === 0) continue;
    if (income !== undefined) result.push(section(income ? "Income" : "Expense"));
    result.push(...loose.map(toOption));
    for (const { g, members } of blocks) {
      result.push(groupHeader({ ...g, hidden: hidden === "dim" && g.hidden }), ...members.map(toOption));
    }
  }
  return result;
}

export type CategoryGroupOptionsConfig<T extends CategoryGroupItem = CategoryGroupItem> = Common<T> & Visibility;

/** Category groups as choices, under Expense and Income. */
export function buildCategoryGroupOptions<T extends CategoryGroupItem>(
  groups: readonly T[],
  config: CategoryGroupOptionsConfig<T> = {}
): ComboboxOption[] {
  const { hidden = "dim", side = "both" } = config;
  const kept = keep(groups, config, (g) => !(hidden === "exclude" && g.hidden) && sideRule(side, g.isIncome));
  const toOption = (g: T): ComboboxOption => {
    const dim = hidden === "dim" && !!g.hidden;
    return { id: g.id, name: g.name, hidden: dim, trailing: dim ? "hidden" : undefined };
  };
  if (!kept.some((g) => g.isIncome !== undefined)) return kept.map(toOption);
  const result: ComboboxOption[] = [];
  for (const income of [false, true]) {
    const members = kept.filter((g) => !!g.isIncome === income);
    if (members.length > 0) result.push(section(income ? "Income" : "Expense"), ...members.map(toOption));
  }
  return result;
}

// ─── Payees ──────────────────────────────────────────────────────────────────

export type PayeeItem = Named & { transferAccountId?: string | null };

export type PayeeOptionsConfig<T extends PayeeItem = PayeeItem> = Common<T> & {
  /** Transfer payees: listed and marked (default), or left out. */
  transfers?: "show" | "exclude";
};

/** One alphabetical list; a transfer payee is marked as one. */
export function buildPayeeOptions<T extends PayeeItem>(
  payees: readonly T[],
  config: PayeeOptionsConfig<T> = {}
): ComboboxOption[] {
  const { transfers = "show" } = config;
  return keep(payees, config, (p) => !(transfers === "exclude" && p.transferAccountId))
    .map((p) => ({ id: p.id, name: p.name, trailing: p.transferAccountId ? "transfer" : undefined }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
