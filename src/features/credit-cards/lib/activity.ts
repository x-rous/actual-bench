import { evidenceHash, financialFingerprint, identityHash } from "./evidence";
import { bankToday } from "./cycles";
import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import { minorAmountSchema } from "./models";

export type ActivityRow = {
  id: string;
  accountId: string;
  date: string;
  /** Signed integer minor units, Actual's sign (negative = charge on the card). */
  amountMinor: number;
  label: string;
  /** Actual's imported merchant text (imported_payee), when the transport exposes it. */
  importedPayee: string | null;
  notes: string | null;
  categoryId: string | null;
  categoryName: string | null;
  cleared: boolean | null;
  transferId: string | null;
  transferKnown: boolean;
  /** Full financial fingerprint: id, account, date, amount, transfer, parent (D20). */
  fingerprint: string;
  /** Narrow identity: account, amount sign, transfer, parent (D21). */
  identity: string;
  /** Fingerprint plus clearing, category and notes; detects any change in a read. */
  evidenceFingerprint: string;
  parentId: string | null;
};
export type ActivitySnapshot = {
  accountId: string;
  from: string;
  to: string;
  rows: ActivityRow[];
  counterparts: ActivityRow[];
  /** Directory metadata and independent account histories, never copied into workspace storage. */
  accounts?: { id: string; name: string; offBudget?: boolean; closed?: boolean }[];
  trackingAccounts?: {
    accountId: string;
    rows: ActivityRow[];
    counterparts?: ActivityRow[];
    issues: string[];
    /** Signed integer minor units. */
    signedBalanceMinor?: number;
    to: string;
  }[];
  /** Signed integer minor units of rows dated after `to`. */
  futureDeltaMinor?: number;
  /** Integer minor units aligning Direct's runtime-local date cutoff with the requested card date. */
  directBalanceAdjustmentMinor?: number;
  issues: string[];
  fetchedAt: string;
  signature: string;
};
type NormalizedRow = Omit<ActivityRow, "fingerprint" | "identity" | "evidenceFingerprint">;

const sumBigInt = (values: number[]) => values.reduce((sum, value) => sum + BigInt(value), BigInt(0));

