import { z } from "zod";
import { idSchema, dateSchema, CASHFLOW_TYPES, BOOK_TYPES, type CashflowType } from "./models";
import type { ActivityRow } from "@/features/credit-cards/lib/activity";
import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import type { Account } from "@/types/entities";

const minor = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const contextSchema = z.object({ version: z.literal(1), data: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disposal"), representation: z.enum(["external-receipt", "asset-transfer", "write-off"]), carryingRemovedMinor: minor.refine((n) => n > 0), bookAdjustmentTransactionId: idSchema.nullable(), proceedsBasis: z.enum(["gross", "net"]).optional() }).strict().refine((v) => v.representation === "write-off" ? v.proceedsBasis === undefined : !!v.proceedsBasis, "Proceeds basis is required for a sale"),
  z.object({ kind: z.literal("selling-cost"), disposalTransactionId: idSchema }).strict(),
]) }).strict();
export const sourceEvidenceSchema = z.object({ id: idSchema, accountId: idSchema, date: dateSchema, amountMinor: minor, parentId: idSchema.nullable(), transferId: idSchema.nullable(), categoryId: idSchema.nullable(), notes: z.string().nullable() }).strict();
export const cashflowChangeSchema = z.object({
  role: z.enum(["book", "cashflow"]), actualTransactionId: idSchema, actualAccountId: idSchema, assetId: idSchema,
  classification: z.string().nullable(), revision: z.number().int().min(0), remove: z.boolean().optional(),
  capitalizedFromTransactionId: idSchema.nullable().optional(), context: contextSchema.nullable().optional(),
  /** `YYYY-MM` identity of a schedule-posted depreciation month. */ depreciationPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().optional(),
}).strict().refine((v) => v.classification === null || Object.hasOwn(v.role === "book" ? BOOK_TYPES : CASHFLOW_TYPES, v.classification), "Unknown transaction classification");
export const cashflowSaveSchema = z.object({ budgetSyncId: idSchema, changes: z.array(cashflowChangeSchema).min(1).max(500), sources: z.array(sourceEvidenceSchema).max(100000) }).strict();
export type CashflowChange = z.infer<typeof cashflowChangeSchema>;
export function sourceEvidence(rows: ActivityRow[]) {
  return rows.map(({ id, accountId, date, amountMinor, parentId, transferId, categoryId, notes }) => ({ id, accountId, date, amountMinor, parentId, transferId, categoryId, notes }));
}
export function cashflowChoices(amountMinor: number): CashflowType[] {
  return (Object.keys(CASHFLOW_TYPES) as CashflowType[]).filter((type) => type === "other-excluded" || (amountMinor > 0 ? ["rental-income", "dividends-distributions", "interest-yield", "other-income", "disposal-proceeds"].includes(type) : amountMinor < 0 && ["operating-expense", "taxes-insurance-service-charges", "financing-interest", "capital-expenditure"].includes(type)));
}
/** `accountIssues` scopes each read problem to its source account, so reporting is limited to assets linked to it. */
export type ExternalSnapshot = { rows: ActivityRow[]; issues: string[]; accountIssues?: Record<string, string[]>; accounts: Account[]; fetchedAt: string;
  /** The accounts whose rows were read; absent when every external account was read. */
  readAccountIds?: string[] };
/**
 * Complete reads of the named external accounts only (never the whole budget). Each account read has a fixed cost,
 * so the registry reads just the accounts that hold links, and an action reads just the accounts of the rows it
 * touches. `accountIds` omitted keeps the old read-everything behaviour for callers that truly need it.
 */
export async function readExternal(transport: ActualBenchTransport, bookAccountIds: string[], accountIds?: readonly string[]): Promise<ExternalSnapshot> {
  const accounts = await transport.getAccounts();
  const rows: ActivityRow[] = []; const issues: string[] = []; const accountIssues: Record<string, string[]> = {};
  const wanted = accountIds ? new Set(accountIds) : null;
  const targets = accounts.filter((a) => !bookAccountIds.includes(a.id) && (!wanted || wanted.has(a.id)));
  const readAccountIds = accountIds ? targets.map((a) => a.id) : undefined;
  if (targets.length === 0) return { rows, issues, accountIssues, accounts, fetchedAt: new Date().toISOString(), readAccountIds };
  const caps = transport.getSyncCapabilities().capabilities;
  if (!caps.listTransactions || !caps.readSplitLines) throw new Error("Complete cashflow reads are unsupported by this connection");
  for (const account of targets) {
    const local: string[] = [];
    try {
      const normalized = normalizeActivity(await transport.listTransactionsForSync({ accountId: account.id }));
      if (normalized.rows.some((row) => row.accountId !== account.id)) throw new Error("Account read included another account");
      const linksKnown = transport.canVerifyTransferLinks ? await transport.canVerifyTransferLinks({ accountId: account.id, sinceDate: "0001-01-01" }) : transport.mode === "browser-api";
      if (!linksKnown) local.push(`Transfer identities are unavailable for ${account.name}`);
      rows.push(...normalized.rows.map((row) => ({ ...row, transferKnown: row.transferKnown && linksKnown }))); local.push(...normalized.issues.map((issue) => `${account.name}: ${issue}`));
    } catch { local.push(`Could not read ${account.name}. Refresh before linking or posting.`); }
    if (local.length) { accountIssues[account.id] = local; issues.push(...local); }
  }
  return { rows, issues, accountIssues, accounts, fetchedAt: new Date().toISOString(), readAccountIds };
}
/** The external accounts the registry must read: those holding a linked cashflow or a capitalized-expense source. */
export const linkedExternalAccountIds = (registry: { cashflows?: { actualAccountId: string }[] }, bookAccountIds: string[]): string[] =>
  [...new Set((registry.cashflows ?? []).map((m) => m.actualAccountId))].filter((id) => !bookAccountIds.includes(id)).sort();
/** The account a transaction currently lives in (one tiny query), or null when it is gone. */
export async function accountOfTransaction(transport: ActualBenchTransport, transactionId: string): Promise<string | null> {
  const result = await transport.runQuery<{ data?: { account?: unknown }[] }>({ ActualQLquery: { table: "transactions", filter: { id: transactionId }, select: ["account"], limit: 1 } });
  const account = result.data?.[0]?.account;
  return typeof account === "string" ? account : null;
}
