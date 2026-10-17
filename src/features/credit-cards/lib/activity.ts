import { evidenceHash, financialFingerprint } from "./evidence";
import { bankToday } from "./cycles";
import { financingCostKind, isTrackingTransfer } from "./planTracking";
import { currentPlanLink } from "./plans";
import { recognizeActivity, type ClassificationKind } from "./recognition";
import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import { minorAmountSchema, type Card, type Workspace } from "./models";

export type ActivityRow = {
  id: string; accountId: string; date: string; amountMinor: number; label: string; notes: string | null;
  categoryId: string | null; categoryName: string | null;
  cleared: boolean | null; transferId: string | null; transferKnown: boolean;
  /** Stable financial compatibility; evidenceFingerprint also includes clearing/category/notes. */
  fingerprint: string; evidenceFingerprint?: string; parentId: string | null;
};
export type ActivitySnapshot = {
  accountId: string; from: string; to: string; rows: ActivityRow[]; counterparts: ActivityRow[];
  /** Directory metadata and independent account histories, never copied into workspace storage. */
  accounts?: { id: string; name: string; offBudget?: boolean; closed?: boolean }[];
  trackingAccounts?: { accountId: string; rows: ActivityRow[]; counterparts?: ActivityRow[]; issues: string[]; signedBalanceMinor?: number; to: string }[];
  futureDeltaMinor?: number;
  /** Integer minor units aligning Direct’s runtime-local date cutoff with the requested card date. */
  directBalanceAdjustmentMinor?: number;
  issues: string[]; fetchedAt: string; signature: string;
};
export type ActivityKind = ClassificationKind | "unclassified" | "ambiguous";

