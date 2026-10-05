import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DebtBacktestResult } from "@/lib/financial-models/matching";
import * as api from "../../lib/debtsApi";
import { BacktestResultsTable } from "./BacktestResultsTable";
import { MatchingCard } from "./MatchingCard";
import { MatchingEditor } from "./MatchingEditor";

jest.mock("../../lib/debtsApi", () => ({
  listDebts: jest.fn(), getDebt: jest.fn(), listMatchRules: jest.fn(), createMatchRule: jest.fn(),
  updateMatchRule: jest.fn(), deleteMatchRule: jest.fn(), runMatchBacktest: jest.fn(), getSchedule: jest.fn(), checkDraftMatchRule: jest.fn(),
}));
jest.mock("../../lib/useAccountDirectory", () => ({
  useAccountDirectory: () => ({ data: { budgetSyncId: "budget-1", accounts: [{ id: "acc-checking", name: "Everyday", closed: false, offBudget: false }], categories: [] } }),
}));
jest.mock("@/store/connection", () => ({
  useConnectionStore: (selector: (state: unknown) => unknown) => selector({}),
  selectActiveInstance: () => ({ id: "connection-1", budgetSyncId: "budget-1" }),
}));
jest.mock("@/lib/actual", () => ({ getTransport: () => ({ listTransactionsForSync: jest.fn(async () => []) }) }));
jest.mock("next/navigation", () => ({ usePathname: () => "/loans/debt-1" }));
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

const hsbc = {
  debt: { id: "debt-1", name: "Test HSBC", paymentAccountId: "acc-checking", liabilityAccountId: "acc-loan", signConvention: "negative-is-debt", driftToleranceMinor: 100, currency: "AED", currencyMinorDigits: 2, lenderPattern: "embedded-interest" },
  config: { ok: true, config: { terms: { contractualPaymentMinor: 837_957, openingDate: "2023-10-25" } } },
  blocked: null,
};
const checked = (statuses: Array<"missing" | "unique" | "multiple" | "unsafe">): DebtBacktestResult => ({
  format: "rd084.debt-backtest", version: 1, from: "2023-10-25", to: "2026-10-05", generatedAt: "2026-10-05T00:00:00.000Z",
  read: { accounts: 1, transactions: 3 }, strength: { strength: "strong", reasons: [] }, warnings: [],
  summary: { expectedPeriods: statuses.length, unique: statuses.filter((x) => x === "unique").length, missing: statuses.filter((x) => x === "missing").length, multiple: statuses.filter((x) => x === "multiple").length, unsafe: statuses.filter((x) => x === "unsafe").length },
  periods: statuses.map((x, i) => period(x, i)),
});
const draftRule = {
  record: { id: "rule-1", debtId: "debt-1", purpose: "repayment", ruleFormatVersion: 1, conditionsJson: "{}", actionsJson: "{}", enabled: false, lastBacktestJson: null, lastBacktestAt: null, createdAt: "t", updatedAt: "t" },
  conditions: { format: "rd084.debt-match-conditions", version: 1, operator: "all", items: [{ kind: "source-account", accountId: "acc-checking" }, { kind: "expected-date", daysBefore: 10, daysAfter: 3 }, { kind: "bench-marker", value: "exclude" }, { kind: "posting-link", value: "exclude" }] },
  actions: { format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] },
  blocked: null,
};

describe("Repayment matching on Settings (rev 2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.getDebt.mockResolvedValue(hsbc as never);
  });

  it("without a rule it is a clearly required step that opens the editor", async () => {
    mocked.listMatchRules.mockResolvedValue([]);
    const onEdit = jest.fn();
    wrap(<MatchingCard debtId="debt-1" onEdit={onEdit} />);
    expect(await screen.findByText("Required step")).toBeInTheDocument();
    expect(screen.getByText(/Until a rule is on, the Sync Repayments tab cannot propose any change/)).toBeInTheDocument();
    const setUp = screen.getByRole("button", { name: "Set up repayment matching" });
    await waitFor(() => expect(setUp).toBeEnabled());
    fireEvent.click(setUp);
    expect(onEdit).toHaveBeenCalledWith("new");
  });

  it("a rule reads in plain words; turning it on re-checks it over the loan's history", async () => {
    mocked.listMatchRules.mockResolvedValue([draftRule] as never);
    mocked.updateMatchRule.mockResolvedValue({} as never);
    wrap(<MatchingCard debtId="debt-1" onEdit={jest.fn()} />);
    expect(await screen.findByText("A payment in Everyday, from 10 days before to 3 after each due date")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.queryByText("Required step")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(mocked.updateMatchRule).toHaveBeenCalledTimes(1));
    const [, ruleId, value, backtest] = mocked.updateMatchRule.mock.calls[0];
    expect(ruleId).toBe("rule-1");
    expect(value).toMatchObject({ purpose: "repayment", enabled: true });
    expect(backtest).toMatchObject({ from: "2023-10-25", snapshots: [{ accountId: "acc-checking" }] });
  }, 15_000);
});

