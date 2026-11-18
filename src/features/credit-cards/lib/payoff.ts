import type { Card } from "./models";
import { minimumEstimate } from "./cycles";

/**
 * Cross-card payoff plan: one monthly amount paid across every card, minimums first, the rest to one
 * card at a time. Avalanche targets the highest APR (least interest); snowball targets the smallest
 * balance (quickest wins). All money is integer minor units; interest is monthly APR/12, half-up.
 */
export type PayoffStrategy = "avalanche" | "snowball";

export type PayoffDebt = {
  id: string;
  name: string;
  /** Owed today, minor units (positive). */
  balanceMinor: number;
  /** Purchase APR in basis points; null counts as 0 and is reported. */
  aprBps: number | null;
  card: Pick<Card, "minimumPercentBps" | "minimumFloorMinor">;
};

export type PayoffResult =
  | { feasible: false; reason: "below-minimums"; minimumsMinor: number }
  | { feasible: false; reason: "too-long"; months: number }
  | {
    feasible: true;
    months: number;
    interestMinor: number;
    /** Cards in the order they are paid off, with the month (1 = next month) each reaches zero. */
    order: { id: string; name: string; month: number; interestMinor: number }[];
  };

export const MAX_PAYOFF_MONTHS = 600;

function monthlyInterest(balanceMinor: number, aprBps: number | null) {
  if (!aprBps || balanceMinor <= 0) return 0;
  // balance × bps / 10000 / 12, half-up, in exact integer math.
  const numerator = BigInt(balanceMinor) * BigInt(aprBps);
  const denominator = BigInt(120_000);
  return Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));
}

const minimumOf = (debt: PayoffDebt, balanceMinor: number) =>
  Math.min(balanceMinor, minimumEstimate(debt.card as Card, balanceMinor) ?? 0);

function targetOrder(debts: PayoffDebt[], balances: Map<string, number>, strategy: PayoffStrategy) {
  return debts.filter((debt) => balances.get(debt.id)! > 0).sort((a, b) => {
    const apr = (b.aprBps ?? 0) - (a.aprBps ?? 0);
    const size = balances.get(a.id)! - balances.get(b.id)!;
    return strategy === "avalanche" ? apr || size || a.name.localeCompare(b.name) : size || apr || a.name.localeCompare(b.name);
  });
}

export function payoffPlan(debts: PayoffDebt[], monthlyMinor: number, strategy: PayoffStrategy): PayoffResult {
  const owing = debts.filter((debt) => debt.balanceMinor > 0);
  const balances = new Map(owing.map((debt) => [debt.id, debt.balanceMinor]));
  const interest = new Map(owing.map((debt) => [debt.id, 0]));
  const order: { id: string; name: string; month: number; interestMinor: number }[] = [];
  const firstMinimums = owing.reduce((sum, debt) => sum + minimumOf(debt, debt.balanceMinor + monthlyInterest(debt.balanceMinor, debt.aprBps)), 0);
  if (owing.length && firstMinimums > monthlyMinor) return { feasible: false, reason: "below-minimums", minimumsMinor: firstMinimums };
  let month = 0;
  while ([...balances.values()].some((value) => value > 0)) {
    month += 1;
    if (month > MAX_PAYOFF_MONTHS) return { feasible: false, reason: "too-long", months: MAX_PAYOFF_MONTHS };
    for (const debt of owing) {
      const balance = balances.get(debt.id)!;
      if (balance <= 0) continue;
      const charged = monthlyInterest(balance, debt.aprBps);
      balances.set(debt.id, balance + charged);
      interest.set(debt.id, interest.get(debt.id)! + charged);
    }
    let left = monthlyMinor;
    for (const debt of owing) {
      const balance = balances.get(debt.id)!;
      if (balance <= 0) continue;
      const paid = Math.min(left, minimumOf(debt, balance));
      balances.set(debt.id, balance - paid);
      left -= paid;
    }
    for (const debt of targetOrder(owing, balances, strategy)) {
      if (left <= 0) break;
      const paid = Math.min(left, balances.get(debt.id)!);
      balances.set(debt.id, balances.get(debt.id)! - paid);
      left -= paid;
    }
    for (const debt of owing) {
      if (balances.get(debt.id)! <= 0 && !order.some((entry) => entry.id === debt.id)) {
        order.push({ id: debt.id, name: debt.name, month, interestMinor: interest.get(debt.id)! });
      }
    }
    // Interest outgrows the payment: the balance never falls.
    if (month === 1 && left === 0 && owing.every((debt) => balances.get(debt.id)! >= debt.balanceMinor)) {
      return { feasible: false, reason: "too-long", months: MAX_PAYOFF_MONTHS };
    }
  }
  return { feasible: true, months: month, interestMinor: [...interest.values()].reduce((sum, value) => sum + value, 0), order };
}
