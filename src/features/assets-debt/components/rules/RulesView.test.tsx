import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DebtBacktestResult } from "@/lib/financial-models/matching";
import * as api from "../../lib/debtsApi";
import { BacktestResultsTable } from "./BacktestResultsTable";
import { RulesView } from "./RulesView";

jest.mock("../../lib/debtsApi", () => ({
  listDebts: jest.fn(), getDebt: jest.fn(), listMatchRules: jest.fn(), createMatchRule: jest.fn(),
  updateMatchRule: jest.fn(), deleteMatchRule: jest.fn(), runMatchBacktest: jest.fn(), getSchedule: jest.fn(),
}));
jest.mock("../../lib/useAccountDirectory", () => ({
  useAccountDirectory: () => ({ data: { budgetSyncId: "budget-1", accounts: [{ id: "acc-checking", name: "Everyday", closed: false, offBudget: false }], categories: [] } }),
}));
jest.mock("@/store/connection", () => ({
  useConnectionStore: (selector: (state: unknown) => unknown) => selector({}),
  selectActiveInstance: () => ({ id: "connection-1", budgetSyncId: "budget-1" }),
}));
jest.mock("@/lib/actual", () => ({ getTransport: () => ({ listTransactionsForSync: jest.fn(async () => []) }) }));
jest.mock("next/navigation", () => ({ usePathname: () => "/assets-debt/loans/debt-1" }));
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