describe("The matching editor (rev 2)", () => {
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  beforeAll(() => Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 420 }));
  afterAll(() => {
    if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.getDebt.mockResolvedValue(hsbc as never);
    mocked.listMatchRules.mockResolvedValue([]);
  });

  it("suggests the HSBC rule as one sentence, checks it live, and saves it turned on: no JSON to edit", async () => {
    mocked.checkDraftMatchRule.mockResolvedValue(checked(["unique", "unique", "unique"]));
    mocked.createMatchRule.mockResolvedValue({} as never);
    const onClose = jest.fn();
    wrap(<MatchingEditor debtId="debt-1" ruleId="new" onClose={onClose} />);
    expect(await screen.findByRole("heading", { name: "Set up repayment matching" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Expected amount")).toHaveValue("8,379.57");
    expect(screen.getByLabelText("Amount tolerance")).toHaveValue("1.00");
    expect(screen.getByText("Suggested from your loan settings")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Days early"), { target: { value: "10" } });
    expect(await screen.findByText(/Ready to turn on/)).toBeInTheDocument();
    await waitFor(() => expect(mocked.checkDraftMatchRule).toHaveBeenCalled());
    const [, draft] = mocked.checkDraftMatchRule.mock.calls.at(-1)!;
    expect(draft.from).toBe("2023-10-25");
    expect(screen.queryByRole("textbox", { name: /DSL|JSON/i })).toBeNull();
    const turnOn = screen.getByRole("button", { name: "Save and turn on" });
    await waitFor(() => expect(turnOn).toBeEnabled());
    fireEvent.click(turnOn);
    await waitFor(() => expect(mocked.createMatchRule).toHaveBeenCalledTimes(1));
    const [, saved, enableBacktest] = mocked.createMatchRule.mock.calls[0];
    expect(saved).toMatchObject({ purpose: "repayment", enabled: true });
    expect(enableBacktest).toMatchObject({ snapshots: [{ accountId: "acc-checking", transactions: [] }] });
    expect((saved.conditions as { items: unknown[] }).items).toEqual([
      { kind: "source-account", accountId: "acc-checking" },
      { kind: "amount", operator: "approximate", amountMinor: 837_957, direction: "outflow", tolerance: { kind: "absolute", amountMinor: 100 } },
      { kind: "expected-date", daysBefore: 10, daysAfter: 3 },
      { kind: "bench-marker", value: "exclude" },
      { kind: "posting-link", value: "exclude" },
    ]);
    expect(onClose).toHaveBeenCalled();
  }, 15_000);

  it("a due date with no payment keeps Save and turn on disabled; saving without turning on still works", async () => {
    mocked.checkDraftMatchRule.mockResolvedValue(checked(["unique", "missing"]));
    mocked.createMatchRule.mockResolvedValue({} as never);
    wrap(<MatchingEditor debtId="debt-1" ruleId="new" onClose={jest.fn()} />);
    expect(await screen.findByText(/1 due date needs attention/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and turn on" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save without turning on" }));
    await waitFor(() => expect(mocked.createMatchRule).toHaveBeenCalledTimes(1));
    expect(mocked.createMatchRule.mock.calls[0][1]).toMatchObject({ enabled: false });
    expect(mocked.createMatchRule.mock.calls[0][2]).toBeUndefined();
  }, 15_000);

  it("more conditions and the generated rule are optional disclosures", async () => {
    mocked.checkDraftMatchRule.mockResolvedValue(checked(["unique"]));
    wrap(<MatchingEditor debtId="debt-1" ruleId="new" onClose={jest.fn()} />);
    const more = await screen.findByRole("button", { name: "More conditions (optional)" });
    expect(screen.queryByRole("region", { name: "More conditions" })).toBeNull();
    fireEvent.click(more);
    expect(screen.getByRole("region", { name: "More conditions" })).toBeInTheDocument();
    const pre = screen.getByLabelText("Generated matching rule");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toContain('"rd084.debt-match-conditions"');
  });
});

describe("Backtest results", () => {
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  beforeAll(() => Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 420 }));
  afterAll(() => {
    if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
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
