/**
 * Typed API functions for the Rules entity.
 * Rule fields are already camelCase in the API — no snake_case conversion needed.
 */

import { apiRequest } from "./client";
import type { ConnectionInstance } from "@/store/connection";
import type { ApiRule, ApiListResponse, ApiSingleResponse } from "@/types/api";
import type { Rule, ConditionOrAction, AmountRange } from "@/types/entities";

// ─── Amount conversion ────────────────────────────────────────────────────────
//
// Actual Budget stores monetary amounts as integers with 2 implicit decimal
// places (e.g. $50.00 → 5000). Convert to/from human-readable values at the
// API boundary so the rest of the app always works in display units.

function amountFromInternal(value: ConditionOrAction["value"]): ConditionOrAction["value"] {
  if (typeof value === "number") return value / 100;
  if (typeof value === "object" && value !== null && "num1" in value) {
    const r = value as AmountRange;
    return { num1: r.num1 / 100, num2: r.num2 / 100 };
  }
  return value;
}

function normalizeAmountParts(parts: ConditionOrAction[]): ConditionOrAction[] {
  return parts.map((p) =>
    p.field === "amount" ? { ...p, value: amountFromInternal(p.value) } : p
  );
}

// ─── Stage conversion ─────────────────────────────────────────────────────────
//
// Actual stores the default stage as "" (empty string) in the database.
// The app uses "default" internally for consistency. Convert at the boundary.

import type { RuleStage } from "@/types/entities";

function stageFromApi(stage: string | null | undefined): RuleStage {
  return (stage as RuleStage) || "default";
}

function stageToApi(stage: RuleStage | null | undefined): string | null {
  return stage === "default" ? null : (stage ?? null);
}

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeRule(raw: ApiRule): Rule {
  return {
    id: raw.id!,
    stage: stageFromApi(raw.stage),
    conditionsOp: raw.conditionsOp ?? "and",
    conditions: normalizeAmountParts(raw.conditions ?? []),
    actions: raw.actions ?? [],
  };
}

// ─── API functions ────────────────────────────────────────────────────────────

export async function getRules(connection: ConnectionInstance): Promise<Rule[]> {
  const response = await apiRequest<ApiListResponse<ApiRule>>(connection, "/rules");
  return response.data.map(normalizeRule);
}

export async function createRule(
  connection: ConnectionInstance,
  input: Omit<Rule, "id">
): Promise<Rule> {
  const response = await apiRequest<ApiSingleResponse<ApiRule>>(connection, "/rules", {
    method: "POST",
    body: {
      rule: {
        stage: stageToApi(input.stage),
        conditionsOp: input.conditionsOp,
        conditions: input.conditions,
        actions: input.actions,
      },
    },
  });
  return normalizeRule(response.data);
}

export async function updateRule(
  connection: ConnectionInstance,
  id: string,
  patch: Partial<Omit<Rule, "id">>
): Promise<void> {
  await apiRequest<void>(connection, `/rules/${id}`, {
    method: "PATCH",
    body: {
      rule: {
        id,
        ...patch,
        ...(patch.stage !== undefined && { stage: stageToApi(patch.stage) }),
      },
    },
  });
}

export async function deleteRule(
  connection: ConnectionInstance,
  id: string  | { id: string }
): Promise<void> {
  const ruleId = typeof id === "string" ? id : id.id;
  await apiRequest<void>(connection, `/rules/${ruleId}`, { method: "DELETE" });
}
