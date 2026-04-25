import type { ConditionOrAction, Rule } from "@/types/entities";
import type { CheckFn, Finding, RuleRef } from "../../types";
import { registerCheck } from "../runDiagnostics";
import { buildFinding } from "../findingMessages";
import { findingRuleSummary } from "../../utils/findingRuleSummary";

function asNumber(v: ConditionOrAction["value"]): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/** Find contradictory pairs within an `and`-combined rule's conditions on the same field. */
function findContradictions(rule: Rule): string[] {
  if (rule.conditionsOp !== "and") return [];
  const conflicts: string[] = [];

  // Group conditions by field.
  const byField = new Map<string, ConditionOrAction[]>();
  for (const c of rule.conditions) {
    const f = c.field ?? "";
    const bucket = byField.get(f);
    if (bucket) bucket.push(c);
    else byField.set(f, [c]);
  }

  // Account-level onBudget vs offBudget contradiction is field-scoped to "account".
  const accountConds = byField.get("account") ?? [];
  if (
    accountConds.some((c) => c.op === "onBudget") &&
    accountConds.some((c) => c.op === "offBudget")
  ) {
    conflicts.push("account is both onBudget and offBudget");
  }

  for (const [field, conds] of byField.entries()) {
    if (conds.length < 2) continue;

    // Same field, two equality conditions with different literal values.
    const equalities = conds.filter((c) => c.op === "is");
    if (equalities.length >= 2) {
      const distinct = new Set(equalities.map((c) => JSON.stringify(c.value)));
      if (distinct.size >= 2) {
        conflicts.push(`${field}: requires equality to multiple distinct values`);
      }
    }

    // is "X" + isNot "X" on the same field.
    const isVals = equalities.map((c) => JSON.stringify(c.value));
    const isNots = conds.filter((c) => c.op === "isNot").map((c) => JSON.stringify(c.value));
    for (const v of isVals) {
      if (isNots.includes(v)) {
        conflicts.push(`${field}: is and isNot the same value`);
        break;
      }
    }

    // oneOf set + notOneOf superset → impossible if every oneOf value is in notOneOf.
    const oneOfs = conds
      .filter((c) => c.op === "oneOf" && Array.isArray(c.value))
      .map((c) => new Set(c.value as string[]));
    const notOneOfs = conds
      .filter((c) => c.op === "notOneOf" && Array.isArray(c.value))
      .map((c) => new Set(c.value as string[]));
    for (const allow of oneOfs) {
      for (const deny of notOneOfs) {
        if (allow.size > 0 && [...allow].every((v) => deny.has(v))) {
          conflicts.push(`${field}: oneOf set is fully excluded by notOneOf`);
          break;
        }
      }
    }

    // Numeric range contradictions: gt X with lt Y when Y <= X, etc.
    const gt = numericBound(conds, ["gt", "gte"]);
    const lt = numericBound(conds, ["lt", "lte"]);
    if (gt !== null && lt !== null) {
      // gt 10 with lt 5 → 10 < 5 false: range is empty when lt-bound <= gt-bound.
      const invalid =
        (gt.op === "gt" && lt.op === "lt" && lt.value <= gt.value) ||
        (gt.op === "gte" && lt.op === "lt" && lt.value <= gt.value) ||
        (gt.op === "gt" && lt.op === "lte" && lt.value <= gt.value) ||
        (gt.op === "gte" && lt.op === "lte" && lt.value < gt.value);
      if (invalid) {
        conflicts.push(`${field}: numeric range is empty (${gt.op} ${gt.value} and ${lt.op} ${lt.value})`);
      }
    }

    // is N combined with isbetween that excludes N.
    for (const c of equalities) {
      const eqN = asNumber(c.value);
      if (eqN === null) continue;
      for (const between of conds) {
        if (between.op !== "isbetween") continue;
        const v = between.value;
        if (
          v &&
          typeof v === "object" &&
          !Array.isArray(v) &&
          "num1" in v &&
          "num2" in v
        ) {
          const lo = Math.min(v.num1, v.num2);
          const hi = Math.max(v.num1, v.num2);
          if (eqN < lo || eqN > hi) {
            conflicts.push(
              `${field}: is ${eqN} but also requires isbetween ${lo}–${hi}`
            );
          }
        }
      }
    }
  }

  // Deduplicate stable.
  const seen = new Set<string>();
  return conflicts.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  function numericBound(
    conds: ConditionOrAction[],
    ops: ("gt" | "gte" | "lt" | "lte")[]
  ): { op: string; value: number } | null {
    for (const c of conds) {
      if (!ops.includes(c.op as "gt" | "gte" | "lt" | "lte")) continue;
      const n = asNumber(c.value);
      if (n !== null) return { op: c.op, value: n };
    }
    return null;
  }
}

export const impossibleConditions: CheckFn = (ws, ctx) => {
  const findings: Finding[] = [];

  for (const rule of ws.rules) {
    if (ctx.scheduleLinkedRuleIds.has(rule.id)) continue;
    if (rule.conditions.length < 2) continue;
    const conflicts = findContradictions(rule);
    if (conflicts.length === 0) continue;
    const ruleRef: RuleRef = {
      id: rule.id,
      summary: findingRuleSummary(rule, ws.entityMaps),
    };
    findings.push(
      buildFinding("RULE_IMPOSSIBLE_CONDITIONS", [ruleRef], { conflicts })
    );
  }

  findings.sort((a, b) => {
    const aId = a.affected[0]?.id ?? "";
    const bId = b.affected[0]?.id ?? "";
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  return findings;
};

registerCheck(impossibleConditions);
