import type { ActivitySnapshot } from "../activity";
import { bankToday } from "../cycles";
import { asOfCardBalance, type cardBalance } from "../financialAdapter";
import type { Card } from "../models";

/**
 * The card's current Actual balance, as Credit Cards shows it: the live ledger balance with its future-entry
 * adjustment. Direct balances are only safe without the card's activity read when the card's day is the
 * runtime's day; otherwise the read must be usable (no failure, no issues). Undefined while unknown.
 */
export function currentCardBalance(
  card: Card, live: ReturnType<typeof cardBalance> | undefined, source: ActivitySnapshot | undefined, sourceFailed: boolean, direct: boolean,
) {
  const runtimeToday = bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const cutoffSafe = direct && bankToday(card.bankTimeZone) === runtimeToday;
  const sourceUsable = Boolean(source && !sourceFailed && !source.issues.length);
  if (!live || !(cutoffSafe || sourceUsable)) return undefined;
  return asOfCardBalance(live, source?.futureDeltaMinor, direct, source?.directBalanceAdjustmentMinor);
}