/** Parents count once through their children. Missing/mismatched structures block review. */
export function normalizeActivity(source: SyncSourceTransaction[]) {
  const rows: ActivityRow[] = [];
  const issues: string[] = [];
  const seen = new Map<string, string>();
  const parents = new Set(source.filter((row) => row.isParent).map((row) => row.id));
  const add = (value: NormalizedRow) => {
    if (!isIsoDate(value.date) || !minorAmountSchema.safeParse(value.amountMinor).success) {
      issues.push("A transaction has invalid dates or money units");
      return;
    }
    const fingerprint = financialFingerprint(value);
    const evidenceFingerprint = evidenceHash([
      fingerprint,
      value.cleared,
      value.categoryId,
      value.transferId ? null : value.notes,
    ]);
    if (seen.has(value.id)) {
      if (seen.get(value.id) !== evidenceFingerprint) issues.push("Conflicting copies of a transaction require refresh");
      return;
    }
    seen.set(value.id, evidenceFingerprint);
    rows.push({ ...value, fingerprint, identity: identityHash(value), evidenceFingerprint });
  };
  for (const row of source) {
    if (row.isChild) {
      if (!row.parentId || !parents.has(row.parentId)) issues.push(`Split child ${row.id} has no parent`);
      continue;
    }
    if (!row.isParent) {
      add({
        id: row.id,
        accountId: row.accountId,
        date: row.date,
        amountMinor: row.amount,
        notes: row.notes,
        label: row.payeeName?.trim() || "-",
        importedPayee: row.importedPayee?.trim() || null,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        cleared: typeof row.cleared === "boolean" ? row.cleared : null,
        transferId: row.transferId ?? null,
        transferKnown: row.transferId !== undefined,
        parentId: row.parentId,
      });
      continue;
    }
    const validMoney = minorAmountSchema.safeParse(row.amount).success
      && row.splitLines.every((child) => minorAmountSchema.safeParse(child.amount).success);
    if (!validMoney) {
      issues.push("Split money is invalid");
      continue;
    }
    if (!row.splitLines.length || sumBigInt(row.splitLines.map((child) => child.amount)) !== BigInt(row.amount)) {
      issues.push(`Split transaction ${row.id} is incomplete`);
      continue;
    }
    for (const child of row.splitLines) {
      if (!child.id) {
        issues.push("A split child has no stable identity");
        continue;
      }
      add({
        id: child.id,
        accountId: row.accountId,
        date: row.date,
        amountMinor: child.amount,
        notes: child.notes ?? row.notes,
        label: child.payeeName?.trim() || row.payeeName?.trim() || "-",
        importedPayee: row.importedPayee?.trim() || null,
        categoryId: child.categoryId,
        categoryName: child.categoryName,
        cleared: child.cleared ?? null,
        transferId: child.transferId ?? null,
        transferKnown: child.transferId !== undefined,
        parentId: row.id,
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { rows, issues };
}

type ActivityTransport = Pick<
  ActualBenchTransport,
  "getSyncCapabilities" | "listTransactionsForSync" | "queryTransactionsForSync" | "canVerifyTransferLinks"
>;

/** Reads once per bounded window; transport implementations retain their own request queue. */
export async function readCardActivity(
  transport: ActivityTransport,
  accountId: string,
  from: string,
  to: string,
): Promise<ActivitySnapshot> {
  const capabilities = transport.getSyncCapabilities();
  if (!capabilities.capabilities.listTransactions || !capabilities.capabilities.readSplitLines) {
    throw new Error("This connection cannot read complete card activity");
  }
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new Error("Invalid activity window");
  const direct = capabilities.mode === "browser-api";
  // The transfer-link check is independent of the listing, so both reads run together.
  const links = transport.canVerifyTransferLinks
    ? transport.canVerifyTransferLinks({ accountId, sinceDate: from })
    : Promise.resolve(direct);
  links.catch(() => {});
  const normalized = normalizeActivity(await transport.listTransactionsForSync({ accountId, startDate: from }));
  const own = normalized.rows.filter((row) => row.accountId === accountId);
  const futureDeltaMinor = minorAmountSchema.parse(Number(sumBigInt(
    own.filter((row) => row.date > to).map((row) => row.amountMinor),
  )));
  // Direct balances cut off at the runtime's local date; align them to the card's requested date.
  const nativeDate = bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const early = to < nativeDate ? to : nativeDate;
  const late = to > nativeDate ? to : nativeDate;
  const direction = to < nativeDate ? -1 : 1;
  const directBalanceAdjustmentMinor = direct
    ? minorAmountSchema.parse(Number(sumBigInt(
      own.filter((row) => row.date > early && row.date <= late).map((row) => row.amountMinor * direction),
    )))
    : 0;
  const linksKnown = await links;
  const rows = own
    .filter((row) => row.date >= from && row.date <= to)
    .map((row) => linksKnown ? row : {
      ...row,
      transferKnown: false,
      fingerprint: financialFingerprint({ ...row, transferKnown: false }),
      evidenceFingerprint: evidenceHash([row.evidenceFingerprint, "transfer-field-unknown"]),
    });
  const ids = [...new Set(rows.flatMap((row) => row.transferId ? [row.transferId] : []))];
  const counterparts: ActivityRow[] = [];
  const issues = [...normalized.issues];
  if (ids.length && transport.queryTransactionsForSync) {
    // Sequential bounded batches avoid request explosions and preserve Direct's one-budget runtime.
    for (let offset = 0; offset < ids.length; offset += 200) {
      try {
        const batch = ids.slice(offset, offset + 200);
        const peers = normalizeActivity(await transport.queryTransactionsForSync({ ids: batch, resolveNames: false }));
        counterparts.push(...peers.rows);
      } catch {
        // Funding-side details are optional; card-side repayments remain usable.
        continue;
      }
    }
  }
  const signature = evidenceHash([
    rows.map((row) => row.evidenceFingerprint),
    counterparts.map((row) => row.evidenceFingerprint),
    futureDeltaMinor,
    issues,
  ]);
  return {
    accountId, from, to, rows, counterparts, futureDeltaMinor, directBalanceAdjustmentMinor, issues,
    fetchedAt: new Date().toISOString(),
    signature,
  };
}

/** Transfers between on-budget accounts have no expense category in Actual. */
export function activityCategoryLabel(row: ActivityRow, snapshot: ActivitySnapshot) {
  if (row.categoryName || row.categoryId) return row.categoryName ?? row.categoryId!;
  const peer = snapshot.counterparts.find((entry) => entry.id === row.transferId);
  const source = snapshot.accounts?.find((entry) => entry.id === row.accountId);
  const target = snapshot.accounts?.find((entry) => entry.id === peer?.accountId);
  const onBudgetTransfer = row.transferKnown && peer?.transferId === row.id && source && target
    && !source.offBudget && !target.offBudget;
  return onBudgetTransfer ? "Transfer" : "Uncategorized";
}