/** Parents count once through their children. Missing/mismatched structures block review. */
export function normalizeActivity(source: SyncSourceTransaction[]) {
  const rows: ActivityRow[] = [];
  const issues: string[] = [];
  const seen = new Map<string, string>();
  const add = (value: Omit<ActivityRow, "fingerprint" | "evidenceFingerprint">) => {
    if (!isIsoDate(value.date) || !minorAmountSchema.safeParse(value.amountMinor).success) { issues.push("A transaction has invalid dates or money units"); return; }
    const fingerprint = financialFingerprint(value);
    const evidenceFingerprint = evidenceHash([fingerprint, value.cleared, value.categoryId, value.transferId ? null : value.notes]);
    if (seen.has(value.id)) { if (seen.get(value.id) !== evidenceFingerprint) issues.push("Conflicting copies of a transaction require refresh"); return; }
    seen.set(value.id, evidenceFingerprint);
    rows.push({ ...value, fingerprint, evidenceFingerprint });
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
        notes: child.notes ?? row.notes, label: child.payeeName?.trim() || row.payeeName?.trim() || "-", categoryId: child.categoryId, categoryName: child.categoryName,
        cleared: child.cleared ?? null, transferId: child.transferId ?? null,
        transferKnown: child.transferId !== undefined, parentId: row.id,
      });
      }
    } else add({
      id: row.id, accountId: row.accountId, date: row.date, amountMinor: row.amount,
      notes: row.notes, label: row.payeeName?.trim() || "-", categoryId: row.categoryId, categoryName: row.categoryName,
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
  const nativeDate = bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const directBalanceAdjustmentMinor = transport.getSyncCapabilities().mode === "browser-api" ? minorAmountSchema.parse(Number(normalized.rows.filter((row) => row.accountId === accountId && row.date > (to < nativeDate ? to : nativeDate) && row.date <= (to > nativeDate ? to : nativeDate)).reduce((total, row) => total + BigInt(row.amountMinor) * BigInt(to < nativeDate ? -1 : 1), BigInt(0)))) : 0;
  const linksKnown = transport.canVerifyTransferLinks ? await transport.canVerifyTransferLinks({ accountId, sinceDate: from }) : transport.getSyncCapabilities().mode === "browser-api";
  const rows = normalized.rows.filter((row) => row.accountId === accountId && row.date >= from && row.date <= to).map((row) => linksKnown ? row : { ...row, transferKnown: false, fingerprint: financialFingerprint({ ...row, transferKnown: false }), evidenceFingerprint: evidenceHash([row.evidenceFingerprint, "transfer-field-unknown"]) });
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
  return { accountId, from, to, rows, counterparts, futureDeltaMinor, directBalanceAdjustmentMinor, issues, fetchedAt: new Date().toISOString(), signature: evidenceHash([rows.map((r) => r.evidenceFingerprint ?? r.fingerprint), counterparts.map((r) => r.evidenceFingerprint ?? r.fingerprint), futureDeltaMinor, issues]) };
}

/** An incoming card-side transfer is a repayment; peer reads only enrich its details. */
export function paymentEvidence(row: ActivityRow, snapshot: ActivitySnapshot, workspace?: Workspace) {
  if (isTrackingTransfer(row, snapshot, workspace) || workspace?.planLinks?.some((link) => link.transactionId === row.id && link.role === "conversion-credit")) return "not-payment" as const;
  const card = workspace?.cards.find((entry) => entry.accountId === row.accountId);
  if (row.accountId !== snapshot.accountId || row.amountMinor <= 0 || !row.transferId) return "not-payment" as const;
  if (card && workspace && activityKind(row, card, workspace, snapshot) !== "payment") return "not-payment" as const;
  return row.cleared === true ? "confirmed" as const : "provisional" as const;
}

export function activityKind(row: ActivityRow, card: Card, workspace: Workspace, snapshot: ActivitySnapshot): ActivityKind {
  const manual = workspace.classifications.find((entry) => entry.cardId === card.id && entry.transactionId === row.id && entry.fingerprint === row.fingerprint);
  if (manual) return manual.kind;
  const link = currentPlanLink(workspace, row);
  // Explicit principal relationships win over incidental words in transfer memos.
  if (link && ["conversion-credit", "instalment-billed", "combined-instalment", "principal-release", "adjustment"].includes(link.role)) return link.role === "conversion-credit" ? "plan-conversion" : ["principal-release", "adjustment"].includes(link.role) ? "plan-adjustment" : "plan-instalment";
  if (isTrackingTransfer(row, snapshot, workspace)) return row.amountMinor > 0 ? "plan-conversion" : "plan-instalment";
  if (row.transferId && row.amountMinor > 0 && !workspace.planLinks?.some((entry) => entry.transactionId === row.id)) return recognizeActivity(row, card).kind === "plan-conversion" ? "plan-conversion" : "payment";
  const cost = financingCostKind(row, card, workspace);
  if (cost) return row.amountMinor > 0 ? cost === "interest" ? "interest-refund" : "fee-refund" : cost;
  if (link) return link.role === "refund" ? "refund" : link.role === "conversion-credit" ? "plan-conversion" : link.role === "adjustment" || link.role === "principal-release" ? "plan-adjustment" : "plan-instalment";
  // A changed saved conversion must not silently become a cash payment.
  if (workspace.planLinks?.some((entry) => entry.transactionId === row.id && entry.role === "conversion-credit")) return "plan-conversion";
  const suggestion = recognizeActivity(row, card);
  if (row.transferId && row.amountMinor > 0) return suggestion.kind === "plan-conversion" ? "plan-conversion" : "payment";
  return suggestion.kind;
}

export function classificationReason(row: ActivityRow, card: Card, workspace: Workspace, snapshot: ActivitySnapshot) {
  const manual = workspace.classifications.find((entry) => entry.cardId === card.id && entry.transactionId === row.id && entry.fingerprint === row.fingerprint);
  if (manual) return `Your choice · ${manual.reason}`;
  if (currentPlanLink(workspace, row) || isTrackingTransfer(row, snapshot, workspace)) return "From linked plan activity";
  const suggestion = recognizeActivity(row, card);
  return `${suggestion.basis} · ${suggestion.reason}`;
}

/** Conversion offsets belong to their originating purchase, never an earlier statement's settlement. */
export function isSettlementCredit(row: ActivityRow, card: Card, workspace: Workspace, snapshot: ActivitySnapshot) {
  return row.amountMinor > 0 && !isTrackingTransfer(row, snapshot, workspace) && !workspace.planLinks?.some((link) => link.transactionId === row.id && link.role === "conversion-credit") && ["cashback", "refund", "other-credit", "interest-refund", "fee-refund", "dispute-credit", "adjustment"].includes(activityKind(row, card, workspace, snapshot));
}

/** Transfers between on-budget accounts have no expense category in Actual. */
export function activityCategoryLabel(row: ActivityRow, snapshot: ActivitySnapshot) {
  if (row.categoryName || row.categoryId) return row.categoryName ?? row.categoryId!;
  const peer = snapshot.counterparts.find((entry) => entry.id === row.transferId);
  const source = snapshot.accounts?.find((entry) => entry.id === row.accountId);
  const target = snapshot.accounts?.find((entry) => entry.id === peer?.accountId);
  return row.transferKnown && peer?.transferId === row.id && source && target && !source.offBudget && !target.offBudget ? "Transfer" : "Uncategorized";
}
