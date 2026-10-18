import { AppDbValidationError } from "./errors";
import type { ItemInput, StatementRowInput, UpdateSessionInput } from "./reconciliationRepository";

export function reconciliationObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppDbValidationError("Expected an object");
  return value as Record<string, unknown>;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) throw new AppDbValidationError("Expected transaction/statement ids");
  return value;
}

export function reconciliationItems(value: unknown): ItemInput[] {
  if (!Array.isArray(value)) throw new AppDbValidationError("Expected items");
  return value.map((entry) => {
    const row = reconciliationObject(entry);
    if (typeof row.id !== "string" || typeof row.disposition !== "string" ||
      !["matched", "create", "keep", "delete", "correct-amount", "unresolved", "ignored"].includes(row.disposition)) {
      throw new AppDbValidationError("Invalid reconciliation decision");
    }
    return { id: row.id, disposition: row.disposition,
      ...(row.statementRowIds !== undefined ? { statementRowIds: ids(row.statementRowIds) } : {}),
      ...(row.actualTransactionIds !== undefined ? { actualTransactionIds: ids(row.actualTransactionIds) } : {}),
      ...(row.reasonCode !== undefined ? { reasonCode: typeof row.reasonCode === "string" ? row.reasonCode : null } : {}),
      ...(row.match !== undefined ? { match: row.match } : {}),
      ...(row.guards !== undefined ? { guards: row.guards } : {}),
      ...(row.actualSnapshot !== undefined ? { actualSnapshot: row.actualSnapshot } : {}),
      ...(row.stagedChanges !== undefined ? { stagedChanges: row.stagedChanges } : {}),
    };
  });
}

export function reconciliationRows(value: unknown): StatementRowInput[] {
  if (!Array.isArray(value)) throw new AppDbValidationError("Expected statement rows");
  return value.map((entry) => {
    const row = reconciliationObject(entry);
    if (typeof row.id !== "string" || typeof row.postedDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.postedDate) || typeof row.amount !== "number" ||
      !Number.isSafeInteger(row.amount) || typeof row.importedPayee !== "string" ||
      typeof row.fingerprint !== "string" || !Number.isSafeInteger(row.sourceRowNumber)) {
      throw new AppDbValidationError("Invalid normalized statement row");
    }
    return { id: row.id, sourceRowNumber: row.sourceRowNumber as number,
      postedDate: row.postedDate, amount: row.amount, importedPayee: row.importedPayee,
      fingerprint: row.fingerprint, raw: row.raw ?? null,
      bankNotes: typeof row.bankNotes === "string" ? row.bankNotes : null,
      bankReference: typeof row.bankReference === "string" ? row.bankReference : null,
      externalId: typeof row.externalId === "string" ? row.externalId : null,
      transactionDate: typeof row.transactionDate === "string" ? row.transactionDate : null,
      originalAmount: typeof row.originalAmount === "number" ? row.originalAmount : null,
      originalCurrency: typeof row.originalCurrency === "string" ? row.originalCurrency : null };
  });
}

export function reconciliationPatch(value: unknown): UpdateSessionInput {
  const row = reconciliationObject(value);
  const allowed = new Set(["status", "statementFormat", "accountName", "profileId", "statementName", "tag",
    "statementStart", "statementEnd", "candidateStart", "candidateEnd", "statementFingerprint",
    "matchConfig", "totals", "applyResults", "applyConfig", "appliedAt"]);
  return Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key))) as UpdateSessionInput;
}
