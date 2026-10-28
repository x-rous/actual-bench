import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { LoanModelSnapshot } from "@/lib/financial-models/loan/model";
import { planTracking, type TrackingInput } from "@/lib/assets-debt/tracking/plan";
import { SIMULATOR_DEFAULT_PROFILE } from "../../lib/simulatorModel";
import type { LoanTracking } from "../../lib/useLoanTracking";
import { InstallmentInspector } from "./InstallmentInspector";

/** 500,000 at 5.4% over 20 years from 15 Jan 2024, repaid on the 15th (as in the tracking plan tests). */
const model = {
  debtId: "d1", revision: 1, currency: { code: "USD", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: "embedded-interest",
  terms: { openingDate: "2024-01-15", openingPrincipalMinor: 500_000_00, maturityDate: "2044-01-15", contractualTermMonths: 240, amortizationTermMonths: 240, contractualPaymentMinor: null, creditLimitMinor: null, firstPaymentDate: "2024-02-15", firstInterestChargeDate: "2024-02-15" },
  profile: SIMULATOR_DEFAULT_PROFILE, rates: [{ accrualEffectiveFrom: "2024-01-15", annualRateDecimal: "0.054" }],
  phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null,
} as unknown as LoanModelSnapshot;

let seq = 0;
const tx = (t: Partial<SyncSourceTransaction> & Pick<SyncSourceTransaction, "accountId" | "date" | "amount">): SyncSourceTransaction => ({
  id: `t${++seq}`, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null, cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...t,
});
function transfer(date: string, amount: number) {
  const bank = tx({ accountId: "checking", date, amount: -amount, payeeId: "p-loan", payeeName: "Home loan" });
  const loan = tx({ accountId: "loan", date, amount, payeeId: "p-checking", payeeName: "Everyday", transferId: bank.id });
  bank.transferId = loan.id;
  return { bank, loan };
}

const directory: AccountDirectory = {
  budgetSyncId: "b1",
  accounts: [{ id: "loan", name: "Home loan", offBudget: true, closed: false }, { id: "checking", name: "Everyday", offBudget: false, closed: false }],
  categories: [{ id: "cat-loan", name: "Loan payments", groupName: "Bills", isIncome: false, hidden: false }, { id: "cat-interest", name: "Loan interest", groupName: "Bills", isIncome: false, hidden: false }],
};
const debt: TrackingInput["debt"] = {
  id: "d1", budgetSyncId: "b1", liabilityAccountId: "loan", trackingStartDueDate: "2024-02-15", representation: "split",
  loanPaymentCategoryId: "cat-loan", interestCategoryId: "cat-interest", feeCategoryId: null, principalNoteSuffix: "", interestNoteSuffix: "#interest", toleranceMinor: 100, missingGraceDays: 5,
};
const transferPayeeByAccount = { loan: "p-loan", checking: "p-checking" };

function plan(loanRows: SyncSourceTransaction[], bankRows: SyncSourceTransaction[]) {
  const result = planTracking({ debt, model, today: "2024-02-20", accounts: directory.accounts, transferPayeeByAccount, loanRows, bankRows, entries: [], rules: [] });
  if (!result.ok) throw new Error(result.message);
  const tracking = { tracked: true, debt, bundle: { entries: [], rules: [], writes: [], openingStatement: null, anchors: [] }, reads: { loanRows, bankRows, transferPayeeByAccount, complete: true, readAt: "" }, result, today: "2024-02-20", loading: false, refreshing: false, error: null, refresh: async () => {}, reloadBundle: async () => {} } as unknown as LoanTracking;
  return { result, tracking };
}
const received = () => transfer("2024-01-15", -500_000_00);
const actions = { notThisPayment: jest.fn(), choosePayment: jest.fn(), acceptActual: jest.fn() };

function show(tracking: LoanTracking, inst: ReturnType<typeof plan>["result"]["installments"][number], extra: { onApply?: jest.Mock; onPrev?: () => void; onNext?: () => void } = {}) {
  return render(<InstallmentInspector row={{ kind: "installment", inst }} tracking={tracking} directory={directory} digits={2} busy={false} writesLocked={false} onApply={extra.onApply ?? jest.fn()} actions={actions} onClose={jest.fn()} onPrev={extra.onPrev} onNext={extra.onNext} />);
}

describe("the installment panel", () => {
  it("Unrecorded: shows the payment, the split it would write adding up to the payment, and what Apply changes", () => {
    const r = received();
    const pay = transfer("2024-02-15", 3_411_26);
    const { result, tracking } = plan([r.loan, pay.loan], [r.bank, pay.bank]);
    const inst = result.installments[0];
    const onApply = jest.fn();
    show(tracking, inst, { onApply });
    const panel = screen.getByRole("complementary", { name: "Repayment details" });
    expect(within(panel).getByText("The payment in Actual")).toBeInTheDocument();
    expect(within(panel).getByText("Everyday → Home loan")).toBeInTheDocument();
    expect(within(panel).getByText("Split this payment into")).toBeInTheDocument();
    expect(within(panel).getByText("✓ Adds up to the payment")).toBeInTheDocument();
    expect(within(panel).getByText("Bench's calculation")).toBeInTheDocument();
    expect(within(panel).getByText("After Apply")).toBeInTheDocument();

    // Editing the principal moves the interest; Bench's figure stays beside it, with a way back.
    const field = within(panel).getByLabelText("Principal amount");
    fireEvent.change(field, { target: { value: String((inst.principalMinor + 1_000) / 100) } });
    fireEvent.blur(field);
    expect(within(panel).getByText(`Bench: ${(inst.interestMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Reset to Bench's calculation" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Apply split" }));
    const written = onApply.mock.calls[0][0].output.operations as { economicKind: string; amountMinor: number }[];
    expect(written.find((o) => o.economicKind === "interest")!.amountMinor).toBe(-(inst.interestMinor - 1_000));
  });

  it("Recorded: the split in Actual beside Bench's figures; a difference is shown line by line", () => {
    const r = received();
    const { result: plain } = plan([r.loan, transfer("2024-02-15", 3_411_26).loan], [r.bank]);
    const calc = plain.installments[0].interestMinor;
    const recorded = (interest: number) => {
      const parent = tx({ accountId: "checking", date: "2024-02-15", amount: -3_411_26, isParent: true });
      const loanSide = tx({ accountId: "loan", date: "2024-02-15", amount: 3_411_26 - interest, transferId: "line-p" });
      parent.splitLines = [
        { id: "line-p", amount: -(3_411_26 - interest), payeeId: "p-loan", payeeName: null, categoryId: "cat-loan", categoryName: null, notes: null, transferId: loanSide.id },
        { id: "line-i", amount: -interest, payeeId: null, payeeName: null, categoryId: "cat-interest", categoryName: null, notes: null, transferId: null },
      ];
      return plan([r.loan, loanSide], [r.bank, parent]);
    };

    const same = recorded(calc);
    const { unmount } = show(same.tracking, same.result.installments[0]);
    expect(screen.getByText("Split in Actual")).toBeInTheDocument();
    expect(screen.getByText("✓ Matches Bench's calculation")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Difference" })).toBeNull();
    expect(screen.getByRole("button", { name: "Undo split" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit split" })).toBeInTheDocument();
    unmount();

    const off = recorded(calc + 37);
    show(off.tracking, off.result.installments[0]);
    expect(screen.getByRole("columnheader", { name: "Difference" })).toBeInTheDocument();
    expect(screen.getByText("+0.37")).toBeInTheDocument();
    expect(screen.getByText("−0.37")).toBeInTheDocument();
    expect(screen.queryByText("✓ Matches Bench's calculation")).toBeNull();
  });

  it("steps to the row above or below without closing; an end has nowhere to go", () => {
    const r = received();
    const pay = transfer("2024-02-15", 3_411_26);
    const { result, tracking } = plan([r.loan, pay.loan], [r.bank, pay.bank]);
    const onNext = jest.fn();
    show(tracking, result.installments[0], { onNext });
    expect(screen.getByRole("button", { name: "Previous row" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next row" }));
    expect(onNext).toHaveBeenCalled();
  });
});
