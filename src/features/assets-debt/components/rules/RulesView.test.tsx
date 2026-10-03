import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DebtBacktestResult } from "@/lib/financial-models/matching";
import * as api from "../../lib/debtsApi";
import { BacktestResultsTable } from "./BacktestResultsTable";
import { RulesView } from "./RulesView";

jest.mock("../../lib/debtsApi", () => ({
  listDebts: jest.fn(), getDebt: jest.fn(), listMatchRules: jest.fn(), createMatchRule: jest.fn(),
  updateMatchRule: jest.fn(), deleteMatchRule: jest.fn(), runMatchBacktest: jest.fn(),
}));
jest.mock("../../lib/useAccountDirectory", () => ({
  useAccountDirectory: () => ({ data: { budgetSyncId: "budget-1", accounts: [{ id: "acc-checking", name: "Everyday", closed: false, offBudget: false }], categories: [] } }),
}));
jest.mock("@/store/connection", () => ({
  useConnectionStore: (selector: (state: unknown) => unknown) => selector({}),
  selectActiveInstance: () => ({ id: "connection-1", budgetSyncId: "budget-1" }),
}));
jest.mock("@/lib/actual", () => ({ getTransport: () => ({ listTransactionsForSync: jest.fn(async () => []) }) }));
jest.mock("next/navigation", () => ({ usePathname: () => "/assets-debt/rules" }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const mocked = api as jest.Mocked<typeof api>;

function wrap(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

const period = (status: "missing" | "unique" | "multiple" | "unsafe", index: number): DebtBacktestResult["periods"][number] => ({
  expected: { periodKey: `2024-${String((index % 12) + 1).padStart(2, "0")}-01-${index}`, date: "2024-02-01", paymentMinor: 100_000 },
  status,
  candidates: status === "missing" ? [] : [{
    candidate: { id: `tx-${index}`, parentId: null, accountId: "acc-checking", date: "2024-02-01", amountMinor: -100_000, payeeId: null, importedPayee: null, notes: null, categoryId: null, isParent: false, benchMarked: false, postingLinked: false },
    matches: true,
    unsafeReasons: status === "unsafe" ? ["split-parent-unclaimable"] : [],
    deviation: { amountMinor: 0, days: 0 },
  }],
  strength: "strong",
  reviewReasons: status === "multiple" ? ["Several rows match"] : status === "unsafe" ? ["split-parent-unclaimable"] : [],
  projectedBalanceVarianceMinor: status === "unique" ? 0 : null,
  flags: [],
});

describe("Assets & Debt Rules", () => {
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  beforeAll(() => Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 420 }));
  afterAll(() => {
    if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
  });

  it("opens an accessible matching-rule editor with a safe payment-account starter definition", async () => {
    mocked.listDebts.mockResolvedValue([{ id: "debt-1", name: "Home loan", debtType: "mortgage", behaviorClass: "term-loan", status: "active", currency: "AUD", currencyMinorDigits: 2, liabilityAccountId: "loan", executionStrategy: "bench-daily", openingPrincipalMinor: 1, currentRevision: 1, blocked: null }]);
    mocked.getDebt.mockResolvedValue({ debt: { id: "debt-1", paymentAccountId: "acc-checking" } } as never);
    mocked.listMatchRules.mockResolvedValue([]);
    wrap(<RulesView />);

    const add = await screen.findByRole("button", { name: "Add rule" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    expect(await screen.findByRole("dialog", { name: "Add matching rule" })).toBeInTheDocument();
    expect((screen.getByLabelText("Conditions · matching DSL v1") as HTMLTextAreaElement).value).toContain('"accountId": "acc-checking"');
    expect(screen.getByText(/never creates or runs an Actual rule/i)).toBeInTheDocument();
  });

  it("renders text and icons for every backtest state while keeping a long result bounded", () => {
    const statuses = ["unique", "missing", "multiple", "unsafe"] as const;
    const periods = Array.from({ length: 1_000 }, (_, index) => period(statuses[index % statuses.length], index));
    const result: DebtBacktestResult = {
      format: "rd084.debt-backtest", version: 1, from: "2024-01-01", to: "2026-01-01", generatedAt: "2026-10-03T00:00:00.000Z",
      read: { accounts: 1, transactions: 1_000 }, strength: { strength: "strong", reasons: [] }, warnings: [],
      summary: { expectedPeriods: 1_000, unique: 250, missing: 250, multiple: 250, unsafe: 250 }, periods,
    };
    render(<BacktestResultsTable result={result} minorDigits={2} />);

    expect(screen.getByRole("table", { name: "Backtest results for 1000 expected repayments" })).toBeInTheDocument();
    expect(screen.getAllByRole("row").length).toBeLessThan(50);
    expect(screen.getAllByText("Unique").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Missing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Multiple - Review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unsafe - Review").length).toBeGreaterThan(0);
  });
});
