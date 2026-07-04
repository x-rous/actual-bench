/**
 * Deterministic plain-English explanation of an ActualQL inner query.
 *
 * No AI or network dependency — pure structural analysis of the query shape.
 * Returns an ordered list of sentences that describe what the query does.
 */

import type { ActualQLExpression, ActualQLQuery } from "../types";

export function explainQuery(query: ActualQLQuery): string[] {
  const lines: string[] = [];

  // Table
  lines.push(`Reads from the \`${query.table}\` table.`);

  // Filter
  if (query.filter && Object.keys(query.filter).length > 0) {
    lines.push(describeFilter(query.filter));
  }

  // Select
  if (query.select) {
    lines.push(describeSelect(query.select));
  }

  // groupBy
  const groupBy = toExpressionArray(query.groupBy);
  if (groupBy.length > 0) {
    const fields = groupBy.map(formatExpressionLabel).join(", ");
    lines.push(`Groups rows by ${fields}.`);
  }

  // calculate (scalar)
  if (query.calculate) {
    lines.push(describeCalculate(query.calculate));
  }

  // orderBy
  const orderBy = toExpressionArray(query.orderBy);
  if (orderBy.length > 0) {
    lines.push(describeOrderBy(orderBy));
  }

  // limit / offset
  if (typeof query.limit === "number") {
    lines.push(`Returns at most ${query.limit} row${query.limit !== 1 ? "s" : ""}.`);
  }
  if (typeof query.offset === "number" && query.offset > 0) {
    lines.push(`Skips the first ${query.offset} row${query.offset !== 1 ? "s" : ""} (offset).`);
  }

  // options.splits
  const splitMode =
    typeof query.options?.splits === "string" ? query.options.splits : undefined;
  if (splitMode) {
    const splitDesc: Record<string, string> = {
      inline: "shows sub-transactions individually",
      grouped: "groups sub-transactions under their parent",
      all: "returns both parent and sub-transactions",
    };
    const desc = splitDesc[splitMode] ?? splitMode;
    lines.push(`Split behavior is set to \`${splitMode}\` - ${desc}.`);
  }

  // Result type summary
  if (query.calculate) {
    lines.push("Returns a single calculated value, not a list of rows.");
  } else if (groupBy.length > 0) {
    lines.push("Returns one aggregated row per group.");
  } else {
    lines.push("Returns a list of rows.");
  }

  return lines;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toExpressionArray(
  value: ActualQLExpression | ActualQLExpression[] | undefined
): ActualQLExpression[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function formatExpressionLabel(value: ActualQLExpression): string {
  return `\`${typeof value === "string" ? value : JSON.stringify(value)}\``;
}

function describeFilter(filter: Record<string, unknown> | Array<Record<string, unknown>>): string {
  if (Array.isArray(filter)) {
    if (filter.length === 0) return "No effective filter conditions.";
    return `Applies ${filter.length} filter condition${filter.length !== 1 ? "s" : ""}.`;
  }

  // Compound operators
  if ("$and" in filter && Array.isArray(filter["$and"])) {
    return `Filters rows where ALL of ${filter["$and"].length} conditions match ($and).`;
  }
  if ("$or" in filter && Array.isArray(filter["$or"])) {
    return `Filters rows where ANY of ${filter["$or"].length} conditions match ($or).`;
  }

  const parts: string[] = [];
  for (const [field, condition] of Object.entries(filter)) {
    if (condition === null) {
      parts.push(`\`${field}\` is null`);
      continue;
    }
    if (typeof condition !== "object" || Array.isArray(condition)) {
      parts.push(`\`${field}\` = ${JSON.stringify(condition)}`);
      continue;
    }
    const ops = condition as Record<string, unknown>;
    if ("$oneof" in ops) {
      const arr = ops["$oneof"];
      const count = Array.isArray(arr) ? arr.length : "?";
      parts.push(`\`${field}\` is one of ${count} value${count !== 1 ? "s" : ""}`);
    } else if ("$gte" in ops && "$lte" in ops) {
      parts.push(`\`${field}\` between ${String(ops["$gte"])} and ${String(ops["$lte"])}`);
    } else if ("$gte" in ops) {
      parts.push(`\`${field}\` ≥ ${String(ops["$gte"])}`);
    } else if ("$lte" in ops) {
      parts.push(`\`${field}\` ≤ ${String(ops["$lte"])}`);
    } else if ("$like" in ops) {
      parts.push(`\`${field}\` matches pattern ${JSON.stringify(ops["$like"])}`);
    } else {
      const opKeys = Object.keys(ops).join(", ");
      parts.push(`\`${field}\` filtered by ${opKeys}`);
    }
  }

  if (parts.length === 0) return "No effective filter conditions.";
  if (parts.length === 1) return `Filters where ${parts[0]}.`;
  return `Filters where ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;
}

function describeSelect(
  select: "*" | ActualQLExpression | ActualQLExpression[]
): string {
  if (select === "*") return "Selects all fields.";
  if (!Array.isArray(select)) {
    return typeof select === "string"
      ? `Selects field \`${select}\`.`
      : "Selects fields using an object expression.";
  }

  const simple: string[] = [];
  const aggregates: string[] = [];

  for (const item of select) {
    if (typeof item === "string") {
      simple.push(`\`${item}\``);
    } else if (typeof item === "object" && item !== null) {
      for (const [alias, expr] of Object.entries(item)) {
        if (typeof expr === "object" && expr !== null) {
          const fn = Object.keys(expr as object)[0];
          aggregates.push(`\`${alias}\` (${fn})`);
        } else {
          aggregates.push(`\`${alias}\``);
        }
      }
    }
  }

  const parts: string[] = [];
  if (simple.length > 0) {
    parts.push(`fields ${simple.join(", ")}`);
  }
  if (aggregates.length > 0) {
    parts.push(`aggregates ${aggregates.join(", ")}`);
  }

  return `Selects ${parts.join(" and ")}.`;
}

function describeCalculate(calculate: ActualQLExpression): string {
  if (typeof calculate === "string") {
    return `Computes a scalar from \`${calculate}\`.`;
  }

  const fn = Object.keys(calculate)[0];
  const operand = calculate[fn];
  const operandStr =
    typeof operand === "string" ? operand : JSON.stringify(operand);

  const fnNames: Record<string, string> = {
    $count: "counts",
    $sum: "sums",
    $avg: "averages",
    $min: "finds the minimum of",
    $max: "finds the maximum of",
  };

  const desc = fnNames[fn] ?? `computes ${fn} of`;
  return `Computes a scalar - ${desc} \`${operandStr}\` across matching rows.`;
}

function describeOrderBy(orderBy: ActualQLExpression[]): string {
  const parts: string[] = [];
  for (const item of orderBy) {
    if (typeof item === "string") {
      parts.push(`\`${item}\` (asc)`);
    } else if (typeof item === "object" && item !== null) {
      for (const [field, dir] of Object.entries(item)) {
        parts.push(`\`${field}\` (${dir})`);
      }
    }
  }
  return `Orders results by ${parts.join(", ")}.`;
}
