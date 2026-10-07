import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import * as actions from "../../lib/postingActions";
import * as postingsApi from "../../lib/postingsApi";
import { LoanActivity } from "./LoanActivity";

const refresh = jest.fn(async () => {});
jest.mock("./useBackgroundRefresh", () => ({
  useBackgroundRefresh: () => ({ phase: "done", error: null, status: { at: new Date().toISOString(), comparisonDate: "2024-06-01", actualMinor: 100, modelMinor: 100, lenderMinor: null, lenderDate: null, modelVsActualMinor: 0, actualVsLenderMinor: null, drift: "within", reconciliationOverdue: false }, statusFromCache: false, notices: [], driftMaterial: false, refresh, invalidate: jest.fn(), transferPayees: { loan: "tp-loan" } }),
}));
jest.mock("../../lib/postingsApi", () => ({ listPostings: jest.fn(), declinePosting: jest.fn(), proposeReversal: jest.fn(), overrideSplit: jest.fn(), reproducePosting: jest.fn() }));
jest.mock("../../lib/postingActions", () => ({ applyPosting: jest.fn(), checkInterruptedPosting: jest.fn(), completeInterruptedLink: jest.fn(), readForClaims: jest.fn(async () => new Map()) }));
jest.mock("../../lib/debtsApi", () => ({ listDebtObservations: jest.fn(async () => ({ observations: [], history: [] })), getDebtReconciliation: jest.fn() }));
jest.mock("@/store/connection", () => ({ useConnectionStore: (select: (s: unknown) => unknown) => select({}), selectActiveInstance: () => ({ id: "c1", budgetSyncId: "b1", baseUrl: "https://a" }) }));
jest.mock("@/lib/actual", () => ({ getTransport: () => ({ getPayees: async () => [] }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const debt = { debt: { id: "d1", currencyMinorDigits: 2, liabilityAccountId: "loan", currentRevision: 3 }, config: { ok: true, config: { terms: { openingDate: "2023-10-25" } } }, offsets: [] } as unknown as DebtDetail;
const directory = { budgetSyncId: "b1", accounts: [{ id: "chk", name: "Everyday", offBudget: false, closed: false }, { id: "loan", name: "Loan", offBudget: true, closed: false }], categories: [] };
const before = { id: "bank", accountId: "chk", date: "2024-01-29", amountMinor: -100000, payeeId: null, payeeName: null, categoryId: null, notes: null, cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, childCount: 0 };
const split = (interest: number) => ({ kind: "restructure", before, operations: [], expectedPostState: { parentId: "bank", parentAmountMinor: -100000, children: [] }, accountBudgetStatus: {}, components: [{ kind: "principal", amountMinor: 100000 - interest }, { kind: "interest", amountMinor: interest }], closing: null });
const posting = (id: string, periodKey: string, interest: number): PostingView => ({
  id, budgetSyncId: "b1", subjectKind: "debt", subjectId: "d1", postingKind: "repayment-split", periodKey, generation: 1, configRevision: 3, inputFormatVersion: 2, inputHash: "h", engineVersions: {},
  classification: "review", reasons: [{ code: "r", text: "Review it." }], idempotencyMarker: null, status: "proposed", decidedAt: null, appliedAt: null, actualIds: null, reversalOf: null, error: null,
  createdAt: "2024-06-01T00:00:00Z", updatedAt: "2024-06-01T00:00:00Z", output: split(interest) as never, basis: { allocation: null, dueDate: null, paidDate: null, assumedEarlier: 0 },
}) as PostingView;

describe("Activity bulk apply (T290)", () => {
  it("applies the selection oldest first, stops at the first failure, says so, and refreshes before the user continues", async () => {
    const feb = posting("feb", "2024-02-01", 4000);
    const mar = posting("mar", "2024-03-01", 3900);
    jest.mocked(postingsApi.listPostings).mockResolvedValue([mar, feb]);
    const order: string[] = [];
    jest.mocked(actions.applyPosting).mockImplementation(async (p) => {
      order.push(p.id);
      return { ...p, status: p.id === "feb" ? "failed" : "applied", error: p.id === "feb" ? { message: "verification found a problem" } : null } as PostingView;
    });
    render(<QueryClientProvider client={new QueryClient()}><LoanActivity debt={debt} directory={directory} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select all changes that can be applied" }));
    const bar = screen.getByRole("region", { name: "Selected changes" });
    expect(bar).toHaveTextContent("2 selected · Principal 1,921.00 · Interest 79.00");
    fireEvent.click(within(bar).getByRole("button", { name: "Apply 2 changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Apply 2 changes to Actual?" });
    expect(dialog).toHaveTextContent("2 splits");
    expect(dialog).toHaveTextContent(/oldest first/);
    expect(actions.applyPosting).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply 2 changes" }));
    // The confirmation turns into progress; once Actual has been read again it says where it stopped.
    const progress = await screen.findByRole("dialog", { name: "Bulk apply stopped" });
    expect(progress).toHaveTextContent(/0 applied · stopped at 2024-02-01: verification found a problem\. The remaining change was not applied/);
    expect(order).toEqual(["feb"]);
    expect(refresh).toHaveBeenCalled();
    fireEvent.click(within(progress).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(/0 applied · stopped at 2024-02-01/)).toBeInTheDocument();
  });

  it("Blocked rows cannot be selected; Recommended and Review can (owner refinement 3)", async () => {
    jest.mocked(postingsApi.listPostings).mockResolvedValue([
      { ...posting("b", "2024-04-01", 1), classification: "blocked" } as PostingView,
      { ...posting("s", "2024-03-01", 1), classification: "safe" } as PostingView,
      posting("r", "2024-02-01", 1),
    ]);
    render(<QueryClientProvider client={new QueryClient()}><LoanActivity debt={debt} directory={directory} /></QueryClientProvider>);
    await screen.findByRole("checkbox", { name: /Select Repayment split due 2024-03-01/ });
    expect(screen.getByRole("checkbox", { name: /Select Repayment split due 2024-02-01/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Select Repayment split due 2024-04-01/ })).toBeNull();
  });
});
