/**
 * Pure warning-message builders for delete / close impact dialogs.
 *
 * All warning copy lives here — never inline in components.
 * Used by both confirm dialogs (Steps B–G) and the UsageInspectorDrawer (Step H).
 *
 * Return type is string throughout — string satisfies React.ReactNode so these
 * are drop-in values for the ConfirmDialog `message` prop.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

function formatBalance(balance: number): string {
  const abs = Math.abs(balance);
  const sign = balance < 0 ? "-" : "";
  return `${sign}${abs.toFixed(2)}`;
}

// ─── Single-entity warnings ───────────────────────────────────────────────────

/**
 * Payee single delete.
 * Tiers: rules+tx → rules only → tx only → no refs.
 */
export function buildPayeeDeleteWarning(
  name: string,
  ruleCount: number,
  txCount: number | undefined,
  loading: boolean
): string {
  // txLine is only set when we have a definite non-zero count; loading is handled separately.
  const txLine = !loading && txCount && txCount > 0
    ? `${plural(txCount, "transaction")} will be unlinked — their payee will be cleared.`
    : null;

  if (ruleCount > 0 && txLine) {
    return `"${name}" is referenced by ${plural(ruleCount, "rule")} and used in ${plural(txCount!, "transaction")}. ${txLine}`;
  }
  if (ruleCount > 0) {
    return `"${name}" is referenced by ${plural(ruleCount, "rule")}. Deleting it may break those rules.${loading ? " Checking usage..." : ""}`;
  }
  if (txLine) {
    return `"${name}" is used in ${plural(txCount!, "transaction")}. ${txLine}`;
  }
  if (loading) {
    return `Delete "${name}"? Checking usage...`;
  }
  return `Delete "${name}"? It will be removed on Save.`;
}

/**
 * Payee bulk delete.
 */
export function buildPayeeBulkDeleteWarning(
  serverCount: number,
  newCount: number,
  skippedCount: number,
  ruleCount: number,
  txCount: number | undefined,
  loading: boolean
): string {
  const parts: string[] = [];

  parts.push(`${plural(serverCount, "payee")} will be staged for deletion and removed on Save.`);

  if (newCount > 0) {
    parts.push(`${plural(newCount, "unsaved new row")} will be discarded immediately.`);
  }
  if (skippedCount > 0) {
    parts.push(`${plural(skippedCount, "transfer payee")} skipped (system-managed).`);
  }
  if (ruleCount > 0) {
    parts.push(`Warning: ${plural(ruleCount, "rule reference")} will be affected.`);
  }
  if (loading) {
    parts.push("Checking usage...");
  } else if (txCount && txCount > 0) {
    parts.push(`${plural(txCount, "transaction")} will be unlinked (not deleted) — their payee will be cleared.`);
  }

  return parts.join(" ");
}

/**
 * Category single delete.
 * Tiers: rules+tx → rules only → tx only → no refs.
 */
export function buildCategoryDeleteWarning(
  name: string,
  ruleCount: number,
  txCount: number | undefined,
  loading: boolean
): string {
  // txLine is only set when we have a definite non-zero count; loading is handled separately.
  const txLine = !loading && txCount && txCount > 0
    ? `${plural(txCount, "transaction")} will be uncategorized.`
    : null;

  if (ruleCount > 0 && txLine) {
    return `"${name}" is referenced by ${plural(ruleCount, "rule")} and used in ${plural(txCount!, "transaction")}. ${txLine}`;
  }
  if (ruleCount > 0) {
    return `"${name}" is referenced by ${plural(ruleCount, "rule")}. Deleting it may break those rules.${loading ? " Checking usage..." : ""}`;
  }
  if (txLine) {
    return `"${name}" is used in ${plural(txCount!, "transaction")}. ${txLine}`;
  }
  if (loading) {
    return `Delete "${name}"? Checking usage...`;
  }
  return `Delete "${name}"? It will be removed on Save.`;
}

/**
 * Category group single delete.
 * Always includes child count. Appends rule/tx lines when relevant.
 */
export function buildCategoryGroupDeleteWarning(
  groupName: string,
  childCount: number,
  ruleCount: number,
  txCount: number | undefined,
  loading: boolean
): string {
  const header = `Delete group "${groupName}" and its ${plural(childCount, "category", "categories")}?`;
  const parts: string[] = [header];

  if (ruleCount > 0) {
    parts.push(`${plural(ruleCount, "rule")} ${ruleCount === 1 ? "references" : "reference"} these categories.`);
  }
  if (loading) {
    parts.push("Checking usage...");
  } else if (txCount && txCount > 0) {
    parts.push(`${plural(txCount, "transaction")} will be uncategorized.`);
  }

  return parts.join(" ");
}

/**
 * Category bulk delete.
 */
export function buildCategoryBulkDeleteWarning(
  serverCount: number,
  newCount: number,
  ruleCount: number,
  txCount: number | undefined,
  loading: boolean
): string {
  const parts: string[] = [];

  parts.push(`${plural(serverCount, "item")} will be staged for deletion and removed on Save.`);
  if (newCount > 0) {
    parts.push(`${plural(newCount, "unsaved new row")} will be discarded immediately.`);
  }
  parts.push("Deleting a group also deletes its categories.");
  if (ruleCount > 0) {
    parts.push(`Warning: ${plural(ruleCount, "rule")} reference the selected categories.`);
  }
  if (loading) {
    parts.push("Checking usage...");
  } else if (txCount && txCount > 0) {
    parts.push(`${plural(txCount, "transaction")} will be uncategorized.`);
  }

  return parts.join(" ");
}

