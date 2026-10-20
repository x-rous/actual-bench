import type { ActivitySnapshot } from "../lib/activity";
import type { CardView } from "../lib/derive/cardView";
import type { TotalOwed } from "../lib/derive/planAccounts";
import type { Card } from "../lib/models";

/** The card's Actual balance as of today, in signed integer minor units. */
export type CardBalance = { rawSignedBalanceMinor: number; signedBalanceMinor: number; debtMinor: number; creditMinor: number };

/** Everything one card's screens read, built once per render by the workspace. */
export type CardEntry = {
  card: Card;
  /** The Actual account name: the card's display name. */
  name: string;
  today: string;
  /** The last read; kept while a refresh runs, so figures never blank (UI-2). */
  snapshot: ActivitySnapshot | undefined;
  /** The read is current and complete: saving, verifying and linking are allowed. */
  fresh: boolean;
  balance: CardBalance | undefined;
  /** The credit limit in effect today (limit changes applied); null when none is set. */
  limitMinor: number | null;
  /** Total owed (§7.1 #1) with plan accounts; undefined without a balance or read. */
  owed: TotalOwed | undefined;
  view: CardView;
};
