import type { ActivitySnapshot } from "../lib/activity";
import { bankToday } from "../lib/cycles";
import { deriveCardView } from "../lib/derive/cardView";
import { totalOwed } from "../lib/derive/planAccounts";
import { limitOn } from "../lib/derive/limits";
import type { Card, Workspace } from "../lib/models";
import type { CardBalance, CardEntry } from "./cardEntry";

/** Test support: one card entry exactly as the workspace builds it. Never imported by production code. */
export function cardEntry(card: Card, workspace: Workspace, snapshot: ActivitySnapshot | undefined, options: {
  today?: string;
  name?: string;
  fresh?: boolean;
  signedBalanceMinor?: number;
} = {}): CardEntry {
  const today = options.today ?? bankToday(card.bankTimeZone);
  const balance: CardBalance | undefined = options.signedBalanceMinor === undefined ? undefined : {
    rawSignedBalanceMinor: options.signedBalanceMinor,
    signedBalanceMinor: options.signedBalanceMinor,
    debtMinor: Math.max(0, -options.signedBalanceMinor),
    creditMinor: Math.max(0, options.signedBalanceMinor),
  };
  return {
    card,
    name: options.name ?? "Visa",
    today,
    snapshot,
    fresh: options.fresh ?? Boolean(snapshot),
    balance,
    limitMinor: limitOn(card, workspace, today),
    owed: snapshot && balance ? totalOwed(card, workspace, snapshot, balance.signedBalanceMinor, today) : undefined,
    view: deriveCardView({ card, workspace, snapshot, rawSignedBalanceMinor: balance?.rawSignedBalanceMinor, today }),
  };
}