describe("Repayment matching (a loan tab)", () => {
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  beforeAll(() => Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 420 }));
  afterAll(() => {
    if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
  });

  it("belongs to one loan: no loan picker, and the history starts at the loan's start date", async () => {
    mocked.getDebt.mockResolvedValue({
      debt: { id: "debt-1", paymentAccountId: "acc-checking", liabilityAccountId: "acc-loan", signConvention: "negative-is-debt", driftToleranceMinor: 100, currency: "AED", currencyMinorDigits: 2 },
      config: { ok: true, config: { terms: { contractualPaymentMinor: 837_957, openingDate: "2023-10-25" } } },
      blocked: null,
    } as never);
    mocked.listMatchRules.mockResolvedValue([]);
    wrap(<RulesView debtId="debt-1" />);
    await screen.findByText(/No matching yet/);
    expect(screen.queryByLabelText("Debt")).toBeNull();
    expect(mocked.listMatchRules).toHaveBeenCalledWith("debt-1");
    await waitFor(() => expect((screen.getByLabelText("History from") as HTMLInputElement).value).toBe(new Date(Date.UTC(2023, 9, 25)).toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })));
  });

  it("sets up matching from Tracking setup without JSON: the HSBC case, AED 8,379.57 up to 10 days early", async () => {
    mocked.getDebt.mockResolvedValue({
      debt: { id: "debt-1", paymentAccountId: "acc-checking", liabilityAccountId: "acc-loan", signConvention: "negative-is-debt", driftToleranceMinor: 100, currency: "AED", currencyMinorDigits: 2 },
      config: { ok: true, config: { terms: { contractualPaymentMinor: 837_957 } } },
    } as never);
    mocked.listMatchRules.mockResolvedValue([]);
    mocked.createMatchRule.mockResolvedValue({} as never);
    wrap(<RulesView debtId="debt-1" />);

    const setUp = await screen.findByRole("button", { name: "Set up matching" });
    await waitFor(() => expect(setUp).toBeEnabled());
    fireEvent.click(setUp);
    const dialog = await screen.findByRole("dialog", { name: "Set up matching" });
    expect(within(dialog).queryByRole("textbox", { name: /DSL|JSON/i })).toBeNull();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Matches money out in Everyday, 8,379.57 AED ± 1.00 AED; from 3 days early to 3 days late around each scheduled date.");
    fireEvent.change(within(dialog).getByLabelText("Days early"), { target: { value: "10" } });
    expect(within(dialog).getByRole("status")).toHaveTextContent("from 10 days early to 3 days late");
    fireEvent.click(within(dialog).getByRole("button", { name: "Customize matching" }));
    expect(within(dialog).getByRole("region", { name: "Customize matching" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and enable" }));
    await waitFor(() => expect(mocked.createMatchRule).toHaveBeenCalledTimes(1));
    const [, saved, enableBacktest] = mocked.createMatchRule.mock.calls[0];
    expect(saved.purpose).toBe("repayment");
    expect(saved.enabled).toBe(true);
    // Enabling sends a fresh read-only backtest of the rule's account; the server gate decides.
    expect(enableBacktest).toMatchObject({ snapshots: [{ accountId: "acc-checking", transactions: [] }] });
    expect((saved.conditions as { items: unknown[] }).items).toEqual([
      { kind: "source-account", accountId: "acc-checking" },
      { kind: "amount", operator: "approximate", amountMinor: 837_957, direction: "outflow", tolerance: { kind: "absolute", amountMinor: 100 } },
      { kind: "expected-date", daysBefore: 10, daysAfter: 3 },
      { kind: "bench-marker", value: "exclude" },
      { kind: "posting-link", value: "exclude" },
    ]);
    expect(saved.actions).toEqual({ format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] });
  });

  it("the generated rule is only an optional, read-only advanced view", async () => {
    mocked.getDebt.mockResolvedValue({ debt: { id: "debt-1", paymentAccountId: "acc-checking", liabilityAccountId: "acc-loan", signConvention: "negative-is-debt", driftToleranceMinor: 100, currency: "AUD", currencyMinorDigits: 2 }, config: { ok: true, config: { terms: { contractualPaymentMinor: 242_915 } } } } as never);
    mocked.listMatchRules.mockResolvedValue([]);
    wrap(<RulesView debtId="debt-1" />);
    const setUp = await screen.findByRole("button", { name: "Set up matching" });
    await waitFor(() => expect(setUp).toBeEnabled());
    fireEvent.click(setUp);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Generated matching rule")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Show the generated rule (advanced)" }));
    const pre = within(dialog).getByLabelText("Generated matching rule");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toContain('"rd084.debt-match-conditions"');
  });

  it("a draft rule can be enabled from the list, with a fresh backtest", async () => {
    const rule = {
      record: { id: "rule-1", debtId: "debt-1", purpose: "repayment", ruleFormatVersion: 1, conditionsJson: "{}", actionsJson: "{}", enabled: false, lastBacktestJson: null, lastBacktestAt: null, createdAt: "t", updatedAt: "t" },
      conditions: { format: "rd084.debt-match-conditions", version: 1, operator: "all", items: [{ kind: "source-account", accountId: "acc-checking" }, { kind: "expected-date", daysBefore: 10, daysAfter: 3 }, { kind: "bench-marker", value: "exclude" }, { kind: "posting-link", value: "exclude" }] },
      actions: { format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] },
      blocked: null,
    };
    mocked.getDebt.mockResolvedValue({ debt: { id: "debt-1", paymentAccountId: "acc-checking", liabilityAccountId: "acc-loan", signConvention: "negative-is-debt", driftToleranceMinor: 100, currency: "AED", currencyMinorDigits: 2 }, config: { ok: true, config: { terms: { contractualPaymentMinor: 837_957 } } } } as never);
    mocked.listMatchRules.mockResolvedValue([rule] as never);
    mocked.updateMatchRule.mockResolvedValue({} as never);
    wrap(<RulesView debtId="debt-1" />);
    expect(await screen.findByText(/Draft: not used by Proposed changes until enabled/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(mocked.updateMatchRule).toHaveBeenCalledTimes(1));
    const [, ruleId, value, backtest] = mocked.updateMatchRule.mock.calls[0];
    expect(ruleId).toBe("rule-1");
    expect(value).toMatchObject({ purpose: "repayment", enabled: true });
    expect(backtest).toMatchObject({ snapshots: [{ accountId: "acc-checking" }] });
  }, 15_000);

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
