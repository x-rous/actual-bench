import type { Statement, Workspace } from "../lib/models";
import { unassignedPlanEntries } from "../lib/derive/planAccounts";
import { planStatus } from "../lib/plans";
import { discoverPlans } from "../lib/derive/planDiscovery";
import type { CardEntry } from "./cardEntry";
import { money, plural, shortDate } from "./primitives/format";

export type AttentionItem = {
  key: string;
  icon: "warning" | "danger" | "estimate";
  /** 0 = overdue, 1 = needs a decision, 2 = an estimate to enter. */
  rank: number;
  text: string;
  /** How many things the item stands for (found plans), when more than one. */
  count?: number;
  target: { kind: "statement"; statement: Statement } | { kind: "review"; statement: Statement } | { kind: "enter" } | { kind: "plans" };
};

/**
 * What needs the user on one card, most urgent first: one list for the Overview's "Needs your
 * attention" and the All cards Needs attention column, so the two never disagree.
 */
export function cardAttention(entry: CardEntry, workspace: Workspace): AttentionItem[] {
  const { card, view, snapshot, today } = entry;
  const found = snapshot ? discoverPlans(card, workspace, snapshot) : null;
  const covered = new Set([...(found?.candidates.flatMap((candidate) => candidate.rowIds) ?? []), ...(found?.ambiguous.map((row) => row.id) ?? [])]);
  // Entries a found plan or an ambiguity explains get those items instead of "with no plan".
  const unassigned = (snapshot ? unassignedPlanEntries(card, workspace, snapshot) : []).filter((row) => !covered.has(row.id));
  const foundIn = [...new Set(found?.candidates.map((candidate) => candidate.accountName) ?? [])];
  const tags = [...new Set(workspace.plans.filter((plan) => plan.planAccountTag
    && unassigned.some((row) => row.accountId === plan.planAccountId)).map((plan) => plan.planAccountTag!))];
  const plans = workspace.plans.filter((plan) => plan.cardId === card.id && plan.status === "active");
  return [
    ...view.rows.filter((item) => item.attention).map((item): AttentionItem => {
      const { statement, status, match } = item;
      const date = shortDate(statement.closingDate, today);
      if (statement.estimate) {
        return {
          key: statement.id, icon: "estimate", rank: 2, target: { kind: "enter" },
          text: `Statement closing ${date} not entered yet · estimate ${money(statement.balanceMinor)}`,
        };
      }
      if (status.overdue) {
        return {
          key: statement.id, icon: "danger", rank: 0, target: { kind: "statement", statement },
          text: `Statement ${date} · Overdue · ${money(item.payment?.leftToPayMinor)} left to pay`,
        };
      }
      return {
        key: statement.id, icon: "warning", rank: 1, target: { kind: "review", statement },
        text: `Statement ${date} · ${match.label}${match.line ? ` · ${match.line}` : ""}`,
      };
    }),
    ...(found?.candidates.length ? [{
      key: "found", icon: "warning" as const, rank: 1, target: { kind: "plans" as const }, count: found.candidates.length,
      text: `${plural(found.candidates.length, "instalment plan")} found in ${foundIn.join(" and ")}: add them to track them`,
    }] : []),
    ...(found?.ambiguous.length ? [{
      key: "ambiguous", icon: "warning" as const, rank: 1, target: { kind: "plans" as const },
      text: `${plural(found.ambiguous.length, "plan-account transfer")} ${found.ambiguous.length === 1 ? "carries" : "carry"} two plan tags: keep one per transfer in Actual`,
    }] : []),
    ...(unassigned.length ? [{
      key: "unassigned", icon: "warning" as const, rank: 1, target: { kind: "plans" as const },
      text: `${plural(unassigned.length, "plan-account entry", "plan-account entries")} with no plan${tags.length
        ? `: add ${tags.join(" or ")} to the notes in Actual` : ""}`,
    }] : []),
    ...plans.flatMap((plan): AttentionItem[] => {
      const status = planStatus(plan, card, workspace, snapshot, today);
      return status.check ? [{ key: plan.id, icon: "warning", rank: 1, target: { kind: "plans" }, text: `Plan ${plan.name} · ${status.label}` }] : [];
    }),
  ].sort((a, b) => a.rank - b.rank);
}

/** The short one-line summary for a table cell: the most urgent item, plus how many more. */
export function attentionSummary(items: AttentionItem[]) {
  if (!items.length) return null;
  const counts = { statement: 0, estimate: 0, plan: 0, found: 0 };
  for (const item of items) {
    if (item.key === "found") counts.found += item.count ?? 1;
    else if (item.target.kind === "plans") counts.plan += 1;
    else if (item.target.kind === "enter") counts.estimate += 1;
    else counts.statement += 1;
  }
  return [
    counts.statement ? plural(counts.statement, "statement") + " to check" : null,
    counts.estimate ? plural(counts.estimate, "statement") + " to enter" : null,
    counts.found ? `${plural(counts.found, "plan")} found` : null,
    counts.plan ? plural(counts.plan, "plan item") : null,
  ].filter(Boolean).join(" · ");
}
