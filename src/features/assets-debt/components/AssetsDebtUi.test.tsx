import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail, DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import { chooseSelectOption } from "@/components/ui/select.testing";
import * as api from "../lib/debtsApi";
import { newDebtState, type EditorState } from "../lib/editorModel";
import { AssetsDebtTabs } from "./AssetsDebtTabs";
import { DebtList } from "./DebtList";
import { DebtEditor } from "./editor/DebtEditor";
import { SAVE_BOUNDARY_NOTICE } from "./editor/EditorFooter";
import { CalculatorView, NOT_ADVICE } from "./calculator/CalculatorView";

jest.mock("../lib/debtsApi", () => {
  const actual = jest.requireActual("../lib/debtsApi");
  return { ...actual, createDebt: jest.fn(), updateDebt: jest.fn(), getSchedule: jest.fn(), saveAssumptions: jest.fn(), getEligibility: jest.fn() };
});
jest.mock("next/navigation", () => ({ usePathname: () => "/assets-debt/loans/abc", useRouter: () => ({ push: jest.fn() }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const mocked = api as jest.Mocked<typeof api>;

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const DIRECTORY: AccountDirectory = {
  budgetSyncId: "b1",
  accounts: [
    { id: "chk", name: "Everyday", offBudget: false, closed: false },
    { id: "loan", name: "Home loan", offBudget: true, closed: false },
    { id: "sav", name: "Savings", offBudget: false, closed: false },
  ],
  categories: [
    { id: "cat-loan", name: "Loan payments", groupName: "Bills", isIncome: false, hidden: false },
    { id: "cat-pay", name: "Salary", groupName: "Income", isIncome: true, hidden: false },
  ],
};

function summary(i: number, patch: Partial<DebtSummary> = {}): DebtSummary {
  return { id: `d${i}`, name: `Loan ${i}`, debtType: "mortgage", behaviorClass: "term-loan", status: "active", currency: "AUD", currencyMinorDigits: 2, liabilityAccountId: `l${i}`, executionStrategy: "bench-daily", openingPrincipalMinor: 100_000, currentRevision: 1, blocked: null, ...patch };
}

function filledState(patch: Partial<EditorState> = {}): EditorState {
  const s = newDebtState("b1");
  s.name = "Home loan";
  s.liabilityAccountId = "loan";
  s.paymentAccountId = "chk";
  s.terms = { ...s.terms, openingDate: "2024-01-01", openingPrincipal: "400000", contractualTermMonths: "360", amortizationTermMonths: "360", firstPaymentDate: "2024-02-01" };
  s.rates = [{ ...s.rates[0], accrualEffectiveFrom: "2024-01-01", ratePercent: "6.12" }];
  return { ...s, ...patch };
}

describe("Assets & Debt tabs", () => {
  it("labels the section navigation, marks the current tab, and moves with the arrow keys", () => {
    render(<AssetsDebtTabs />);
    const nav = screen.getByRole("navigation", { name: "Assets & Debt sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Overview", "Loans & Debt", "Assets", "Rules", "Activity"]);
    expect(screen.getByRole("link", { name: "Loans & Debt" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    links[1].focus();
    fireEvent.keyDown(links[1], { key: "ArrowRight" });
    expect(document.activeElement).toBe(links[2]);
    fireEvent.keyDown(links[2], { key: "End" });
    expect(document.activeElement).toBe(links[4]);
    fireEvent.keyDown(links[4], { key: "ArrowRight" });
    expect(document.activeElement).toBe(links[0]);
  });
});

/** jsdom has no layout; give the virtualized lists a viewport so they render a window of rows. */
function withViewport() {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
  });
  afterAll(() => {
    if (width) Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
    if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
  });
}

describe("Loans & Debt list", () => {
  withViewport();

  it("renders 1,000 debts with a bounded DOM", () => {
    render(<DebtList debts={Array.from({ length: 1000 }, (_, i) => summary(i))} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(60);
    expect(screen.getByRole("list", { name: "1000 debts" })).toBeInTheDocument();
  });

  it("shows a Blocked debt in words on its own row while the others stay usable", () => {
    render(<DebtList debts={[summary(1, { blocked: { code: "unsupported-config", message: "newer" } }), summary(2), summary(3, { status: "draft" })]} />);
    const [blocked, fine, draft] = screen.getAllByRole("link");
    expect(blocked).toHaveTextContent("Blocked: configured by a newer version of Actual Bench");
    expect(fine).toHaveTextContent("Active");
    expect(fine).toHaveAttribute("href", "/assets-debt/loans/d2");
    expect(draft).toHaveTextContent("Draft");
  });
});

describe("loan editor", () => {
  beforeEach(() => jest.clearAllMocks());

  it("labels every main control and shows the save-boundary notice", () => {
    wrap(<DebtEditor initial={filledState()} debtId={null} directory={DIRECTORY} onSaved={jest.fn()} />);
    for (const label of ["Name", "Currency", "Opening date", "Opening principal", "Contract term (months)", "Amortization term (months)", "Annual rate (%)", "Accrues from", "Lender charge grace (days)"]) {
      expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
    }
    for (const label of ["Type", "Behaves as", "Liability account", "Payment account", "Day count", "Interest accrues", "Repayment frequency", "Repayment amount", "Start from a preset"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(SAVE_BOUNDARY_NOTICE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save debt" })).toHaveAttribute("type", "submit");
  });

  it("shows the loan payment category only when the accounts cross the budget boundary, with no way to create a category", () => {
    const { unmount } = wrap(<DebtEditor initial={filledState()} debtId={null} directory={DIRECTORY} onSaved={jest.fn()} />);
    expect(screen.getByText("Loan payment category")).toBeInTheDocument();
    expect(screen.queryByText(/create (a )?(new )?category|new category/i)).toBeNull();
    unmount();
    wrap(<DebtEditor initial={filledState({ liabilityAccountId: "sav" })} debtId={null} directory={DIRECTORY} onSaved={jest.fn()} />);
    expect(screen.queryByText("Loan payment category")).toBeNull();
    expect(screen.getByText(/do not cross the budget boundary/)).toBeInTheDocument();
  });

  it("a preset fills explicit fields, stays editable, and names no lender", async () => {
    wrap(<DebtEditor initial={filledState()} debtId={null} directory={DIRECTORY} onSaved={jest.fn()} />);
    const presetLabel = screen.getByText("Start from a preset");
    const trigger = presetLabel.parentElement!.querySelector("button")!;
    await chooseSelectOption(trigger, "Daily interest, charged monthly");
    expect(screen.getByText(/not any particular lender/)).toBeInTheDocument();
    expect(screen.getByLabelText("Charge day of the month")).toHaveValue("1");
  });

  it("sends exact decimals and the account directory, and shows server validation issues in place", async () => {
    mocked.createDebt.mockRejectedValueOnce(new api.DebtApiError("invalid", 400, [{ field: "offsets.0.actualAccountId", message: "is not an account in this budget" }, { field: "liabilityAccountId", message: "is already the liability account of another debt" }]));
    wrap(<DebtEditor initial={filledState()} debtId={null} directory={DIRECTORY} onSaved={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save debt" }));
    await waitFor(() => expect(mocked.createDebt).toHaveBeenCalled());
    const [input, directory] = mocked.createDebt.mock.calls[0];
    expect(input.rates[0].annualRateDecimal).toBe("0.0612");
    expect((input.config as { terms: { openingPrincipalMinor: number } }).terms.openingPrincipalMinor).toBe(40_000_000);
    expect(directory).toBe(DIRECTORY);
    expect(await screen.findByRole("alert")).toHaveTextContent("2 fields need attention");
    expect(screen.getByText("is already the liability account of another debt")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Problems in Offset and redraw" })).toHaveTextContent("is not an account in this budget");
  });

  it("stops before sending when an amount cannot be read", async () => {
    wrap(<DebtEditor initial={filledState({ terms: { ...filledState().terms, openingPrincipal: "four hundred" } })} debtId={null} directory={DIRECTORY} onSaved={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save debt" }));
    expect(await screen.findByText("Enter an amount such as 1250.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Opening principal")).toHaveAttribute("aria-invalid", "true");
    expect(mocked.createDebt).not.toHaveBeenCalled();
  });
});

describe("calculator and forecast", () => {
  withViewport();
  const detail = {
    debt: { id: "d1", name: "Home loan", currency: "AUD", currencyMinorDigits: 2, currentRevision: 1, status: "active" },
    config: { ok: true, config: { terms: { openingDate: "2024-01-01" } } },
    rates: [],
    offsets: [],
    assumptions: [],
    revision: { number: 1, hash: null, createdAt: null },
    blocked: null,
  } as unknown as DebtDetail;
  const projection = (closing: number) => ({
    ok: true as const,
    schemaVersion: 1 as const,
    debtId: "d1",
    stale: false,
    monthly: [{ period: "2024-02", from: "2024-02-01", to: "2024-02-29", openingMinor: 100_000, interestMinor: 500, feesMinor: 0, repaidMinor: 2_000, drawnMinor: 0, closingMinor: closing }],
    events: [{ date: "2024-02-01", eventType: "repayment" as const, cashMovementMinor: -2_000, principalMovementMinor: -1_500, interestMinor: 500, feesMinor: 0, balanceBeforeMinor: 100_000, balanceAfterMinor: closing, certainty: "scheduled" as const, sourceAccountId: null, debtAccountId: null, categoryAllocations: [], modelRevision: 1, engineVersions: {}, diagnostics: {} }],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mocked.getSchedule.mockImplementation(async (_id, body) => projection(body.overrides ? 50_000 : 98_500));
  });

  it("says it is not advice, keeps alternatives temporary, and applies a baseline only after confirming", async () => {
    wrap(<CalculatorView detail={detail} />);
    expect(screen.getByText(NOT_ADVICE)).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: /Balance over time/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Schedule" })).toBeInTheDocument();

    // An incomplete alternative is refused in words and nothing is projected or offered for saving.
    fireEvent.change(screen.getByLabelText("Extra repayment"), { target: { value: "500.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose the date of the extra repayment");
    expect(screen.queryByRole("button", { name: "Apply as baseline" })).toBeNull();
    expect(mocked.getSchedule).not.toHaveBeenCalledWith("d1", expect.objectContaining({ overrides: expect.anything() }));
    expect(mocked.saveAssumptions).not.toHaveBeenCalled();
  });

  it("the apply dialog takes focus, and applying saves only the baseline assumptions", async () => {
    mocked.saveAssumptions.mockResolvedValue({ ...detail, debt: { ...detail.debt, currentRevision: 2 } } as DebtDetail);
    wrap(<CalculatorView detail={detail} />);
    await screen.findByRole("img", { name: /Balance over time/ });
    fireEvent.change(screen.getByLabelText("Extra repayment"), { target: { value: "500.00" } });
    const date = screen.getByLabelText("Extra repayment date");
    fireEvent.change(date, { target: { value: "2024-06-01" } });
    fireEvent.blur(date);
    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    await waitFor(() => expect(mocked.getSchedule).toHaveBeenCalledWith("d1", expect.objectContaining({ overrides: expect.anything() })));
    expect((await screen.findAllByText(/alternative:/)).length).toBeGreaterThan(0);
    expect(screen.getByText(SAVE_BOUNDARY_NOTICE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply as baseline" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(dialog).toHaveTextContent("No transaction is created in Actual");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocked.saveAssumptions).toHaveBeenCalledTimes(1));
    const [id, assumptions] = mocked.saveAssumptions.mock.calls[0];
    expect(id).toBe("d1");
    expect(assumptions).toEqual([expect.objectContaining({ kind: "extra-repayment", effectiveFrom: "2024-06-01", amountMinor: 50_000 })]);
    expect(mocked.createDebt).not.toHaveBeenCalled();
    expect(mocked.updateDebt).not.toHaveBeenCalled();
  });
});
