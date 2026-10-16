import { cardSchema, repaymentPlanSchema, statementSchema, type PlanLink, type Workspace } from "./models";
import type { ActivityRow, ActivitySnapshot } from "./activity";

/** A shared off-budget principal ledger; all monetary values are integer minor units. */
export function transferPlanScenario() {
  const cards = ["a", "b"].map((id) => cardSchema.parse({ id, budgetSyncId: "test", accountId: `card-${id}`, nickname: `RD098 CC ${id === "a" ? 5 : 6} - Transfer plan ${id}`, issuer: "", last4: "", revision: 1, creditLimitMinor: null, purchaseAprBps: null, status: "active", bankTimeZone: "UTC", closingDay: 8, firstTrackedStatementDate: "2026-06-08", dueRule: { kind: "day-of-month", day: 2 } }));
  const rows: ActivityRow[] = [], peers: ActivityRow[] = [], links: PlanLink[] = [];
  const add = (id: string, accountId: string, date: string, amountMinor: number, notes: string, transferId: string | null = null, cleared = true): ActivityRow => ({ id, accountId, date, amountMinor, notes, transferId, cleared, fingerprint: id, label: id, categoryId: null, categoryName: null, transferKnown: true, parentId: null });
  const transfer = (id: string, card: string, date: string, amount: number, tag: string, peerAccount = "tracking", cleared = true) => {
    rows.push(add(id, `card-${card}`, date, amount, tag, `${id}-peer`, cleared));
    peers.push(add(`${id}-peer`, peerAccount, date, -amount, tag, id, cleared));
  };
  for (const id of ["a", "b"]) {
    const principal = id === "a" ? 3000000 : 1200000, monthly = principal / 6;
    rows.push(add(`purchase-${id}`, `card-${id}`, "2026-06-10", -principal, `#plan-${id}`));
    transfer(`conversion-${id}`, id, "2026-06-10", principal, `#plan-${id}`);
    links.push({ planId: id, transactionId: `conversion-${id}`, fingerprint: `conversion-${id}`, role: "conversion-credit", instalment: null });
    for (const month of [7, 8, 9, 10]) {
      const posting = `instalment-${id}-${month}`;
      transfer(posting, id, `2026-${String(month).padStart(2, "0")}-08`, -monthly, `#plan-${id}`);
      links.push({ planId: id, transactionId: posting, fingerprint: posting, role: "instalment-billed", instalment: month - 6 });
    }
    for (const month of [8, 9, 10]) transfer(`cash-${id}-${month}`, id, `2026-${String(month).padStart(2, "0")}-02`, id === "a" ? month === 8 ? 505000 : month === 9 ? 200000 : 800000 : monthly, "Cash repayment", "funding");
  }
  rows.push(add("fee", "card-a", "2026-07-08", -5000, "#plan-a"));
  links.push({ planId: "a", transactionId: "fee", fingerprint: "fee", role: "plan-fee", instalment: null });
  rows.push(add("ordinary", "card-a", "2026-10-10", -50000, "Ordinary purchase"));
  transfer("pending", "a", "2026-10-15", 100000, "Cash repayment", "funding", false);
  const plans = cards.map((card) => repaymentPlanSchema.parse({ id: card.id, cardId: card.id, transactionId: `purchase-${card.id}`, fingerprint: `purchase-${card.id}`, revision: 1, arrangement: "fixed", status: "active", amountMinor: card.id === "a" ? 3000000 : 1200000, monthlyMinor: card.id === "a" ? 500000 : 200000, months: 6, aprBps: 0, startDate: "2026-06-10", firstDueDate: "2026-08-02", upfrontFeeMinor: card.id === "a" ? 5000 : 0, monthlyFeeMinor: 0, includesCosts: true, minimumPercentBps: null, minimumFloorMinor: null, expiryDate: null, afterAprBps: null, conditions: "", tracking: { accountId: "tracking", tag: `#plan-${card.id}` } }));
  const statements = cards.flatMap((card) => [0, card.id === "a" ? 505000 : 200000, card.id === "a" ? 500000 : 200000, card.id === "a" ? 800000 : 200000, card.id === "a" ? 500000 : 200000].map((officialBalanceMinor, index) => statementSchema.parse({ id: `s-${card.id}-${index}`, cardId: card.id, revision: 1, periodStart: `2026-${String(index + 5).padStart(2, "0")}-09`, closingDate: `2026-${String(index + 6).padStart(2, "0")}-08`, dueDate: `2026-${String(index + 7).padStart(2, "0")}-02`, officialBalanceMinor, minimumDueMinor: index ? 10000 : 0, openingBalanceMinor: index ? undefined : 0, lifecycle: "finalized", verification: "verified", coverage: "complete", openingAnchor: !index, bankConfirmed: true })));
  const trackingRows = peers.filter((row) => row.accountId === "tracking");
  const sources: ActivitySnapshot[] = cards.map((card) => ({ accountId: card.accountId, from: "2026-05-09", to: "2026-10-16", rows: rows.filter((row) => row.accountId === card.accountId), counterparts: peers, accounts: [{ id: "tracking", name: "RD098 Repayment Plans", offBudget: true }], trackingAccounts: [{ accountId: "tracking", rows: trackingRows, counterparts: rows, issues: [], to: "2026-10-16", signedBalanceMinor: -1400000 }], issues: [], futureDeltaMinor: 0, signature: "fixture", fetchedAt: "2026-10-16" }));
  const workspace: Workspace = { cards, plans, statements, planLinks: links, memberships: [], allocations: [], classifications: [] };
  return { cards, plans, sources, workspace };
}
