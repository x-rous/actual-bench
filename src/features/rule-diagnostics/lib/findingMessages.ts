import type { Finding, FindingCode, RuleRef, Severity } from "../types";
import { discriminatorFor } from "./dismissals";

export const FINDING_SEVERITY: Record<FindingCode, Severity> = {
  RULE_MISSING_PAYEE: "error",
  RULE_MISSING_CATEGORY: "error",
  RULE_MISSING_ACCOUNT: "error",
  RULE_MISSING_CATEGORY_GROUP: "error",
  RULE_IMPOSSIBLE_CONDITIONS: "error",
  RULE_EMPTY_ACTIONS: "warning",
  RULE_NOOP_ACTIONS: "warning",
  RULE_SHADOWED: "warning",
  RULE_BROAD_MATCH: "warning",
  RULE_OVERSPECIFIC_IMPORT_MATCH: "warning",
  RULE_DUPLICATE_GROUP: "warning",
  RULE_UNSUPPORTED_CONDITION_OP: "warning",
  RULE_UNSUPPORTED_CONDITION_FIELD: "warning",
  RULE_UNSUPPORTED_ACTION_OP: "warning",
  RULE_UNSUPPORTED_ACTION_FIELD: "warning",
  RULE_TEMPLATE_ON_UNSUPPORTED_FIELD: "warning",
  RULE_NEAR_DUPLICATE_FAMILY: "info",
  RULE_ANALYZER_SKIPPED: "info",
};

type FindingArgs = Record<string, unknown>;

function asString(v: unknown): string {
  return v == null ? "" : String(v);
}

/** Single-source-of-truth factory for Finding objects. */
export function buildFinding(
  code: FindingCode,
  affected: RuleRef[],
  args: FindingArgs = {},
  counterpart?: RuleRef
): Finding {
  const severity = FINDING_SEVERITY[code];
  const { title, message, details } = composeMessage(code, args, affected, counterpart);
  // Computed here rather than at dismissal time so the key is derived from the
  // same args that produced the message — one place to change when a check
  // starts reporting something new.
  const discriminator = discriminatorFor(code, args);
  return {
    code,
    severity,
    title,
    message,
    ...(details && details.length > 0 ? { details } : {}),
    ...(discriminator ? { discriminator } : {}),
    affected,
    ...(counterpart ? { counterpart } : {}),
  };
}

