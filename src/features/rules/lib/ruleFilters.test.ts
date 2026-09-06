import { isScheduleLinkedRule, matchesActionTypeFilter } from "./ruleFilters";
import type { ConditionOrAction, Rule } from "@/types/entities";

function rule(actions: ConditionOrAction[]): Rule {
  return {
    id: "r1",
    stage: "default",
    conditionsOp: "and",
    conditions: [{ field: "payee", op: "is", value: "p1" }],
    actions,
  } as Rule;
}

const setCategory: ConditionOrAction = { field: "category", op: "set", value: "c1" };
const linkSchedule: ConditionOrAction = { field: "", op: "link-schedule", value: "s1" };

describe("the action-type filter", () => {
  it("keeps everything under All", () => {
    expect(matchesActionTypeFilter(rule([setCategory]), "all")).toBe(true);
    expect(matchesActionTypeFilter(rule([]), "all")).toBe(true);
  });

  it("matches an ordinary filter on the action's field", () => {
    expect(matchesActionTypeFilter(rule([setCategory]), "category")).toBe(true);
    expect(matchesActionTypeFilter(rule([setCategory]), "payee")).toBe(false);
  });

  it("selects schedule-linked rules by their op, not a field", () => {
    // No action field says "schedule": the link is an op carrying the schedule
    // id, so a field comparison would never match one.
    expect(matchesActionTypeFilter(rule([linkSchedule]), "schedule")).toBe(true);
    expect(matchesActionTypeFilter(rule([setCategory]), "schedule")).toBe(false);
  });

  it("finds the link alongside other actions", () => {
    // A schedule's rule usually sets the payee and amount too.
    expect(matchesActionTypeFilter(rule([setCategory, linkSchedule]), "schedule")).toBe(true);
    // And such a rule still answers its other filters.
    expect(matchesActionTypeFilter(rule([setCategory, linkSchedule]), "category")).toBe(true);
  });

  it("agrees with the badge shown on the row", () => {
    // The table marks these rows with a calendar icon and refuses to delete
    // them. The filter that selects them reads the same predicate, so the two
    // cannot drift apart.
    expect(isScheduleLinkedRule([linkSchedule])).toBe(true);
    expect(isScheduleLinkedRule([setCategory])).toBe(false);
  });
});
