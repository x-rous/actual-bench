import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import { normalizeActivity, type ActivityRow } from "@/features/credit-cards/lib/activity";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import { bankToday } from "@/features/credit-cards/lib/cycles";
import { BOOK_TYPES, type Asset, type BookMetadata, type BookType } from "./models";
import { typeFromNotes } from "./tags";

/** Every monetary result here is signed integer minor units. */
export function sumMinor(values: number[]): number {
  const result = Number(values.reduce((sum, n) => {
    if (!Number.isSafeInteger(n)) throw new Error("Invalid ledger money units");
    return sum + BigInt(n);
  }, BigInt(0)));
  if (!Number.isSafeInteger(result)) throw new Error("Ledger total exceeds supported precision");
  return result;
}
export type BookSnapshot = {
  accountId: string; date: string; source: SyncSourceTransaction[]; rows: ActivityRow[];
  /** Signed integer minor units; null means incomplete/unavailable. */
  balanceMinor: number | null; issues: string[]; fetchedAt: string; transferKnown: boolean;
};
/** Full account read, never a per-asset window or a capped query. Balances independently check completeness. */
export async function readBook(transport: ActualBenchTransport, accountId: string, date: string): Promise<BookSnapshot> {
  if (!isIsoDate(date)) throw new Error("Invalid book date");
  const caps = transport.getSyncCapabilities().capabilities;
  if (!caps.listTransactions || !caps.readSplitLines) throw new Error("This connection cannot read a complete asset book");
  const source = await transport.listTransactionsForSync({ accountId });
  const normalized = normalizeActivity(source);
  const issues = [...normalized.issues];
  const all = normalized.rows.filter((r) => r.accountId === accountId);
  if (normalized.rows.length !== all.length) issues.push("The account read returned rows from another account");
  const rows = all.filter((r) => r.date <= date);
  // The API's entity balances are whole units. Convert once at this boundary.
  const balances = await transport.getAccountBalances();
  let whole = balances.get(accountId);
  // HTTP's grouped balance query omits an account with no rows. A successful
  // empty full read plus a saved directory entry proves that empty sum; a
  // missing balance for any nonempty ledger remains unavailable.
  if (whole === undefined && source.length === 0 && transport.mode === "http-api") {
    const directory = await transport.getAccounts();
    if (directory.some((a) => a.id === accountId)) whole = 0;
  }
  const nativeDate = bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone);
  let balanceMinor: number | null = null;
  if (whole === undefined || !Number.isFinite(whole)) issues.push("Actual account balance is unavailable");
  else {
    const nativeMinor = Math.round(whole * 100);
    if (!Number.isSafeInteger(nativeMinor) || Math.abs(whole * 100 - nativeMinor) > 0.001) issues.push("Invalid Actual account balance units");
    else {
      const nativeRows = transport.mode === "browser-api" ? all.filter((r) => r.date <= nativeDate) : all;
      if (sumMinor(nativeRows.map((r) => r.amountMinor)) !== nativeMinor) issues.push("Ledger rows do not reconcile to Actual; refresh or inspect incomplete data");
      if (!issues.length) balanceMinor = sumMinor(rows.map((r) => r.amountMinor));
    }
  }
  const transferKnown = transport.canVerifyTransferLinks ? await transport.canVerifyTransferLinks({ accountId, sinceDate: "0001-01-01" }) : transport.mode === "browser-api";
  return { accountId, date, source, rows, balanceMinor, issues, transferKnown, fetchedAt: new Date().toISOString() };
}
/** Extract complete hashtag tokens so a Unicode suffix cannot match a shorter asset tag. */
export function assetHashtags(notes: string): string[] {
  return [...new Set((notes.match(/(?<![\p{L}\p{N}_#])#[\p{L}\p{N}_-]+/gu) ?? []).filter((tag) => tag.startsWith("#asset_")))];
}
/**
 * The type Bench suggests for a row nobody has classified, from what Actual itself says about it: money moved in from another
 * account is capital put in, a typed positive value is an appreciation, a typed negative one a general adjustment, and
 * Actual's own "Starting Balance" row is the opening balance. Money moved out by transfer is ambiguous (a sale, a withdrawal,
 * a mistake), so it gets no suggestion. A suggestion is never saved and never written to Notes.
 */
export function suggestBookType(row: Pick<ActivityRow, "amountMinor" | "transferId" | "transferKnown" | "label">): BookType | null {
  if (row.label.trim().toLowerCase() === "starting balance" && row.amountMinor > 0) return "opening-balance";
  if (row.transferId) return row.amountMinor > 0 ? "acquisition" : null;
  if (!row.transferKnown) return null; // cannot tell a transfer from a typed value
  return row.amountMinor > 0 ? "revaluation" : row.amountMinor < 0 ? "other-adjustment" : null;
}
export type AttributedRow = ActivityRow & {
  assetId: string | null; reason: string | null;
  /** The saved type, or the suggested one while `suggested` is true; null is Unclassified. */ classification: string | null;
  suggested: boolean; runningMinor: number | null;
};
export function attributeBook(snapshot: BookSnapshot, assets: Asset[], metadata: BookMetadata[]) {
  const members = assets.filter((a) => a.actualAccountId === snapshot.accountId); // includes archived
  const dedicated = members.length === 1;
  const byTag = new Map(members.map((a) => [a.assetTag, a.id]));
  const maps = new Map(metadata.map((m) => [m.actualTransactionId, m]));
  const totals = new Map(members.map((a) => [a.id, 0]));
  let unassignedMinor = 0;
  const issues = [...snapshot.issues];
  const rows: AttributedRow[] = snapshot.rows.map((row) => {
    // A saved mapping for another account is stale (the row moved); it is ignored here and pruned on the next complete read.
    const saved = maps.get(row.id);
    const m = saved && saved.actualAccountId === row.accountId ? saved : undefined;
    let reason: string | null = null;
    let assetId: string | null = null;
    if (dedicated) assetId = members[0].id; // everything in a dedicated account is the asset's: Actual is the truth
    else {
      // Match complete hashtag tokens, including unknown asset tokens. Never read peer Notes.
      const tags = assetHashtags(row.notes ?? "");
      const tagged = tags.length === 1 ? byTag.get(tags[0]) : undefined;
      if (tags.length > 1 || (tags.length === 1 && !tagged)) reason = "Conflicting or unknown asset tags";
      else if (m?.assetId && (!members.some((a) => a.id === m.assetId) || (tagged && tagged !== m.assetId))) reason = "Tag and assignment conflict";
      else assetId = tagged ?? m?.assetId ?? null;
      if (!assetId && !reason) reason = "Unassigned";
    }
    if (assetId) totals.set(assetId, sumMinor([totals.get(assetId) ?? 0, row.amountMinor]));
    else unassignedMinor = sumMinor([unassignedMinor, row.amountMinor]);
    // A saved type this version no longer knows (one an older version wrote) is treated as none.
    const known = m?.classification && Object.hasOwn(BOOK_TYPES, m.classification) ? m.classification : null;
    const saved_ = known ?? typeFromNotes(row.notes);
    const suggestion = saved_ ? null : suggestBookType(row);
    return { ...row, assetId, reason, classification: saved_ ?? suggestion, suggested: !saved_ && !!suggestion, runningMinor: snapshot.balanceMinor === null || !assetId ? null : totals.get(assetId)! };
  });
  return { rows, totals, unassignedMinor, issues, available: snapshot.balanceMinor !== null };
}
