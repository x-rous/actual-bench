import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import * as postingsApi from "../../lib/postingsApi";
import { describeTimings, PostingsPanel, stepsOf } from "./PostingsPanel";

jest.mock("../../lib/postingsApi", () => ({ listPostings: jest.fn(async () => []), previewPostings: jest.fn(), declinePosting: jest.fn(), proposeReversal: jest.fn() }));
jest.mock("../../lib/postingActions", () => ({ applyPosting: jest.fn(), checkInterruptedPosting: jest.fn(), completeInterruptedLink: jest.fn() }));
jest.mock("../../lib/debtsApi", () => ({ listDebtObservations: jest.fn(async () => ({ observations: [] })) }));

const detail = (openingDate: string) => ({
  debt: { id: "d1", liabilityAccountId: "acc", paymentAccountId: "chk", signConvention: "negative-is-debt", onboardingDate: null, currencyMinorDigits: 2 },
  config: { ok: true, config: { terms: { openingDate } } },
}) as unknown as DebtDetail;

describe("Proposed changes", () => {
  it("previews from the loan's start date by default", () => {
    render(<QueryClientProvider client={new QueryClient()}><PostingsPanel debt={detail("2023-10-25")} directory={undefined} /></QueryClientProvider>);
    const from = screen.getByLabelText("From") as HTMLInputElement;
    // Shown in the browser's locale date format.
    expect(from.value).toBe(new Date(Date.UTC(2023, 9, 25)).toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }));
  });

  it("describes each preview phase", () => {
    expect(describeTimings([{ phase: "payees", ms: 40 }, { phase: "planning", ms: 1500 }])).toBe("Preview took 1.5 s: payees 0.0 s, planning 1.5 s.");
  });

  const bank = { id: "bank", accountId: "chk", date: "2024-02-01", amountMinor: -100000, payeeId: null, payeeName: null, categoryId: null, notes: null, cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, childCount: 0 };
  const lenderRow = { id: "lender", accountId: "acc", date: "2024-02-01", amountMinor: 50000, payeeId: null, payeeName: null, categoryId: null, notes: null, cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, childCount: 0 };
  const posting = (id: string, postingKind: string, output: unknown, status = "proposed") => ({
    id, postingKind, periodKey: "2024-02-01", status, classification: "review", reasons: [{ code: "r", text: "Review it." }], output,
    configRevision: 1, engineVersions: {}, actualIds: null, appliedAt: null, decidedAt: null, reversalOf: null, error: null, idempotencyMarker: null, generation: 1,
  }) as unknown as PostingView;
  const split = (status = "proposed") => posting("split-1", "repayment-split", {
    kind: "restructure", before: bank, components: [],
    operations: [{ economicKind: "principal", amountMinor: -50000, categoryId: null, payeeId: null, transferAccountId: null, notes: "Principal" }, { economicKind: "interest", amountMinor: -50000, categoryId: null, payeeId: null, transferAccountId: null, notes: "Interest" }],
    expectedPostState: { parentId: "bank", parentAmountMinor: -100000, children: [] }, accountBudgetStatus: {}, closing: null,
  }, status);
  const link = posting("link-1", "repayment-link", { kind: "link", sourceBefore: { ...bank, id: "child", isChild: true, parentId: "bank", amountMinor: -50000 }, counterpartBefore: lenderRow, transferPayeeId: "tp-loan", expectedPairState: { sourceTransferId: "lender", counterpartTransferId: "child", counterpartAmountMinor: 50000 }, closing: null });

  it("T278: with a lender feed the split and the link are steps 1 and 2 of one flow, each with its own Apply", async () => {
    jest.mocked(postingsApi.listPostings).mockResolvedValue([link, split()]);
    const directory = { budgetSyncId: "b", accounts: [{ id: "chk", name: "Everyday", offBudget: false, closed: false }, { id: "acc", name: "Loan", offBudget: true, closed: false }], categories: [] };
    render(<QueryClientProvider client={new QueryClient()}><PostingsPanel debt={detail("2023-10-25")} directory={directory} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getAllByLabelText(/^Step [12] of 2$/)).toHaveLength(2));
    const steps = screen.getAllByLabelText(/^Step [12] of 2$/).map((el) => el.textContent ?? "");
    expect(steps[0]).toMatch(/Step 1 of 2: Split the payment/);
    expect(steps[1]).toMatch(/Step 2 of 2: Link the lender's row/);
    const cards = screen.getAllByRole("article");
    for (const card of cards) expect(within(card).getAllByRole("button", { name: "Apply this change" })).toHaveLength(1);
  });

  it("T278: once step 1 is applied without a lender row yet, it says step 2 follows; no lender feed means no steps", () => {
    expect(stepsOf([split("applied")]).get("split-1")?.note).toMatch(/Step 2 appears when the lender's row arrives/);
    const noFeed = posting("split-2", "repayment-split", { ...(split().output as object), operations: [{ economicKind: "principal", amountMinor: -50000, categoryId: null, payeeId: "tp", transferAccountId: "acc", notes: "Principal" }] });
    expect(stepsOf([noFeed]).size).toBe(0);
  });
});
