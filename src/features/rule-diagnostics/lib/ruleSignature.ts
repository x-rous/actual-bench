import type { Rule, ConditionOrAction } from "@/types/entities";

/**
 * Canonical signatures for rules. Two rules that look the same to the user
 * (ignoring ordering and cosmetic differences) should produce identical
 * signatures; two rules that differ in any meaningful way should not.
 *
 * Used by:
 *   - duplicate detection (bucket by ruleSignature)
 *   - near-duplicate detection (partSignatures for symmetric-difference)
 *   - staleness detection (workingSetSignature)
 */

function normalizeValue(field: string | undefined, value: ConditionOrAction["value"]): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return [...value].map((v) => (v == null ? null : String(v))).sort();
  }
  if (typeof value === "object") {
    // AmountRange { num1, num2 } — preserve order; RecurConfig — stringify whole
    if ("num1" in value && "num2" in value) {
      return { num1: value.num1, num2: value.num2 };
    }
    return value;
  }
  if (field === "amount" && typeof value === "number") {
    return Math.round(value * 100) / 100;
  }
  return value;
}

export function partSignature(part: ConditionOrAction): string {
  return JSON.stringify({
    field: part.field ?? null,
    op: part.op,
    value: normalizeValue(part.field, part.value),
    options: part.options ?? null,
  });
}

function sortedPartSignatures(parts: ConditionOrAction[]): string[] {
  return parts.map(partSignature).sort();
}

export function conditionsSignature(rule: Rule): string {
  return sortedPartSignatures(rule.conditions).join("||");
}

export function actionsSignature(rule: Rule): string {
  return sortedPartSignatures(rule.actions).join("||");
}

export function ruleSignature(rule: Rule): string {
  return `${rule.stage}|${rule.conditionsOp}#${conditionsSignature(rule)}>>${actionsSignature(rule)}`;
}

/** Per-rule array of part signatures (conditions, then actions). */
export function rulePartSignatures(rule: Rule): string[] {
  return [...sortedPartSignatures(rule.conditions), ...sortedPartSignatures(rule.actions)];
}

/**
 * Signature for detecting whether the rule working set has changed since the
 * last diagnostics run. Includes each rule's full content signature so that
 * in-place edits to conditions or actions invalidate the cached report.
 */
export function workingSetSignature(rules: Rule[]): string {
  const parts = rules.map((r) => `${r.id}:${ruleSignature(r)}`).sort();
  return `n=${rules.length};${parts.join("|")}`;
}
