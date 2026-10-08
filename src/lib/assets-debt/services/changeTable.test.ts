import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import type { PreviewDirectory } from "@/features/assets-debt/components/preview/renderPreviewRows";
import { buildTransformTable } from "@/features/assets-debt/components/preview/transformRows";
import { changeContext, changeHeadline } from "@/features/assets-debt/components/workspace/changeText";
import { ACCOUNTS, CATEGORIES, LENDER, byKind, createScenario, type Scenario } from "../testing/postingScenario";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/**
 * The expanded row's one table and words (§3.6 rev 2) on real planner outputs for every shape:
 * each row of Actual now, what it becomes, and the one line of context.
 */
const window = { from: "2024-02-01", to: "2024-02-29" };
const directoryOf = (s: Scenario): PreviewDirectory => ({
  accounts: s.directory.accounts,
  categories: s.directory.categories,
  payeeNames: { [LENDER]: "Home Lender" },
  transferAccountByPayee: Object.fromEntries(Object.entries(s.transferPayees).map(([account, payee]) => [payee, account])),
});
const shape = (s: Scenario, output: Parameters<typeof buildTransformTable>[0]) => buildTransformTable(output, directoryOf(s), 2).rows.map((r) => [r.sub ? "  part" : r.accountName ? "row" : "", r.nowMinor, r.afterMinor, r.tag]);

describe("one now-to-after table and its words, every shape", () => {
  it("a payment that is already a transfer: split, the loan-side row replaced; its Undo puts one transfer back and re-creates the row", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", repaymentAnyPayee: true });
    const payment = s.seedPayment("2024-02-01", -242915, { category: CATEGORIES.loan });
    s.fake.editInActual(payment, { payee: s.transferPayees[ACCOUNTS.mortgage] });
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    if (split.output.kind !== "restructure") throw new Error("restructure");
    const [principal, interest] = split.output.expectedPostState.children;
    expect(shape(s, split.output)).toEqual([
      ["row", -242915, -242915, "Becomes a split"],
      ["  part", null, principal.amountMinor, "New part"],
      ["  part", null, interest.amountMinor, "New part"],
      ["row", 242915, -principal.amountMinor, "Replaced"],
    ]);
    expect(buildTransformTable(split.output, directoryOf(s), 2).technical).toMatch(/new transaction id/);
    expect(changeHeadline(split, directoryOf(s), 2)).toMatch(/^Split into Principal [\d,.]+ \+ Interest [\d,.]+$/);
    expect(changeContext(split)).toEqual({ tone: "neutral", text: expect.stringMatching(/^Currently a full transfer/) });

    const applied = (await s.apply(split)).posting;
    const undo = s.undo(applied);
    expect(shape(s, undo.output)).toEqual([
      ["row", -242915, -242915, "Back to one row"],
      ["  part", principal.amountMinor, null, "Removed"],
      ["  part", interest.amountMinor, null, "Removed"],
      ["row", null, 242915, "Re-created"],
    ]);
    expect(changeHeadline(undo, directoryOf(s), 2)).toBe("Put it back as one transfer of 2,429.15");
    expect(changeContext(undo)?.text).toMatch(/exactly as it was before Bench split it/);
  });

  it("a payment made a transfer: the payee changes and Actual adds the loan-side row", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    s.seedPayment("2024-02-01", -242915, { category: CATEGORIES.loan });
    const [convert] = byKind((await s.preview(window)).postings, "repayment-link");
    expect(shape(s, convert.output)).toEqual([["row", -242915, -242915, "Payee changes"], ["row", null, 242915, "New"]]);
    expect(changeHeadline(convert, directoryOf(s), 2)).toMatch(/^Record this payment as a transfer to /);
  });

  it("the lender's row linked to the split's principal", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", lenderFeed: true });
    s.seedPayment("2024-02-01", -242915, { category: CATEGORIES.loan });
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    if (split.output.kind !== "restructure") throw new Error("restructure");
    s.seedLenderRow("2024-02-01", -split.output.expectedPostState.children[0].amountMinor);
    await s.apply(split);
    const [link] = byKind((await s.preview(window)).postings, "repayment-link");
    const tags = buildTransformTable(link.output, directoryOf(s), 2).rows.map((r) => r.tag);
    expect(tags).toContain("Linked");
    expect(changeHeadline(link, directoryOf(s), 2)).toMatch(/^Link the lender's [\d,.]+ on .+ \(.+\) to this payment$/);
    expect(changeContext(link)?.text).toMatch(/same money/);
  });
});
