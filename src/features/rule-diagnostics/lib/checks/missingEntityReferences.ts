import type { ConditionOrAction } from "@/types/entities";
import { CONDITION_FIELDS, ACTION_FIELDS } from "@/features/rules/utils/ruleFields";
import type { CheckFn, Finding, FindingCode, RuleRef, WorkingSet } from "../../types";
import { registerCheck } from "../runDiagnostics";
import { buildFinding } from "../findingMessages";
import { findingRuleSummary } from "../../utils/findingRuleSummary";

type EntityKind = "payee" | "category" | "account" | "categoryGroup";

const CODE_BY_ENTITY: Record<EntityKind, FindingCode> = {
  payee: "RULE_MISSING_PAYEE",
  category: "RULE_MISSING_CATEGORY",
  account: "RULE_MISSING_ACCOUNT",
  categoryGroup: "RULE_MISSING_CATEGORY_GROUP",
};

function entityForField(
  part: ConditionOrAction,
  catalog: typeof CONDITION_FIELDS | typeof ACTION_FIELDS
): EntityKind | null {
  const def = part.field ? catalog[part.field] : undefined;
  return (def?.entity as EntityKind | undefined) ?? null;
}

function collectIds(value: ConditionOrAction["value"]): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

function entityExists(ws: WorkingSet, kind: EntityKind, id: string): boolean {
  switch (kind) {
    case "payee":
      return ws.entityExists.payees.has(id);
    case "category":
      return ws.entityExists.categories.has(id);
    case "account":
      return ws.entityExists.accounts.has(id);
    case "categoryGroup":
      return ws.entityExists.categoryGroups.has(id);
  }
}

export const missingEntityReferences: CheckFn = (ws) => {
  const findings: Finding[] = [];

  for (const rule of ws.rules) {
    const ruleRef: RuleRef = {
      id: rule.id,
      summary: findingRuleSummary(rule, ws.entityMaps),
    };
    // Bucket missing IDs by entity kind so each rule produces at most one
    // finding per kind (not one per missing ID per part).
    const missing: Record<EntityKind, { field: string; id: string }[]> = {
      payee: [],
      category: [],
      account: [],
      categoryGroup: [],
    };

    for (const part of rule.conditions) {
      const kind = entityForField(part, CONDITION_FIELDS);
      if (!kind || !part.field) continue;
      for (const id of collectIds(part.value)) {
        if (!entityExists(ws, kind, id)) missing[kind].push({ field: part.field, id });
      }
    }
    for (const part of rule.actions) {
      const kind = entityForField(part, ACTION_FIELDS);
      if (!kind || !part.field) continue;
      for (const id of collectIds(part.value)) {
        if (!entityExists(ws, kind, id)) missing[kind].push({ field: part.field, id });
      }
    }

    for (const kind of Object.keys(missing) as EntityKind[]) {
      const refs = missing[kind];
      if (refs.length === 0) continue;
      const seen = new Set<string>();
      const references = refs
        .filter((r) => {
          const key = `${r.field}:${r.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((r) => `${r.field}: ${r.id}`);
      findings.push(
        buildFinding(CODE_BY_ENTITY[kind], [ruleRef], { references })
      );
    }
  }

  findings.sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const aId = a.affected[0]?.id ?? "";
    const bId = b.affected[0]?.id ?? "";
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  return findings;
};

registerCheck(missingEntityReferences);
