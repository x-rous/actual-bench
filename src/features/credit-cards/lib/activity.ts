import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import { minorAmountSchema, type Card, type Workspace } from "./models";

export type ActivityRow = {
  id: string; accountId: string; date: string; amountMinor: number; label: string; notes: string | null;
  categoryId: string | null; categoryName: string | null;
  cleared: boolean | null; transferId: string | null; transferKnown: boolean;
  fingerprint: string; parentId: string | null;
};
export type ActivitySnapshot = {
  accountId: string; from: string; to: string; rows: ActivityRow[]; counterparts: ActivityRow[];
  futureDeltaMinor?: number;
  issues: string[]; fetchedAt: string; signature: string;
};
export type ActivityKind = "cash-advance" | "purchase" | "interest" | "fee" | "refund" | "payment" | "other" | "ambiguous";

/** Parents count once through their children. Missing/mismatched structures block review. */
export function normalizeActivity(source: SyncSourceTransaction[]) {
  const rows: ActivityRow[] = [];
  const issues: string[] = [];
  const seen = new Map<string, string>();
  const add = (value: Omit<ActivityRow, "fingerprint">) => {
    if (!isIsoDate(value.date) || !minorAmountSchema.safeParse(value.amountMinor).success) { issues.push("A transaction has invalid dates or money units"); return; }
    const fingerprint = JSON.stringify([value.id, value.accountId, value.date, value.amountMinor, value.cleared, value.transferKnown, value.transferId, value.categoryId, value.parentId, value.transferId ? null : value.notes]);
    if (seen.has(value.id)) { if (seen.get(value.id) !== fingerprint) issues.push("Conflicting copies of a transaction require refresh"); return; }
    seen.set(value.id, fingerprint);
    rows.push({ ...value, fingerprint });
  };
  for (const row of source) {
    if (row.isChild) {
      if (!source.some((parent) => parent.id === row.parentId && parent.isParent)) issues.push(`Split child ${row.id} has no parent`);
      continue;
    }
    if (row.isParent) {
      if (!minorAmountSchema.safeParse(row.amount).success || row.splitLines.some((child) => !minorAmountSchema.safeParse(child.amount).success)) { issues.push("Split money is invalid"); continue; }
      const total = row.splitLines.reduce((sum, child) => sum + BigInt(child.amount), BigInt(0));
      if (!row.splitLines.length || total !== BigInt(row.amount)) { issues.push(`Split transaction ${row.id} is incomplete`); continue; }
      for (const child of row.splitLines) {
        if (!child.id) { issues.push("A split child has no stable identity"); continue; }
        add({
        id: child.id, accountId: row.accountId, date: row.date, amountMinor: child.amount,
        notes: child.notes ?? row.notes, label: child.payeeName ?? row.payeeName ?? "Split transaction", categoryId: child.categoryId, categoryName: child.categoryName,
        cleared: child.cleared ?? null, transferId: child.transferId ?? null,
        transferKnown: child.transferId !== undefined, parentId: row.id,
      });
      }
    } else add({
      id: row.id, accountId: row.accountId, date: row.date, amountMinor: row.amount,
      notes: row.notes, label: row.payeeName ?? "Transaction", categoryId: row.categoryId, categoryName: row.categoryName,
      cleared: typeof row.cleared === "boolean" ? row.cleared : null,
      transferId: row.transferId ?? null, transferKnown: row.transferId !== undefined, parentId: row.parentId,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { rows, issues };
}

type ActivityTransport = Pick<ActualBenchTransport, "getSyncCapabilities" | "listTransactionsForSync" | "queryTransactionsForSync" | "canVerifyTransferLinks">;
/** Reads once per bounded window; transport implementations retain their own request queue. */
export async function readCardActivity(transport: ActivityTransport, accountId: string, from: string, to: string): Promise<ActivitySnapshot> {
  const capabilities = transport.getSyncCapabilities().capabilities;
  if (!capabilities.listTransactions || !capabilities.readSplitLines) throw new Error("This connection cannot read complete card activity");
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new Error("Invalid activity window");
  const normalized = normalizeActivity(await transport.listTransactionsForSync({ accountId, startDate: from }));
  const futureDeltaMinor = minorAmountSchema.parse(Number(normalized.rows.filter((row) => row.accountId === accountId && row.date > to).reduce((sum, row) => sum + BigInt(row.amountMinor), BigInt(0))));
  const linksKnown = transport.canVerifyTransferLinks ? await transport.canVerifyTransferLinks({ accountId, sinceDate: from }) : transport.getSyncCapabilities().mode === "browser-api";
  const rows = normalized.rows.filter((row) => row.accountId === accountId && row.date >= from && row.date <= to).map((row) => linksKnown ? row : { ...row, transferKnown: false, fingerprint: JSON.stringify([row.fingerprint, "transfer-field-unknown"]) });
  const ids = [...new Set(rows.flatMap((row) => row.transferId ? [row.transferId] : []))];
  const counterparts: ActivityRow[] = [];
  const issues = [...normalized.issues];
  if (ids.length && transport.queryTransactionsForSync) {
    // Sequential bounded batches avoid request explosions and preserve Direct's one-budget runtime.
    for (let offset = 0; offset < ids.length; offset += 200) {
      try {
        const peers = normalizeActivity(await transport.queryTransactionsForSync({ ids: ids.slice(offset, offset + 200), resolveNames: false }));
        counterparts.push(...peers.rows);
      } catch {
        // Funding-side details are optional; card-side repayments remain usable.
        continue;
      }
    }
  }
  return { accountId, from, to, rows, counterparts, futureDeltaMinor, issues, fetchedAt: new Date().toISOString(), signature: JSON.stringify([rows.map((r) => r.fingerprint), counterparts.map((r) => r.fingerprint), futureDeltaMinor, issues]) };
}

/** An incoming card-side transfer is a repayment; peer reads only enrich its details. */
export function paymentEvidence(row: ActivityRow, snapshot: ActivitySnapshot) {
  if (row.accountId !== snapshot.accountId || row.amountMinor <= 0 || !row.transferId) return "not-payment" as const;
  return row.cleared === true ? "confirmed" as const : "provisional" as const;
}

export function activityKind(row: ActivityRow, card: Card, workspace: Workspace, snapshot: ActivitySnapshot): ActivityKind {
  if (row.accountId !== snapshot.accountId) return "other";
  if (row.transferId && row.amountMinor > 0) return "payment";
  const manual = workspace.classifications.find((entry) => entry.cardId === card.id && entry.transactionId === row.id && entry.fingerprint === row.fingerprint);
  if (manual) return manual.kind;
  if (row.transferId) return "other";
  if (row.amountMinor < 0 && row.categoryId && row.categoryId === card.interestCategoryId) return "interest";
  if (row.amountMinor < 0 && row.categoryId && row.categoryId === card.feeCategoryId) return "fee";
  if (!row.transferKnown && row.amountMinor > 0) return "ambiguous";
  if (row.amountMinor > 0) return "refund";
  // Merchant names/notes are never treated as proof of interest or fees.
  return row.amountMinor < 0 ? "purchase" : "other";
}
