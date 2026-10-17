import { createCreditCardStore } from "./memory";
import { cardInputSchema, type Card } from "./models";
import { normalizeActivity, readCardActivity, type ActivitySnapshot, type ActivityRow } from "./activity";
import { cycleDates, minimumEstimate, recentClosings } from "./cycles";
import { statementDrafts, statementReview, statementTags } from "./statements";
import { repaymentLedger, settlements } from "./repayments";
import { portfolio } from "./history";
import { getBudgetFileSyncCapabilities } from "@/lib/sync/capabilities";
import type { SyncSourceTransaction } from "@/lib/actual/transport";

const input = cardInputSchema.parse({ budgetSyncId: "budget", accountId: "card-account", nickname: "Visa", issuer: "Bank", last4: "4482", creditLimitMinor: 200000, purchaseAprBps: 1200, bankTimeZone: "UTC", status: "active", closingDay: 31, dueRule: { kind: "days-after-close", days: 21 }, minimumPercentBps: 250, minimumFloorMinor: 2500 });
const row = (id: string, date: string, amountMinor: number, extra: Partial<ActivityRow> = {}): ActivityRow => ({ id, date, amountMinor, accountId: "card-account", label: id, notes: null, cleared: true, transferKnown: true, transferId: null, categoryId: null, categoryName: null, parentId: null, fingerprint: `${id}-${date}-${amountMinor}`, ...extra });
const snapshot = (rows: ActivityRow[], extra: Partial<ActivitySnapshot> = {}): ActivitySnapshot => ({ accountId: "card-account", from: "2026-08-01", to: "2026-12-01", rows, counterparts: rows.filter((entry) => entry.transferId).map((entry) => row(entry.transferId!, entry.date, -entry.amountMinor, { accountId: "bank-account", transferId: entry.id })), issues: [], fetchedAt: "2026-12-01T00:00:00Z", signature: JSON.stringify(rows.map((entry) => entry.fingerprint)), ...extra });
function setup() {
  const store = createCreditCardStore();
  const card = store.getState().register(input);
  const first = store.getState().recordOpeningStatement("budget", card.id, 1, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-21", officialBalanceMinor: 10000, minimumDueMinor: 2000 });
  return { store, card: store.getState().workspaces.budget.cards[0], first };
}

it("clamps short months without losing the recurring day, and rolls due days forward", () => {
  const card = { ...input, id: "c", revision: 1 };
  expect(recentClosings(card, "2024-03-15", 3)).toEqual(["2024-02-29", "2024-01-31", "2023-12-31"]);
  expect(cycleDates(card, "2024-02-29")).toEqual({ periodStart: "2024-02-01", closingDate: "2024-02-29", dueDate: "2024-03-21" });
  expect(cycleDates({ ...card, dueRule: { kind: "day-of-month", day: 5 } }, "2024-02-29").dueDate).toBe("2024-03-05");
  expect(minimumEstimate(card, 10001)).toBe(2500);
  expect(minimumEstimate(card, 100)).toBe(100);
  expect(minimumEstimate({ ...card, minimumFloorMinor: 0 }, 10020)).toBe(251);
});

it("prepares bounded estimates by reversing subsequent Actual activity, never official bank facts", () => {
  const card = { ...input, id: "c", revision: 1 };
  const source = snapshot([row("spend", "2026-11-01", -5000), row("pay", "2026-11-04", 2000)], { to: "2026-11-10" });
  const drafts = statementDrafts(card, "2026-11-10", 3, source, -13000);
  expect(drafts[0]).toMatchObject({ closingDate: "2026-10-31", officialBalanceMinor: 10000, bankConfirmed: false });
  expect(statementDrafts(card, "2026-11-10", 6, { ...source, issues: ["missing split"] }, -13000)).toEqual([]);
});

it("counts split children once and refuses missing structural amounts", () => {
  const base = { id: "parent", accountId: "card-account", date: "2026-10-01", amount: -100, payeeId: null, payeeName: "Shop", categoryId: null, categoryName: null, notes: null, cleared: true, reconciled: false, importedId: null, transferId: null, isParent: true, isChild: false, parentId: null, splitLines: [{ id: "a", amount: -40, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null, cleared: true, transferId: null }, { id: "b", amount: -60, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null }] } satisfies SyncSourceTransaction;
  const result = normalizeActivity([base, { ...base, id: "a", amount: -40, isParent: false, isChild: true, parentId: "parent", splitLines: [] }]);
  expect(result.rows.map((entry) => entry.amountMinor)).toEqual([-40, -60]);
  expect(result.rows[1].cleared).toBeNull();
  expect(result.rows[0].label).toBe("Shop");
  expect(normalizeActivity([{ ...base, payeeName: null }]).rows.map((entry) => entry.label)).toEqual(["-", "-"]);
  expect(normalizeActivity([{ ...base, isParent: false, splitLines: [], payeeName: "  " }]).rows[0].label).toBe("-");
  expect(normalizeActivity([{ ...base, splitLines: [] }]).issues).toHaveLength(1);
});

it.each(["browser-api", "http-api"] as const)("reads bounded transactions with counterpart evidence through %s", async (mode) => {
  const sourceRow: SyncSourceTransaction = { id: "p", accountId: "card-account", date: "2026-10-10", amount: 1000, payeeId: null, payeeName: "Transfer", categoryId: null, categoryName: null, notes: null, cleared: true, reconciled: false, importedId: null, transferId: "peer", isParent: false, isChild: false, parentId: null, splitLines: [] };
  const list = jest.fn().mockResolvedValue([sourceRow]);
  const query = jest.fn().mockResolvedValue([{ ...sourceRow, id: "peer", accountId: "bank", amount: -1000, transferId: "p" }]);
  const source = await readCardActivity({ getSyncCapabilities: () => getBudgetFileSyncCapabilities({ mode }), listTransactionsForSync: list, queryTransactionsForSync: query, canVerifyTransferLinks: async () => true }, "card-account", "2026-10-01", "2026-10-31");
  expect(list).toHaveBeenCalledWith({ accountId: "card-account", startDate: "2026-10-01" });
  expect(query).toHaveBeenCalledWith({ ids: ["peer"], resolveNames: false });
  expect(source.counterparts[0].amountMinor).toBe(-1000);
});

it("capability gaps refuse reads, and absent transfer fields stay unknown", async () => {
  const list = jest.fn().mockResolvedValue([]);
  const unsupported = { ...getBudgetFileSyncCapabilities({ mode: "http-api" }), capabilities: { ...getBudgetFileSyncCapabilities({ mode: "http-api" }).capabilities, readSplitLines: false } };
  await expect(readCardActivity({ getSyncCapabilities: () => unsupported, listTransactionsForSync: list }, "card-account", "2026-10-01", "2026-10-31")).rejects.toThrow("complete card activity");
  expect(list).not.toHaveBeenCalled();
});

it("verifies only continuous official statements with balanced membership and reopens changed evidence", () => {
  const { store, card } = setup();
  const second = store.getState().recordStatement("budget", card.id, card.revision, { periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-21", officialBalanceMinor: 13000, minimumDueMinor: 2500 }, true);
  const source = snapshot([row("buy", "2026-10-10", -5000), row("payment", "2026-10-15", 2000, { transferId: "peer" })]);
  const review = statementReview(second, store.getState().workspaces.budget, source);
  expect(review.canVerify).toBe(true);
  store.getState().saveReview("budget", second.id, second.revision, source, review.memberships, true);
  const verified = store.getState().workspaces.budget.statements.find((entry) => entry.id === second.id)!;
  expect(verified.verification).toBe("verified");
  expect(statementReview(verified, store.getState().workspaces.budget, { ...source, signature: "changed" }).stale).toBe(false);
  const changed = { ...source, rows: [{ ...source.rows[0], fingerprint: "changed", amountMinor: -5500 }, source.rows[1]], signature: "changed" };
  expect(statementReview(verified, store.getState().workspaces.budget, changed).stale).toBe(true);
  expect(statementReview(verified, store.getState().workspaces.budget, changed).unresolved).toBe(1);
  expect(() => store.getState().saveReview("budget", second.id, verified.revision, changed, review.memberships, true)).toThrow("Activity changed");
});

it("equal totals with unresolved cutoff decisions cannot verify, and manual decisions are atomic", () => {
  const { store, card } = setup();
  const second = store.getState().recordStatement("budget", card.id, card.revision, { periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-21", officialBalanceMinor: 10000, minimumDueMinor: 2500 }, true);
  const source = snapshot([row("cutoff", "2026-10-31", -500)]);
  const review = statementReview(second, store.getState().workspaces.budget, source);
  expect(review.varianceMinor).toBe(0);
  expect(review.canVerify).toBe(false);
  const before = store.getState().workspaces;
  expect(() => store.getState().saveReview("budget", second.id, 1, source, review.memberships, true)).toThrow("resolve cutoff");
  expect(store.getState().workspaces).toBe(before);
  store.getState().saveReview("budget", second.id, 1, source, [{ ...review.memberships[0], decision: "excluded", provenance: "manual", reason: "Bank posted next cycle" }], true);
  expect(store.getState().workspaces.budget.statements[1].verification).toBe("verified");
});

it("partial and late transfers settle debt without rewriting missed due-date status; refunds are not minimum payments", () => {
  const { store, card, first } = setup();
  const source = snapshot([row("refund", "2026-10-05", 1000), row("p1", "2026-10-10", 1000, { transferId: "peer1" }), row("p2", "2026-10-25", 8000, { transferId: "peer2" })]);
  store.getState().classify("budget", card.id, card.revision, source, { cardId: card.id, transactionId: "refund", fingerprint: source.rows[0].fingerprint, kind: "refund", reason: "Confirmed refund" });
  const ledger = repaymentLedger(card, store.getState().workspaces.budget, source);
  expect(ledger.origins[0].remainingMinor).toBe(0);
  expect(ledger.confirmedMinor).toBe(9000);
  expect(settlements(card, store.getState().workspaces.budget, source, "2026-12-01")[0]).toMatchObject({ statementId: first.id, recordedDebtRemainingMinor: 0, recordedMinimumRemainingMinor: 0, minimumByDue: false, fullByDue: false, paidMinor: 9000, confirmedPaidMinor: 9000, confirmedCreditMinor: 1000, recordedTargetRemainingMinor: 1000, confirmedPaidDate: null });
});

it("pending transfers stay pending, peer absence does not hide incoming repayments, and outgoing transfers are separate", () => {
  const { store, card } = setup();
  const pending = snapshot([row("pending", "2026-10-10", 10000, { transferId: "peer", cleared: false })]);
  expect(repaymentLedger(card, store.getState().workspaces.budget, pending).provisionalMinor).toBe(10000);
  expect(settlements(card, store.getState().workspaces.budget, pending, "2026-12-01")[0]).toMatchObject({ recordedDebtRemainingMinor: 0, paidMinor: 10000, provisionalMinor: 10000, confirmedPaidMinor: 0 });
  const broken = { ...pending, rows: [{ ...pending.rows[0], cleared: true }], counterparts: [] };
  expect(repaymentLedger(card, store.getState().workspaces.budget, broken).confirmedMinor).toBe(10000);
  const reversed = snapshot([row("p", "2026-10-10", 10000, { transferId: "peer" }), row("reverse", "2026-10-11", -10000, { transferId: "reverse-peer" })]);
  expect(settlements(card, store.getState().workspaces.budget, reversed, "2026-12-01")[0].paidMinor).toBe(10000);
});

it("rolling statements do not double-count carried balances, and excess payment stays credit", () => {
  const { store, card } = setup();
  store.getState().recordStatement("budget", card.id, card.revision, { periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-21", officialBalanceMinor: 15000, minimumDueMinor: 2000 }, true);
  const source = snapshot([row("buy", "2026-10-05", -5000), row("p", "2026-11-05", 20000, { transferId: "peer" })]);
  const ledger = repaymentLedger(card, store.getState().workspaces.budget, source);
  expect(ledger.origins.reduce((sum, origin) => sum + origin.originalMinor, 0)).toBe(15000);
  expect(ledger.creditMinor).toBe(5000);
});

it("manual allocations are bounded, fingerprint-guarded, reversible and cannot confirm pending transfers", () => {
  const { store, card, first } = setup();
  const source = snapshot([row("p", "2026-10-10", 5000, { transferId: "peer" })]);
  const allocation = { cardId: card.id, transactionId: "p", originId: first.id, amountMinor: 5000, provenance: "manual", fingerprint: source.rows[0].fingerprint, reason: "Bank attribution" };
  expect(() => store.getState().allocate("budget", card.id, card.revision, source, "p", [{ ...allocation, amountMinor: 6000 }])).toThrow("exceeds");
  store.getState().allocate("budget", card.id, card.revision, source, "p", [allocation]);
  expect(store.getState().workspaces.budget.allocations).toHaveLength(1);
  store.getState().undo("budget");
  expect(store.getState().workspaces.budget.allocations).toHaveLength(0);
  expect(() => store.getState().updateCard("budget", card.id, card.revision, input)).toThrow("changed");
  const pending = { ...source, rows: [{ ...source.rows[0], cleared: false }] };
  expect(() => store.getState().allocate("budget", card.id, store.getState().workspaces.budget.cards[0].revision, pending, "p", [allocation])).toThrow("confirmed");
});

it("requires percentage coverage for weighted APR instead of inventing rates", () => {
  const card = { ...input, id: "c", revision: 1 } as Card;
  const result = portfolio([card, { ...card, id: "c2", accountId: "unknown", purchaseAprBps: null }], new Map([[card.accountId, { debtMinor: 10000, creditMinor: 0 }], ["unknown", { debtMinor: 30000, creditMinor: 0 }]]));
  expect(result).toMatchObject({ debtMinor: 40000, weightedAprBps: 1200, aprCoveredDebtMinor: 10000 });
});

it("keeps all models session-local with no persisted working-set adapter", () => {
  const { store } = setup();
  expect(createCreditCardStore().getState().workspaces).toEqual({});
  expect(store.getState().workspaces.budget).toHaveProperty("memberships");
});

it("future-dated ledger entries are removed before reconstructing a historical close", () => {
  const card = { ...input, id: "c", revision: 1 };
  const source = snapshot([row("post-close", "2026-11-04", -3000)], { to: "2026-11-10", futureDeltaMinor: -5000 });
  expect(statementDrafts(card, "2026-11-10", 1, source, -18000)[0].officialBalanceMinor).toBe(10000);
});

it("unrelated later activity does not invalidate a reviewed statement", () => {
  const { store, card } = setup();
  const statement = store.getState().recordStatement("budget", card.id, card.revision, { periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-21", officialBalanceMinor: 10000, minimumDueMinor: 2000 }, true);
  const source = snapshot([]);
  store.getState().saveReview("budget", statement.id, 1, source, [], true);
  const reviewed = store.getState().workspaces.budget.statements[1];
  const later = snapshot([row("new-spending", "2026-11-10", -5000)]);
  expect(statementReview(reviewed, store.getState().workspaces.budget, later).stale).toBe(false);
});

it("repayment dates ignore statement membership posting overrides", () => {
  const { store, card, first } = setup();
  const payment = row("p", "2026-10-22", 2000, { transferId: "peer" });
  const source = snapshot([payment]);
  const workspace = store.getState().workspaces.budget;
  const manual = { ...workspace, memberships: [{ statementId: first.id, cardId: card.id, transactionId: payment.id, fingerprint: payment.fingerprint, decision: "excluded" as const, provenance: "manual" as const, bankPostingDate: "2026-10-21", reason: "Bank posting confirmation" }] };
  expect(settlements(card, manual, source, "2026-12-01")[0].minimumByDue).toBe(false);
  expect(payment.date).toBe("2026-10-22");
});

it("overlapping statement periods and duplicate transaction membership are rejected atomically", () => {
  const { store, card, first } = setup();
  const before = store.getState().workspaces;
  expect(() => store.getState().recordStatement("budget", card.id, card.revision, { periodStart: "2026-09-15", closingDate: "2026-10-15", dueDate: "2026-11-05", officialBalanceMinor: 10000, minimumDueMinor: 2000 }, true)).toThrow("overlap");
  expect(store.getState().workspaces).toBe(before);
  const second = store.getState().recordStatement("budget", card.id, card.revision, { periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-21", officialBalanceMinor: 10000, minimumDueMinor: 2000 }, true);
  const source = snapshot([row("cutoff", "2026-10-01", -1000)]);
  const membership = { cardId: card.id, transactionId: "cutoff", fingerprint: source.rows[0].fingerprint, decision: "included" as const, provenance: "manual" as const, bankPostingDate: null, reason: "Bank confirmed" };
  store.getState().saveReview("budget", first.id, first.revision, source, [{ ...membership, statementId: first.id }], false);
  expect(() => store.getState().saveReview("budget", second.id, second.revision, source, [{ ...membership, statementId: second.id }], false)).toThrow("two statements");
});

it("refunds clearing the full balance do not silently waive an official minimum", () => {
  const { store, card } = setup();
  const source = snapshot([row("refund", "2026-10-10", 10000)]);
  const status = settlements(card, store.getState().workspaces.budget, source, "2026-12-01")[0];
  expect(status).toMatchObject({ recordedDebtRemainingMinor: 0, recordedMinimumRemainingMinor: 2000, minimumByDue: false, paidMinor: 0, confirmedPaidMinor: 0, confirmedCreditMinor: 10000, recordedTargetRemainingMinor: 10000 });
});

it("correcting earlier bank facts reopens later statements without changing source data", () => {
  const { store, card, first } = setup();
  const second = store.getState().recordStatement("budget", card.id, card.revision, { periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-21", officialBalanceMinor: 10000, minimumDueMinor: 2000 }, true);
  store.getState().saveReview("budget", second.id, 1, snapshot([]), [], true);
  store.getState().correctStatement("budget", first.id, 1, { periodStart: first.periodStart, closingDate: first.closingDate, dueDate: first.dueDate, officialBalanceMinor: 11000, minimumDueMinor: 2000 });
  const changed = store.getState().workspaces.budget.statements[1];
  expect(changed).toMatchObject({ verification: "needs-review", lifecycle: "recorded", reviewedSnapshot: null });
});

it("an exceptional bank close carries forward into the next cycle's start", () => {
  const { store, card, first } = setup();
  store.getState().correctStatement("budget", first.id, 1, { periodStart: first.periodStart, closingDate: "2026-10-01", dueDate: first.dueDate, officialBalanceMinor: 10000, minimumDueMinor: 2000 });
  const drafts = statementDrafts(card, "2026-11-10", 2, snapshot([]), -10000, store.getState().workspaces.budget.statements);
  expect(drafts[0].periodStart).toBe("2026-10-02");
});

it("explicit cash-advance classification distinguishes borrowing from unclassified outgoing transfers", () => {
  const { store, card } = setup();
  const transfer = row("advance", "2026-10-10", -5000, { transferId: "peer" });
  const source = snapshot([transfer]);
  expect(repaymentLedger(card, store.getState().workspaces.budget, source).issues).toContain("Outgoing borrowing transfer needs classification: advance");
  store.getState().classify("budget", card.id, card.revision, source, { cardId: card.id, transactionId: transfer.id, fingerprint: transfer.fingerprint, kind: "cash-advance", reason: "Bank cash advance confirmed" });
  const ledger = repaymentLedger(card, store.getState().workspaces.budget, source);
  expect(ledger.issues).toEqual([]);
  expect(ledger.origins.reduce((sum, origin) => sum + origin.remainingMinor, 0)).toBe(15000);
});

it("uses closing-month notes tags across cutoff dates, flags conflicting tags and retains manual decisions", () => {
  const { store, first } = setup();
  const workspace = store.getState().workspaces.budget;
  const tagged = row("tagged", "2026-10-05", -100, { notes: "Hotel #2026-09" });
  const other = row("other", "2026-09-15", -100, { notes: "#2026-10" });
  const conflict = row("conflict", "2026-09-16", -100, { notes: "#2026-09 #2026-10" });
  const result = statementReview(first, workspace, snapshot([tagged, other, conflict]));
  expect(result.memberships.map((entry) => [entry.transactionId, entry.decision])).toEqual([["tagged", "included"], ["other", "excluded"], ["conflict", "review"]]);
  const manual = { ...result.memberships[0], decision: "excluded" as const, provenance: "manual" as const, reason: "Bank excluded this purchase" };
  expect(statementReview(first, workspace, snapshot([tagged]), [manual]).memberships[0]).toEqual(manual);
  expect(statementReview(first, workspace, snapshot([{ ...tagged, fingerprint: "changed-notes" }]), [manual]).memberships[0].decision).toBe("review");
});

it("preserves financial decisions but refreshes review evidence when statement tags change", () => {
  const source: SyncSourceTransaction = { id: "notes", accountId: "card-account", date: "2026-09-10", amount: -100, payeeId: null, payeeName: "Shop", categoryId: null, categoryName: null, notes: "Receipt #2026-09", cleared: true, reconciled: false, importedId: null, transferId: null, isParent: false, isChild: false, parentId: null, splitLines: [] };
  const initial = normalizeActivity([source]).rows[0];
  expect(initial.notes).toBe(source.notes);
  const repayment = { ...source, amount: 100, transferId: "funding" };
  expect(normalizeActivity([repayment]).rows[0].fingerprint).toBe(normalizeActivity([{ ...repayment, notes: "#2026-10" }]).rows[0].fingerprint);
  expect(normalizeActivity([{ ...source, notes: "Receipt #2026-10" }]).rows[0].evidenceFingerprint).not.toBe(initial.evidenceFingerprint);
});

it("matches complete valid month tags only and deduplicates repeated tags", () => {
  expect(statementTags("#2026-09, receipt (#2026-09) #2026-10.")).toEqual(["2026-09", "2026-10"]);
  expect(statementTags("#2026-13 #2026-00 #2026-09-30 #2026-09extra word#2026-09")).toEqual([]);
});

it("assigns incoming transfers by date windows once, ignoring tags, missing peers, anchors and spending review", () => {
  const { store, card, first } = setup();
  const second = store.getState().recordStatement("budget", card.id, card.revision, { periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-21", officialBalanceMinor: 5000, minimumDueMinor: 500 }, true);
  const source = snapshot([
    row("part", "2026-10-10", 2000, { transferId: "peer1", notes: "#2026-11" }),
    row("late", "2026-10-25", 8000, { transferId: "peer2", notes: "#2026-09 #2026-08" }),
    row("boundary", "2026-10-31", 1000, { transferId: "peer3" }),
    row("next", "2026-11-01", 5000, { transferId: "peer4", notes: "#2026-09" }),
    row("pending-spend", "2026-10-12", -1000, { cleared: false }),
  ], { counterparts: [] });
  const workspace = { ...store.getState().workspaces.budget, statements: store.getState().workspaces.budget.statements.map((statement) => ({ ...statement, openingAnchor: false, verification: "needs-review" as const })) };
  const result = settlements(card, workspace, source, "2026-12-01");
  expect(result[0]).toMatchObject({ statementId: first.id, paidMinor: 11000, paidDate: "2026-10-25", delayDays: 4, recordedDebtRemainingMinor: 0, minimumByDue: true, fullByDue: false });
  expect(result[1]).toMatchObject({ statementId: second.id, paidMinor: 5000, paidDate: "2026-11-01", delayDays: 0, fullByDue: true });
  expect(result.reduce((sum, entry) => sum + entry.paidMinor, 0)).toBe(16000);
  const review = statementReview(second, workspace, source);
  expect(review.memberships.find((entry) => entry.transactionId === "part")?.decision).toBe("included");
  expect(review.rows.some((entry) => entry.id === "next")).toBe(true);
  expect(review.memberships.find((entry) => entry.transactionId === "next")?.decision).not.toBe("included");
});

it("a missing intervening statement does not absorb the next cycle's repayment", () => {
  const { store, card } = setup();
  const source = snapshot([row("later", "2026-11-05", 10000, { transferId: "peer", notes: "#2026-09" })]);
  expect(settlements(card, store.getState().workspaces.budget, source, "2026-12-01")[0]).toMatchObject({ paidMinor: 0, paymentWindowEnd: "2026-10-31", paidDate: null });
});

it("optional funding-detail failures do not fail card repayment reads", async () => {
  const source: SyncSourceTransaction = { id: "payment", accountId: "card-account", date: "2026-10-10", amount: 10000, payeeId: null, payeeName: "Checking", categoryId: null, categoryName: null, notes: "#2026-09", cleared: true, reconciled: false, importedId: null, transferId: "peer", isParent: false, isChild: false, parentId: null, splitLines: [] };
  const result = await readCardActivity({ getSyncCapabilities: () => getBudgetFileSyncCapabilities({ mode: "http-api" }), listTransactionsForSync: jest.fn().mockResolvedValue([source]), queryTransactionsForSync: jest.fn().mockRejectedValue(new Error("unavailable")), canVerifyTransferLinks: async () => true }, "card-account", "2026-10-01", "2026-10-31");
  expect(result.rows).toHaveLength(1);
  expect(result.counterparts).toEqual([]);
  expect(result.issues).toEqual([]);
});

it("keeps monthly payment windows correct for early closes and delayed month-end dates", () => {
  const { store, card, first } = setup();
  const workspace = store.getState().workspaces.budget;
  const source = snapshot([row("edge", "2026-10-31", 1000, { transferId: "peer1" }), row("next", "2026-11-01", 2000, { transferId: "peer2" })]);
  const delayed = { ...workspace, statements: [{ ...first, closingDate: "2026-10-01", dueDate: "2026-10-22" }] };
  expect(settlements(card, delayed, source, "2026-12-01")[0]).toMatchObject({ paymentWindowEnd: "2026-10-31", paidMinor: 1000 });
  const early = { ...workspace, statements: [{ ...first, closingDate: "2026-10-30", dueDate: "2026-11-21" }] };
  expect(settlements(card, early, source, "2026-12-01")[0]).toMatchObject({ paymentWindowEnd: "2026-11-30", paidMinor: 3000 });
});


it("counts uncleared transfers on an explicit holiday-adjusted due date, ignoring global due settings", () => {
  const { store, card, first } = setup();
  const statement = { ...first, closingDate: "2026-09-07", dueDate: "2026-10-02", periodStart: "2026-08-08" };
  const configured = { ...card, closingDay: 7, dueRule: { kind: "day-of-month" as const, day: 1 } };
  const workspace = { ...store.getState().workspaces.budget, statements: [statement] };
  const source = snapshot([row("holiday-payment", "2026-10-02", 10000, { cleared: false, transferId: "peer", notes: "#2026-11" })]);
  expect(settlements(configured, workspace, source, "2026-10-10")[0]).toMatchObject({ dueDate: "2026-10-02", paidMinor: 10000, confirmedPaidMinor: 0, provisionalMinor: 10000, paidDate: "2026-10-02", delayDays: 0, recordedDebtRemainingMinor: 0, recordedMinimumRemainingMinor: 0, fullByDue: null, debtCarriedAtDueMinor: null });
});

it("extends matching through an official due date beyond the next close without counting the payment twice", () => {
  const { store, card, first } = setup();
  const second = { ...first, id: "second", openingAnchor: false, periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-21" };
  const workspace = { ...store.getState().workspaces.budget, statements: [{ ...first, dueDate: "2026-11-02" }, second] };
  const source = snapshot([row("holiday", "2026-11-02", 10000, { transferId: "peer" })]);
  const result = settlements(card, workspace, source, "2026-12-01");
  expect(result[0]).toMatchObject({ paymentWindowEnd: "2026-11-02", paidMinor: 10000, paidDate: "2026-11-02", delayDays: 0 });
  expect(result[1].paidMinor).toBe(0);
});

it.each([-1000, 1000])("never uses month tags for a transfer with amount %s", (amount) => {
  const { store, first } = setup();
  const source = snapshot([row("transfer", "2026-10-10", amount, { transferId: "peer", notes: "#2026-09" })]);
  const result = statementReview(first, store.getState().workspaces.budget, source);
  expect(result.rows.some((entry) => entry.id === "transfer")).toBe(false);
});


it("requires clearing for confirmed minimum outcomes", () => {
  const { store, card } = setup();
  const workspace = store.getState().workspaces.budget;
  const pending = row("pending", "2026-10-10", 10000, { transferId: "peer", cleared: false });
  expect(settlements(card, workspace, snapshot([pending]), "2026-12-01")[0].minimumByDue).toBeNull();
  expect(settlements(card, workspace, snapshot([{ ...pending, cleared: true }]), "2026-12-01")[0].minimumByDue).toBe(true);
});

it("uses closing-month tags for draft billing balances while transfers always follow dates", () => {
  const card = { ...input, id: "c", revision: 1 };
  const source = snapshot([
    row("earlyOctober", "2026-09-29", -5000, { notes: "#2026-10" }),
    row("lateSeptember", "2026-10-01", -3000, { notes: "#2026-09" }),
    row("payment", "2026-10-02", 2000, { transferId: "funding", notes: "#2026-09" }),
    row("unclear", "2026-10-03", -1000, { notes: "#2026-09 #2026-10" }),
  ]);
  // Current debt: 70.00. September billing debt: 30.00; October: 70.00.
  const drafts = statementDrafts(card, "2026-11-10", 2, source, -7000);
  expect(drafts.map((draft) => [draft.closingDate, draft.officialBalanceMinor])).toEqual([["2026-10-31", 7000], ["2026-09-30", 3000]]);
  expect(drafts.every((draft) => !draft.bankConfirmed)).toBe(true);
  const outgoing = snapshot([row("outgoing", "2026-10-01", -4000, { transferId: "other", notes: "#2026-09" })]);
  expect(statementDrafts(card, "2026-11-10", 2, outgoing, -8000)[1].officialBalanceMinor).toBe(4000);
});
