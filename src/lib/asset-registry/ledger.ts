import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import { normalizeActivity, type ActivityRow } from "@/features/credit-cards/lib/activity";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import { bankToday } from "@/features/credit-cards/lib/cycles";
import type { Asset, BookMetadata } from "./models";
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
export type AttributedRow = ActivityRow & { assetId: string | null; reason: string | null; classification: string | null; runningMinor: number | null };
export function attributeBook(snapshot: BookSnapshot, assets: Asset[], metadata: BookMetadata[]) {
  const members = assets.filter((a) => a.actualAccountId === snapshot.accountId); // includes archived
  const byTag = new Map(members.map((a) => [a.assetTag, a.id]));
  const maps = new Map(metadata.map((m) => [m.actualTransactionId, m]));
  const totals = new Map(members.map((a) => [a.id, 0]));
  let unassignedMinor = 0;
  const issues = [...snapshot.issues];
  const rows: AttributedRow[] = snapshot.rows.map((row) => {
    const m = maps.get(row.id);
    // Match complete hashtag tokens, including unknown asset tokens. Never read peer Notes.
    const tags = assetHashtags(row.notes ?? "");
    const tagged = tags.length === 1 ? byTag.get(tags[0]) : undefined;
    let reason: string | null = null;
    let assetId: string | null = null;
    if (m && m.actualAccountId !== row.accountId) reason = "Mapping account changed";
    else if (tags.length > 1 || (tags.length === 1 && !tagged)) reason = "Conflicting or unknown asset tags";
    else if (m?.assetId && (!members.some((a) => a.id === m.assetId) || (tagged && tagged !== m.assetId))) reason = "Tag and assignment conflict";
    else assetId = members.length === 1 ? members[0].id : tagged ?? m?.assetId ?? null;
    if (!assetId && !reason) reason = "Unassigned";
    if (assetId) totals.set(assetId, sumMinor([totals.get(assetId) ?? 0, row.amountMinor]));
    else unassignedMinor = sumMinor([unassignedMinor, row.amountMinor]);
    return { ...row, assetId, reason, classification: m?.classification ?? typeFromNotes(row.notes), runningMinor: snapshot.balanceMinor === null || !assetId ? null : totals.get(assetId)! };
  });
  const sourceIds = new Set(normalizeActivity(snapshot.source).rows.map((r) => r.id));
  for (const m of metadata.filter((m) => m.actualAccountId === snapshot.accountId)) {
    // A scheduled depreciation month has its own explicit "Actual row missing" state and deliberate repost; it must not block unrelated actions.
    if (!sourceIds.has(m.actualTransactionId) && !m.depreciationPeriod) issues.push(`Missing or moved transaction: ${m.actualTransactionId}`);
  }
  // A contradictory tag/map cannot establish the dedicated account invariant.
  // Keep the row Unassigned and suppress the asset value until it is reviewed.
  const dedicatedConflict = members.length === 1 && rows.some((row) => row.assetId === null);
  if (dedicatedConflict) issues.push("Dedicated account attribution conflicts require review");
  return { rows, totals, unassignedMinor, issues, available: snapshot.balanceMinor !== null && !dedicatedConflict };
}
