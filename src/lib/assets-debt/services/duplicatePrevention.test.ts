import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { HARNESS_MODES } from "../testing/transportHarness";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/** T133: end-to-end duplicate prevention on the fake, in both transport modes (SC-006 manual, SC-007, SC-007a, SC-009). */
describe.each(HARNESS_MODES)("duplicate prevention (%s)", (mode) => {
  it("no duplicate principal without a lender feed: exactly one liability row per repayment, reruns idempotent", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    await s.apply(split);
    const again = await s.preview({ from: "2024-02-01", to: "2024-02-29" });
    expect(byKind(again.postings, "repayment-split")).toHaveLength(0);
    expect(s.fake.accountRows(ACCOUNTS.mortgage)).toHaveLength(1);
  });

  it("no duplicate principal with a lender feed: the lender row is the counterpart, nothing is inserted (SC-007a)", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest", lenderFeed: true });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    if (split.output.kind !== "restructure") throw new Error("restructure");
    s.seedLenderRow("2024-02-01", -split.output.expectedPostState.children[0].amountMinor);
    await s.apply(split);
    const [link] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-link");
    await s.apply(link);
    expect(s.fake.accountRows(ACCOUNTS.mortgage)).toHaveLength(1);
    expect(byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-link")).toHaveLength(0);
  });

  it("combined payment: a split child claimed by one debt is not claimable by another (posting-linked exclusion)", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    const { posting } = await s.apply(split);
    const { listDebtTransactionLinks } = await import("@/lib/app-db/debtTransactionLinkRepository");
    const links = listDebtTransactionLinks(s.db, s.debtId).filter((l) => l.linkSource === "posting");
    expect(links).toEqual([expect.objectContaining({ role: "repayment", postingId: posting.id, actualTransactionId: posting.actualIds![1] })]);
    const { insertDebtTransactionLink } = await import("@/lib/app-db/debtTransactionLinkRepository");
    expect(() => insertDebtTransactionLink(s.db, { debtId: s.debtId, budgetSyncId: "budget-1", actualTransactionId: posting.actualIds![1], role: "repayment", periodKey: "2024-02-01", linkSource: "user" })).toThrow(/already claimed/);
  });

  it("no duplicate interest: the lender's charge before Bench's charge means Bench never posts (SC-009)", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "separate-interest", lenderFeed: true });
    s.seedLenderRow("2024-02-28", -387857);
    const result = await s.preview({ from: "2024-02-01", to: "2024-02-29" });
    expect(byKind(result.postings, "interest-charge")).toHaveLength(0);
    const [claim] = byKind(result.postings, "interest-link");
    await s.apply(claim);
    expect(s.fake.rows().filter((r) => typeof r.imported_id === "string" && (r.imported_id as string).startsWith("abdebt:"))).toHaveLength(0);
  });

  it("re-applying an applied period creates nothing new; a second preview proposes nothing", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const [charge] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge");
    await s.apply(charge);
    await expect(s.apply(charge)).rejects.toThrow(/cannot be applied/);
    expect(byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge")).toHaveLength(0);
    expect(s.fake.rows().filter((r) => r.imported_id === charge.idempotencyMarker)).toHaveLength(1);
  });
});