/**
 * Account single close.
 * Three tiers based on balance and transaction count.
 */
export function buildAccountCloseWarning(
  name: string,
  balance: number,
  txCount: number | undefined,
  loading: boolean
): string {
  if (balance !== 0) {
    return (
      `"${name}" has an outstanding balance of ${formatBalance(balance)}. ` +
      `In Actual Budget, accounts with transactions can only be closed after transferring the balance. ` +
      `Staging this close may leave your budget inconsistent. Proceed only if you have handled the balance in Actual Budget directly.`
    );
  }

  if (loading) {
    return `Close "${name}"? Checking usage...`;
  }

  if (txCount && txCount > 0) {
    return `"${name}" has ${plural(txCount, "transaction")}. Closing it will hide it from your budget views.`;
  }

  return `Close "${name}"? It will be hidden from your budget.`;
}

/**
 * Account single delete.
 * Leads with balance warning if non-zero, then appends rule/tx counts.
 */
export function buildAccountDeleteWarning(
  name: string,
  balance: number,
  ruleCount: number,
  txCount: number | undefined,
  loading: boolean
): string {
  const parts: string[] = [];

  if (balance !== 0) {
    parts.push(
      `Warning: "${name}" has an outstanding balance of ${formatBalance(balance)}. ` +
      `Deleting it may cause inconsistencies — consider closing instead.`
    );
  }

  if (ruleCount > 0) {
    parts.push(`Referenced by ${plural(ruleCount, "rule")}.`);
  }

  if (loading) {
    parts.push("Checking usage...");
  } else if (txCount && txCount > 0) {
    parts.push(`Contains ${plural(txCount, "transaction")} — these will be permanently lost.`);
  }

  if (parts.length === 0) {
    return `Delete "${name}"? It will be removed on Save.`;
  }

  return parts.join(" ");
}

/**
 * Account bulk close.
 * No tx count needed — balance warning is sufficient for close flows.
 */
export function buildAccountBulkCloseWarning(
  count: number,
  nonZeroBalanceCount: number
): string {
  if (nonZeroBalanceCount > 0) {
    return (
      `Close ${plural(count, "account")}? ` +
      `${plural(nonZeroBalanceCount, "account")} ${nonZeroBalanceCount === 1 ? "has" : "have"} a non-zero balance — ` +
      `verify transfers are handled in Actual Budget before saving.`
    );
  }
  return `Close ${plural(count, "account")}? ${count === 1 ? "It" : "They"} will be hidden from your budget.`;
}

/**
 * Account bulk delete.
 */
export function buildAccountBulkDeleteWarning(
  serverCount: number,
  newCount: number,
  nonZeroBalanceCount: number,
  ruleCount: number,
  txCount: number | undefined,
  loading: boolean
): string {
  const parts: string[] = [];

  parts.push(`${plural(serverCount, "account")} will be staged for deletion and removed on Save.`);

  if (newCount > 0) {
    parts.push(`${plural(newCount, "unsaved new row")} will be discarded immediately.`);
  }
  if (nonZeroBalanceCount > 0) {
    parts.push(
      `Warning: ${plural(nonZeroBalanceCount, "account")} ${nonZeroBalanceCount === 1 ? "has" : "have"} a non-zero balance. ` +
      `Deleting accounts with outstanding balances may cause inconsistencies.`
    );
  }
  if (ruleCount > 0) {
    parts.push(`${plural(ruleCount, "rule")} will be affected.`);
  }
  if (loading) {
    parts.push("Checking usage...");
  } else if (txCount && txCount > 0) {
    parts.push(`${plural(txCount, "transaction")} will be permanently lost.`);
  }

  return parts.join(" ");
}

/**
 * Schedule single delete.
 */
export function buildScheduleDeleteWarning(
  name: string,
  ruleId: string | undefined,
  postsTransaction: boolean,
  txCount: number | undefined,
  loading: boolean
): string {
  const parts: string[] = [];
  const label = name || "This schedule";

  if (ruleId && postsTransaction) {
    parts.push(
      `"${label}" is linked to a rule and set to auto-post transactions.`
    );
  } else if (ruleId) {
    parts.push(`"${label}" is linked to a rule (the rule will not be deleted but will become unlinked).`);
  } else {
    parts.push(`Delete "${label}"?`);
  }

  if (loading) {
    parts.push("Checking usage...");
  } else if (txCount && txCount > 0) {
    parts.push(`${plural(txCount, "transaction")} will be unlinked.`);
  }

  if (parts.length === 1 && !ruleId) {
    return `${parts[0]} It will be removed on Save.`;
  }

  return parts.join(" ");
}

/**
 * Schedule bulk delete.
 */
export function buildScheduleBulkDeleteWarning(
  count: number,
  txCount: number | undefined,
  loading: boolean
): string {
  const parts: string[] = [
    `Delete ${plural(count, "schedule")}? Linked rules will remain but become unlinked.`,
  ];

  if (loading) {
    parts.push("Checking usage...");
  } else if (txCount && txCount > 0) {
    parts.push(`${plural(txCount, "transaction")} will be unlinked.`);
  }

  return parts.join(" ");
}

/**
 * Rule single delete (no tx counts — rules don't have transactions).
 */
export function buildRuleDeleteWarning(): string {
  return "Delete this rule? It will be removed on Save.";
}

/**
 * Rule bulk delete.
 */
export function buildRuleBulkDeleteWarning(count: number): string {
  return `Delete ${plural(count, "rule")}? This cannot be undone after Save.`;
}
