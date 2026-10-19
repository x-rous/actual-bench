import type { Account } from "@/types/entities";
import type { ActivitySnapshot } from "./activity";
import { asOfCardBalance, cardBalance } from "./financialAdapter";

type Balances = Map<string, ReturnType<typeof cardBalance>>;
type Attached = {
  accounts: Account[] | undefined; tracking: (ActivitySnapshot | undefined)[]; balances: Balances | undefined; direct: boolean; value: ActivitySnapshot;
};
const snapshots = new WeakMap<ActivitySnapshot, Attached>();

/** Reuse immutable read evidence across rerenders; unavailable tracking reads are omitted, never treated as zero. */
export function cardReadSnapshot(
  source: ActivitySnapshot, accounts: Account[] | undefined, tracking: (ActivitySnapshot | undefined)[], balances: Balances | undefined, direct: boolean,
): ActivitySnapshot {
  const previous = snapshots.get(source);
  const same = previous && previous.accounts === accounts && previous.balances === balances && previous.direct === direct
    && previous.tracking.length === tracking.length && tracking.every((entry, index) => entry === previous.tracking[index]);
  if (same) return previous.value;
  const value = { ...source, accounts, trackingAccounts: tracking.flatMap((data) => {
    const balance = data && balances?.get(data.accountId);
    return data ? [{ accountId: data.accountId, rows: data.rows, counterparts: data.counterparts, issues: data.issues, to: data.to,
      signedBalanceMinor: balance
        ? asOfCardBalance(balance, data.futureDeltaMinor, direct, data.directBalanceAdjustmentMinor).signedBalanceMinor : undefined }] : [];
  }) };
  snapshots.set(source, { accounts, tracking, balances, direct, value });
  return value;
}