function composeMessage(
  code: FindingCode,
  args: FindingArgs,
  affected: RuleRef[],
  counterpart?: RuleRef
): { title: string; message: string; details?: string[] } {
  switch (code) {
    case "RULE_MISSING_PAYEE":
      return {
        title: "Rule references a deleted payee",
        message: `This rule references a payee that no longer exists in the current working set, so it cannot match or apply correctly.`,
        details: detailList(args, "references"),
      };
    case "RULE_MISSING_CATEGORY":
      return {
        title: "Rule references a deleted category",
        message: `This rule references a category that no longer exists in the current working set.`,
        details: detailList(args, "references"),
      };
    case "RULE_MISSING_ACCOUNT":
      return {
        title: "Rule references a deleted account",
        message: `This rule references an account that no longer exists in the current working set.`,
        details: detailList(args, "references"),
      };
    case "RULE_MISSING_CATEGORY_GROUP":
      return {
        title: "Rule references a deleted category group",
        message: `This rule references a category group that no longer exists in the current working set.`,
        details: detailList(args, "references"),
      };
    case "RULE_EMPTY_ACTIONS":
      return {
        title: "Rule has no actions",
        message: `This rule matches transactions but performs no actions, so it never changes anything.`,
      };
    case "RULE_NOOP_ACTIONS":
      return {
        title: "Rule has only no-op actions",
        message: `Every action on this rule is a no-op: a \`set\` with no target field, or a notes append/prepend with an empty value.`,
        details: detailList(args, "noopActions"),
      };
    case "RULE_IMPOSSIBLE_CONDITIONS":
      return {
        title: "Conditions can never all match",
        message: `This \`and\`-combined rule has conditions that contradict each other, so no transaction can ever satisfy every condition at once.`,
        details: detailList(args, "conflicts"),
      };
    case "RULE_SHADOWED": {
      const shadower = counterpart?.summary ?? "an earlier rule";
      return {
        title: "Rule is shadowed by an earlier rule",
        message: `This rule never fires because an earlier rule in the same stage already matches every transaction this one would match and writes over the same fields. Shadowing rule: ${shadower}.`,
      };
    }
    case "RULE_BROAD_MATCH": {
      const field = asString(args.field) || "a text field";
      const value = asString(args.value);
      return {
        title: "Suspiciously broad match criteria",
        message: `This rule uses a very short match value on ${field} (${JSON.stringify(value)}), which is likely to match far more transactions than intended.`,
      };
    }
    case "RULE_DUPLICATE_GROUP": {
      const count = affected.length;
      const detail = `${count} rules in this group are structurally identical - same stage, condition operator, conditions, and actions.`;
      return {
        title: `${count} duplicate rules - consider merging`,
        message: `Use the Merge button to collapse them into one rule.`,
        details: [detail],
      };
    }
    case "RULE_NEAR_DUPLICATE_FAMILY": {
      const count = affected.length;
      const stage = asString(args.stage);
      const varying = typeof args.varying === "number" ? args.varying : undefined;
      const details: string[] = [];
      if (varying !== undefined) {
        details.push(
          varying === 1
            ? "One condition or action varies across the family; everything else is shared."
            : `${varying} conditions or actions vary across the family; everything else is shared.`
        );
      }
      return {
        title: `${count} near-identical rules`,
        message:
          `These ${count} rules in the \`${stage}\` stage differ from one another by only one or two ` +
          `parts. They are listed below; merging them is usually one rule with a wider condition.`,
        details: details.length > 0 ? details : undefined,
      };
    }
    case "RULE_UNSUPPORTED_CONDITION_OP": {
      const field = asString(args.field);
      const op = asString(args.op);
      return {
        title: "Unsupported condition operator",
        message: `The operator \`${op}\` is not valid for the condition field \`${field}\`. This rule may be ignored by the rule engine or produce unexpected results.`,
      };
    }
    case "RULE_UNSUPPORTED_CONDITION_FIELD": {
      const field = asString(args.field);
      return {
        title: "Unsupported condition field",
        message: `The condition field \`${field}\` is not recognized by the current rule engine catalog.`,
      };
    }
    case "RULE_OVERSPECIFIC_IMPORT_MATCH": {
      const field = asString(args.field);
      const stem = asString(args.stem);
      const count = Number(args.count) || 0;
      return {
        title: "Rule matches whole import strings",
        message:
          `This rule matches ${count} exact \`${field}\` strings, all of which contain "${stem}". ` +
          `Bank text usually carries a card number or a value date that changes every time, so the ` +
          `next import from this merchant will be a string that is not on the list and the rule will ` +
          `not apply. Actual writes rules in this shape when you accept its payee-rename prompt, and ` +
          `adds to the list each time rather than widening it. A condition of ` +
          `\`contains "${stem}"\` catches everything listed here and the ones still to come.`,
        details: detailList(args, "values"),
      };
    }
    case "RULE_UNSUPPORTED_ACTION_OP": {
      const op = asString(args.op);
      return {
        title: "Unsupported action operator",
        message: `The action operator \`${op}\` is not recognized by the current rule engine catalog.`,
      };
    }
    case "RULE_UNSUPPORTED_ACTION_FIELD": {
      const field = asString(args.field);
      return {
        title: "Unsupported action field",
        message: `The action field \`${field}\` is not recognized by the current rule engine catalog.`,
      };
    }
    case "RULE_TEMPLATE_ON_UNSUPPORTED_FIELD": {
      const field = asString(args.field);
      return {
        title: "Template mode on unsupported field",
        message: `Template (Handlebars) mode is enabled on an action field (\`${field}\`) that does not support templates.`,
      };
    }
    case "RULE_ANALYZER_SKIPPED": {
      const reason = asString(args.reason) || "The analyzer could not fully evaluate this rule.";
      return {
        title: "Analyzer skipped",
        message: reason,
        details: detailList(args, "detail"),
      };
    }
  }
}

function detailList(args: FindingArgs, key: string): string[] | undefined {
  const v = args[key];
  if (Array.isArray(v)) return v.map(asString).filter((s) => s.length > 0);
  if (typeof v === "string" && v.length > 0) return [v];
  return undefined;
}
