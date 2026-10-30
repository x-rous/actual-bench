import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { LoanModelSnapshot } from "@/lib/financial-models/loan/model";
import { planTracking, type TrackingInput } from "@/lib/assets-debt/tracking/plan";
import { SIMULATOR_DEFAULT_PROFILE } from "../../lib/simulatorModel";
import { downloadCsv } from "@/lib/csv";
import { RepaymentsTab } from "./RepaymentsTab";
import { REPAYMENTS_CSV_HEADER, repaymentsCsvFilename } from "./repaymentsExport";

jest.mock("@/lib/csv", () => ({ ...jest.requireActual("@/lib/csv"), downloadCsv: jest.fn() }));

let seq = 0;
const tx = (t: Partial<SyncSourceTransaction> & Pick<SyncSourceTransaction, "accountId" | "date" | "amount">): SyncSourceTransaction => ({
  id: `t${++seq}`, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null, cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, splitLines: [], ...t,
});
const transfer = (date: string, amount: number) => {
  const bank = tx({ accountId: "checking", date, amount: -amount, payeeId: "p-loan", payeeName: "LS Mortgage" });
  const loan = tx({ accountId: "loan", date, amount, payeeId: "p-checking", payeeName: "checking", transferId: bank.id });
  bank.transferId = loan.id;
  return { bank, loan };
};
const model = { debtId: "d1", revision: 1, currency: { code: "USD", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: "embedded-interest",
  terms: { openingDate: "2024-01-15", openingPrincipalMinor: 500_000_00, maturityDate: "2044-01-15", contractualTermMonths: 240, amortizationTermMonths: 240, contractualPaymentMinor: null, creditLimitMinor: null, firstPaymentDate: "2024-02-15", firstInterestChargeDate: "2024-02-15" },
  profile: SIMULATOR_DEFAULT_PROFILE, rates: [{ accrualEffectiveFrom: "2024-01-15", annualRateDecimal: "0.054" }], phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null } as unknown as LoanModelSnapshot;

function plan(toleranceMinor = 100_00) {
  const received = transfer("2024-01-15", -500_000_00);
  // Installment 1 is already split in Actual with interest 37.00 above the calculation, so it shows a difference.
  const first = transfer("2024-02-15", 3_411_26);
  const base: TrackingInput = {
    debt: { id: "d1", budgetSyncId: "b1", liabilityAccountId: "loan", trackingStartDueDate: "2024-02-15", representation: "split", loanPaymentCategoryId: "cat-loan", interestCategoryId: "cat-interest", feeCategoryId: null, principalNoteSuffix: "", interestNoteSuffix: "#interest", toleranceMinor, missingGraceDays: 5 },
    model, today: "2024-03-20", accounts: [{ id: "loan", name: "LS Mortgage", offBudget: true, closed: false }, { id: "checking", name: "LS Checking", offBudget: false, closed: false }],
    transferPayeeByAccount: { loan: "p-loan", checking: "p-checking" }, loanRows: [received.loan, first.loan], bankRows: [received.bank, first.bank], entries: [], rules: [],
  };
  const calculated = planTracking(base);
  if (!calculated.ok) throw new Error(calculated.message);
  const interest = calculated.installments[0].interestMinor + 37_00;
  const parent = tx({ accountId: "checking", date: "2024-02-15", amount: -3_411_26, isParent: true });
  const loanSide = tx({ accountId: "loan", date: "2024-02-15", amount: 3_411_26 - interest, transferId: "line-p" });
  parent.splitLines = [
    { id: "line-p", amount: -(3_411_26 - interest), payeeId: "p-loan", payeeName: null, categoryId: "cat-loan", categoryName: null, notes: null, transferId: loanSide.id },
    { id: "line-i", amount: -interest, payeeId: null, payeeName: null, categoryId: "cat-interest", categoryName: null, notes: null, transferId: null },
  ];
  const second = transfer("2024-03-15", 3_411_26);
  return planTracking({ ...base, loanRows: [received.loan, loanSide, second.loan], bankRows: [received.bank, parent, second.bank] });
}

function renderTab(toleranceMinor = 100_00) {
  const result = plan(toleranceMinor);
  if (!result.ok) throw new Error(result.message);
  const tracking = { tracked: true, debt: { toleranceMinor }, bundle: { writes: [], rules: [], entries: [] }, reads: undefined, result, loading: false, refreshing: false, error: null, today: "2024-03-20", refresh: jest.fn(), reloadBundle: jest.fn() };
  render(<RepaymentsTab tracking={tracking as never} directory={undefined} digits={2} onLinkToActual={jest.fn()} onPaymentRules={jest.fn()} apply={jest.fn()} run={null} outcomes={null} onDismissOutcomes={jest.fn()} actions={{} as never} writesLocked={false} />);
  return result;
}

describe("the Repayments table", () => {
  it("does not report agreement while a recorded split needs drift review", () => {
    const result = renderTab(100);
    expect(result.installments.some((i) => i.checkKind === "drift")).toBe(true);
    expect(screen.getByText("By today · recorded splits need review")).toBeInTheDocument();
    expect(screen.queryByText("By today · agrees with Actual")).not.toBeInTheDocument();
  });
  it("filters by one pill per status, as the badges read, with the counts beside them", () => {
    renderTab();
    const pills = screen.getByRole("button", { name: /^All/ }).parentElement!;
    for (const name of ["All", "Unrecorded", "Check", "Missing", "Recorded"]) expect(within(pills).getByRole("button", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    expect(within(pills).queryByRole("button", { name: /To do/ })).not.toBeInTheDocument();
    expect(within(pills).getByRole("button", { name: /^Unrecorded/ })).toHaveTextContent("1");
    expect(within(pills).getByRole("button", { name: /^Recorded/ })).toHaveTextContent("1");
    fireEvent.click(within(pills).getByRole("button", { name: /^Recorded/ }));
    expect(within(pills).getByRole("button", { name: /^Recorded/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("marks interest that Actual holds differently from Bench's calculation with an i that says how, in words", async () => {
    renderTab();
    expect(screen.queryByText("Difference")).not.toBeInTheDocument();
    // Installment 1's recorded interest is 37.00 above the calculation; the hint names both figures.
    const hint = screen.getAllByRole("button", { name: /^More about Calculated interest/ });
    expect(hint).toHaveLength(1);
    fireEvent.focus(hint[0]);
    expect(await screen.findByText(/Actual has 37\.00 more interest than Bench calculates/)).toBeInTheDocument();
  });

  it("exports what the table shows as CSV, with the interest difference between Actual and Bench", () => {
    const download = downloadCsv as jest.Mock;
    download.mockClear();
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(download).toHaveBeenCalledTimes(1);
    const [filename, rows] = download.mock.calls[0] as [string, string[][]];
    expect(filename).toBe("repayments-2024-03-20.csv");
    expect(rows[0]).toEqual([...REPAYMENTS_CSV_HEADER]);
    const col = (name: (typeof REPAYMENTS_CSV_HEADER)[number]) => REPAYMENTS_CSV_HEADER.indexOf(name);
    // Installment 1 is the recorded split whose interest is 37.00 above Bench's calculation.
    const first = rows.find((r) => r[col("No.")] === "1")!;
    expect(first[col("Type")]).toBe("Installment");
    expect(first[col("Due date")]).toBe("2024-02-15");
    expect(first[col("Status")]).toBe("Recorded");
    expect(first[col("Interest difference (Actual minus Bench)")]).toBe("37.00");
    expect(Number(first[col("Interest in Actual")]) - Number(first[col("Interest calculated by Bench")])).toBeCloseTo(37, 2);
    expect(first[col("Payment")]).toBe("3411.26");
    // Every row has every column, and amounts are plain decimals (no grouping or currency code).
    for (const row of rows) expect(row).toHaveLength(REPAYMENTS_CSV_HEADER.length);
    expect(rows.flat().some((cell) => /,\d{3}\./.test(cell))).toBe(false);
  });

  it("exports only the rows the filter leaves, and nothing when none is left", () => {
    const download = downloadCsv as jest.Mock;
    download.mockClear();
    renderTab();
    const pills = screen.getByRole("button", { name: /^All/ }).parentElement!;
    fireEvent.click(within(pills).getByRole("button", { name: /^Missing/ }));
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    fireEvent.click(within(pills).getByRole("button", { name: /^Recorded/ }));
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const rows = download.mock.calls[0][1] as string[][];
    expect(rows.slice(1).every((r) => r[REPAYMENTS_CSV_HEADER.indexOf("Status")] === "Recorded")).toBe(true);
  });

  it("names the file after the loan, made safe for a file name", () => {
    expect(repaymentsCsvFilename("350K Loan", "2026-10-29")).toBe("350k-loan-repayments-2026-10-29.csv");
    expect(repaymentsCsvFilename("Mum & Dad's house / 2", "2026-10-29")).toBe("mum-dad-s-house-2-repayments-2026-10-29.csv");
    expect(repaymentsCsvFilename(undefined, "2026-10-29")).toBe("repayments-2026-10-29.csv");
  });
});
