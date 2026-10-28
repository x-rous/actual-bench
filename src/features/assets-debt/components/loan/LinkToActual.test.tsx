import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import { newTracking, type SimulationState, type TrackingState } from "../../lib/simulatorModel";
import { offsetOf, sim } from "../../lib/simulatorTestKit";
import { LinkToActual, scanLoanAccount } from "./LinkToActual";

const mockRows: { current: SyncSourceTransaction[] } = { current: [] };
jest.mock("@/store/connection", () => ({
  useConnectionStore: (select: (s: unknown) => unknown) => select({}),
  selectActiveInstance: () => ({ id: "c1", budgetSyncId: "b1" }),
}));
jest.mock("@/lib/actual", () => ({
  getTransport: () => ({
    listTransactionsForSync: async () => mockRows.current,
    getAccounts: async () => [], getCategoryGroups: async () => ({ groups: [], categories: [] }), getPayees: async () => [], getTags: async () => [],
  }),
}));

const DIRECTORY: AccountDirectory = {
  budgetSyncId: "b1",
  accounts: [
    { id: "chk", name: "Everyday", offBudget: false, closed: false },
    { id: "loan", name: "Home loan", offBudget: true, closed: false },
  ],
  categories: [
    { id: "cat-loan", name: "Loan payments", groupName: "Bills", isIncome: false, hidden: false },
    { id: "cat-int", name: "Interest", groupName: "Bills", isIncome: false, hidden: false },
  ],
};

let seq = 0;
const row = (t: Partial<SyncSourceTransaction> & Pick<SyncSourceTransaction, "date" | "amount">): SyncSourceTransaction => ({
  id: `r${++seq}`, accountId: "loan", payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null, cleared: true, reconciled: false,
  importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...t,
});

/** 30,000 over 3 years from 1 Jan 2024, repaid monthly. */
const loan = (patch: Partial<SimulationState> = {}) => sim({ termMonths: 36, principalMinor: 3_000_000, ...patch });

/** The settings after the last change the tab made. */
const changed: { current: TrackingState | null } = { current: null };
function Harness({ initial, simulation = loan() }: { initial: Partial<TrackingState>; simulation?: SimulationState }) {
  const [tracking, setTracking] = useState<TrackingState>({ ...newTracking(simulation), name: "Home loan", ...initial });
  const update = (next: TrackingState) => { changed.current = next; setTracking(next); };
  return <LinkToActual sim={simulation} tracking={tracking} setTracking={update} directory={DIRECTORY} issues={[]} rules={[]} onEditRules={() => {}} saved />;
}
function wrap(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

beforeEach(() => { mockRows.current = []; changed.current = null; });

describe("Link to Actual", () => {
  it("splits each repayment by default; lender-charged interest needs the lender's own rows in the loan account", async () => {
    wrap(<Harness initial={{ liabilityAccountId: "loan" }} />);
    const interest = screen.getByRole("radiogroup", { name: "How interest is recorded" });
    expect(within(interest).getByRole("radio", { name: "Split each repayment" })).toHaveAttribute("aria-checked", "true");
    expect(within(interest).getByRole("radio", { name: "Lender charges interest into the loan account" })).toBeDisabled();
    expect(screen.getByText("Added to the interest line")).toBeInTheDocument();
    expect(await screen.findByText(/No transfers into the loan account\. If repayments are expenses/)).toBeInTheDocument();
  });

  it("suggests the first installment after a late opening balance and compares the opening position with Actual", async () => {
    // The account starts with an opening balance on 10 Jun 2024, after the fifth installment.
    mockRows.current = [row({ date: "2024-06-10", amount: -2_600_000 })];
    wrap(<Harness initial={{ liabilityAccountId: "loan" }} />);
    expect(await screen.findByText(/opening balance on 10 Jun 2024, so installment 6 \(01 Jul 2024\) is the first one recorded there/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use installment 6" }));
    await waitFor(() => expect(changed.current?.trackingStartDueDate).toBe("2024-07-01"));
    expect(screen.getByRole("radio", { name: /Opening position from the calculation/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Actual's loan account before installment/).nextSibling).toHaveTextContent("26,000.00");
  });

  it("an early first payment and a later row that adds to the debt change neither the suggestion nor the opening", async () => {
    mockRows.current = [
      row({ date: "2024-01-01", amount: -3_000_000, transferId: "bank-1" }), // the loan arrives by transfer
      row({ date: "2024-01-25", amount: 90_000, transferId: "bank-2" }), // installment 1 (due 1 Feb), paid early
      row({ date: "2025-06-29", amount: -480_000 }), // much later, the debt grows
    ];
    wrap(<Harness initial={{ liabilityAccountId: "loan" }} />);
    expect(await screen.findByText(/The loan arrived as a transfer of 30,000.00 on 01 Jan 2024/)).toBeInTheDocument();
    expect(screen.getByText(/Suggested: the first installment/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Use installment/ }).map((b) => b.textContent)).toEqual(["Use installment 1"]);
    expect(screen.getByText(/Actual's loan account before installment 1/).nextSibling).toHaveTextContent("30,000.00");
    expect(screen.getByText("Within the tolerance: nothing to write.")).toBeInTheDocument();
  });

  it("chooses the start by installment number or by date", async () => {
    wrap(<Harness initial={{ liabilityAccountId: "loan" }} />);
    fireEvent.change(screen.getByLabelText("First installment"), { target: { value: "3" } });
    fireEvent.blur(screen.getByLabelText("First installment"));
    await waitFor(() => expect(changed.current?.trackingStartDueDate).toBeTruthy());
    const third = changed.current!.trackingStartDueDate!;
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    expect(screen.getByRole("button", { name: "Due date" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("First installment on or after")).toBeInTheDocument();
    expect(screen.getByText("No. 3 of 36")).toBeInTheDocument();
    expect(third.startsWith("2024-")).toBe(true);
  });

  it("asks for each offset account in Actual, needed even for a draft, with tracking its balance as a switch", () => {
    const simulation = loan(offsetOf(500_000));
    wrap(<Harness initial={{ liabilityAccountId: "loan" }} simulation={simulation} />);
    expect(screen.getByText("Offset account")).toBeInTheDocument();
    expect(screen.getByText(/Required even for a draft/)).toBeInTheDocument();
    // Read-only here: the harness gives no way to change the calculation.
    expect(screen.getByRole("switch", { name: "Track offset account balance from Actual" })).toHaveAttribute("aria-disabled", "true");
  });

  it("only a term loan you owe can be tracked; any other loan stays a calculation", () => {
    wrap(<Harness initial={{ direction: "owed-to-me" } as Partial<TrackingState>} />);
    expect(screen.getByText(/Only loans you owe with a repayment schedule can be tracked in Actual/)).toBeInTheDocument();
  });
});

describe("scanning the loan account", () => {
  it("finds the opening balance, transfers in and rows the lender charged later", () => {
    const opening = row({ date: "2024-01-01", amount: -3_000_000 });
    const scan = scanLoanAccount([
      row({ date: "2024-02-01", amount: 90_000, transferId: "x" }),
      opening,
      row({ date: "2024-02-28", amount: -12_000 }),
    ], "2024-01-01");
    expect(scan).toMatchObject({ openingRow: opening, transfersIn: 1, lenderCharges: 1, firstDate: "2024-01-01" });
  });
});
