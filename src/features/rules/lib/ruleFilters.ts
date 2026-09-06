/**
 * The action-type filter's predicate, as a function rather than a branch inside
 * the table's render.
 *
 * Extracted because the filter now has two entries that are not action *fields*
 * at all - `split` is a shape and `schedule` is an op - so "does any action have
 * this field" stopped being the whole rule, and the exceptions are worth stating
 * where they can be read and tested.
 */

import type { ConditionOrAction, Rule } from "@/types/entities";
import type { ActionTypeFilter } from "../components/FilterBar";
import { isSplitRule } from "./splitActions";

/**
 * A rule created and owned by a schedule.
 *
 * Identified by the `link-schedule` op rather than a field: the action carries
 * the schedule id as its value, and no action field says "schedule". These rules
 * behave differently from the rest - the Schedules page owns them, and the table
 * refuses to delete them - which is exactly why they are worth filtering to.
 */
export function isScheduleLinkedRule(actions: readonly ConditionOrAction[]): boolean {
  return actions.some((action) => action.op === "link-schedule");
}

export function matchesActionTypeFilter(rule: Rule, filter: ActionTypeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "split") return isSplitRule(rule.actions);
  if (filter === "schedule") return isScheduleLinkedRule(rule.actions);
  return rule.actions.some((action) => action.field === filter);
}
