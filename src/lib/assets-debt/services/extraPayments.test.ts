import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { getDebtDetail } from "./debtConfigService";
import { recordExtraPayment, removeExtraPayment } from "./extraPaymentService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/** Extra payments found in Actual (owner decision 2026-10-05): list, record (link + event), remove. */
describe("payments into the loan that are not scheduled repayments", () => {
  const window = { from: "2024-02-01", to: "2024-02-29" };

  async function withExtra() {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    expect((await s.apply(split)).posting.status).toBe("applied");
    const extra = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-10", amount: 2_000_000, payee: s.fake.transferPayeeId(ACCOUNTS.checking), notes: "Extra" });
    return { s, extra };
  }

  it("lists the extra payment, not the repayment the applied split wrote", async () => {
    const { s, extra } = await withExtra();
    const { unscheduled } = await s.preview(window);
    expect(unscheduled).toEqual([expect.objectContaining({ id: extra, date: "2024-02-10", amountMinor: 2_000_000, recorded: false, inSchedule: false })]);
  });

  it("recording links it and adds the extra payment to Terms & Schedule; removing undoes both", async () => {
    const { s, extra } = await withExtra();
    const before = getDebtDetail(s.db, s.debtId)!.debt.currentRevision;
    const detail = recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 2_000_000 });
    expect(detail.debt.currentRevision).toBe(before + 1);
    expect(detail.assumptions).toEqual([expect.objectContaining({ assumptionKind: "extra-repayment", effectiveFrom: "2024-02-10", amountMinor: 2_000_000 })]);
    expect(listDebtTransactionLinks(s.db, s.debtId).filter((l) => l.role === "extra-repayment").map((l) => l.actualTransactionId)).toEqual([extra]);
    expect((await s.preview(window)).unscheduled).toEqual([expect.objectContaining({ id: extra, recorded: true, inSchedule: true })]);
    // Recording again is harmless: no second link, no second event.
    expect(recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 2_000_000 }).assumptions).toHaveLength(1);
    const removed = removeExtraPayment(s.db, s.debtId, extra);
    expect(removed.assumptions).toEqual([]);
    expect(listDebtTransactionLinks(s.db, s.debtId).filter((l) => l.role === "extra-repayment")).toEqual([]);
  });

  it("a recorded payment whose date or amount is changed in Actual moves the extra payment automatically on the next refresh", async () => {
    const { s, extra } = await withExtra();
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 2_000_000 });
    const revision = getDebtDetail(s.db, s.debtId)!.debt.currentRevision;
    // Moved a month earlier in Actual: outside the period shown, but followed because it is linked.
    s.fake.editInActual(extra, { date: "2024-01-10" });
    const moved = await s.preview(window);
    expect(moved.followedExtraPayments).toEqual([{ transactionId: extra, change: "moved", from: { date: "2024-02-10", amountMinor: 2_000_000 }, to: { date: "2024-01-10", amountMinor: 2_000_000 } }]);
    expect(moved.unscheduled).toEqual([expect.objectContaining({ id: extra, date: "2024-01-10", recorded: true, inSchedule: true, changed: false })]);
    const detail = getDebtDetail(s.db, s.debtId)!;
    expect(detail.debt.currentRevision).toBe(revision + 1);
    expect(detail.assumptions).toEqual([expect.objectContaining({ assumptionKind: "extra-repayment", effectiveFrom: "2024-01-10", amountMinor: 2_000_000 })]);
    expect(listDebtTransactionLinks(s.db, s.debtId).find((l) => l.role === "extra-repayment")?.periodKey).toBe("2024-01-10");
    // Nothing more to follow: a second refresh saves no new revision.
    expect((await s.preview(window)).followedExtraPayments).toEqual([]);
    expect(getDebtDetail(s.db, s.debtId)!.debt.currentRevision).toBe(revision + 1);
    // An amount change is followed the same way.
    s.fake.editInActual(extra, { amount: 2_500_000 });
    await s.preview(window);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([expect.objectContaining({ effectiveFrom: "2024-01-10", amountMinor: 2_500_000 })]);
    // Removing still finds the moved event.
    expect(removeExtraPayment(s.db, s.debtId, extra).assumptions).toEqual([]);
  });

  it("a recorded payment deleted in Actual is removed from Terms & Schedule with its link, judged only from the whole loan account", async () => {
    const { s, extra } = await withExtra();
    recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 2_000_000 });
    const loanAccountRows = async () => (await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.mortgage })).map((t) => ({ id: t.id, date: t.date, amountMinor: t.amount }));
    // Still there: nothing changes.
    expect((await s.preview(window, { loanAccountRows: await loanAccountRows() })).followedExtraPayments).toEqual([]);
    await s.transport.deleteTransactionForSync({ transactionId: extra });
    // Without the whole loan account, a missing row is not evidence of a deletion.
    expect((await s.preview(window)).followedExtraPayments).toEqual([]);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toHaveLength(1);
    const result = await s.preview(window, { loanAccountRows: await loanAccountRows() });
    expect(result.followedExtraPayments).toEqual([{ transactionId: extra, change: "removed", from: { date: "2024-02-10", amountMinor: 2_000_000 } }]);
    expect(getDebtDetail(s.db, s.debtId)!.assumptions).toEqual([]);
    expect(listDebtTransactionLinks(s.db, s.debtId).filter((l) => l.role === "extra-repayment")).toEqual([]);
    expect(result.unscheduled).toEqual([]);
  });

  it("refuses a non-positive amount", async () => {
    const { s, extra } = await withExtra();
    expect(() => recordExtraPayment(s.db, s.debtId, { actualTransactionId: extra, date: "2024-02-10", amountMinor: 0 })).toThrow(/positive/);
  });
});
