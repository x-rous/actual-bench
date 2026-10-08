import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import { createDebtConfiguration, getDebtDetail, type DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import { directory as fixtureDirectory, tempDebtDb } from "@/lib/assets-debt/testing/debtFixtures";
import * as api from "../lib/debtsApi";
import { createSyncRunner } from "../lib/projectionRunner";
import { newSimulation, newTracking, statesToSaveInput, type SimulationState, type TrackingState } from "../lib/simulatorModel";
import { DAILY_MONTHLY_CHARGE, offsetOf, project, sim } from "../lib/simulatorTestKit";
import { ProjectionRunnerContext } from "../lib/useLiveProjection";
import { DebtListView } from "./AssetsDebtViews";
import { DebtList, LoansSummary } from "./DebtList";
import { LoanView, NewLoanView } from "./LoanPages";
import { SAVE_BOUNDARY } from "./saveBoundary";
import { ScheduleTable } from "./simulator/ScheduleTable";
import { NOT_ADVICE, SimulatorView } from "./simulator/SimulatorView";
import { extraImpact } from "./simulator/ExtraTransactionsSection";
import { TrackingSetup } from "./tracking/TrackingSetup";
import { engineLine } from "../lib/strategyAdvice";

/**
 * The Assets & Debt workspace UI (RD-084 P1.3, P1.3b T204–T216, T219, T220).
 * Projections run on a synchronous runner here (jsdom has no Worker); the
 * chart is replaced by a stub because Recharts needs real layout.
 */

jest.mock("../lib/debtsApi", () => {
  const actual = jest.requireActual("../lib/debtsApi");
  return { ...actual, listDebts: jest.fn(async () => []), createDebt: jest.fn(), updateDebt: jest.fn(), getDebt: jest.fn(), archiveDebt: jest.fn(), listMatchRules: jest.fn(async () => []), getSchedule: jest.fn(), getLoanSummary: jest.fn(), listNeedsAttention: jest.fn(async () => []), listDebtObservations: jest.fn(async () => ({ observations: [], history: [] })), getDebtReconciliation: jest.fn() };
});
const mockDirectory: { current: AccountDirectory | undefined } = { current: undefined };
jest.mock("../lib/useAccountDirectory", () => ({
  useAccountDirectory: () => ({ data: mockDirectory.current, isLoading: false }),
  useActiveBudgetSyncId: () => "b1",
}));
let mockActiveBudgetSyncId = "b1";
jest.mock("@/store/connection", () => ({
  useConnectionStore: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({}) }),
  selectActiveInstance: () => ({ id: "c1", budgetSyncId: mockActiveBudgetSyncId }),
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/loans", useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useSearchParams: () => new URLSearchParams() }));
jest.mock("next/dynamic", () => () => function ChartStub({ visible }: { visible: string[] }) {
  return <div data-testid="chart" data-series={visible.join(",")} />;
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() } }));
jest.mock("../lib/postingsApi", () => ({ listPostings: jest.fn(async () => []), previewPostings: jest.fn(async () => ({ ok: true, postings: [], notices: [], driftMaterial: false })), declinePosting: jest.fn(), proposeReversal: jest.fn(), overrideSplit: jest.fn(), reproducePosting: jest.fn() }));

const mocked = api as jest.Mocked<typeof api>;
const WAIT = { timeout: 8000 };

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
  return { id: `d${i}`, name: `Loan ${i}`, debtType: "mortgage", behaviorClass: "term-loan", status: "active", currency: "AUD", currencyMinorDigits: 2, liabilityAccountId: `l${i}`, executionStrategy: "bench-daily", openingPrincipalMinor: 100_000, openingDate: null, annualRateDecimal: "0.05", signConvention: "negative-is-debt", currentRevision: 1, blocked: null, ...patch };
}

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

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={client}>
      <ProjectionRunnerContext.Provider value={createSyncRunner()}>{ui}</ProjectionRunnerContext.Provider>
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}

/** A stateful simulator, reporting every state it is given. */
function Harness({ initial, saved = null, onState }: { initial: SimulationState; saved?: SimulationState | null; onState?: (s: SimulationState) => void }) {
  const [state, setState] = useState(initial);
  return (
    <SimulatorView
      sim={state}
      saved={saved}
      onChange={(next) => {
        setState(next);
        onState?.(next);
      }}
      title="New loan"
      badge="Not saved: simulation only"
      revision={null}
      actions={null}
    />
  );
}

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const shortLoan = (patch: Partial<SimulationState> = {}) => sim({ termMonths: 36, principalMinor: 3_000_000, ...patch });
const periodicShortLoan = () => {
  const base = shortLoan();
  return { ...base, profile: { ...base.profile, accrual: "per-period" as const } };
};
const prompt = () => screen.queryByRole("dialog", { name: "This feature needs day-by-day interest calculation" });

it("describes extra-transaction impact without negative saved values", () => {
  const baseline = { regularRepaymentMinor: 100, repaymentChanges: false, totalRepaidMinor: 1_000, totalInterestMinor: 200, payoffDate: "2026-01-01", closingBalanceMinor: 0 };
  expect(extraImpact({ ...baseline, totalInterestMinor: 150, payoffDate: "2025-07-01" }, baseline, 2)).toMatch(/^Interest saved 0\.50 · Payoff time saved /);
  expect(extraImpact({ ...baseline, totalInterestMinor: 250, payoffDate: "2026-07-01" }, baseline, 2)).toMatch(/^Interest added 0\.50 · Payoff time added /);
  expect(extraImpact({ ...baseline, payoffDate: null }, baseline, 2)).toBe("No interest change · Payoff not reached with transactions");
});

describe("the Loans & Debt page (rev 4)", () => {
  withViewport();
  it("has no Assets & Debt tabs; a Needs attention filter counts the loans that need something, and such a row opens where it can be acted on", async () => {
    mocked.listDebts.mockResolvedValue([summary(1, { name: "HSBC" }), summary(2, { name: "Car" })]);
    mocked.listNeedsAttention.mockResolvedValue([{ subjectKind: "debt", id: "d1", name: "HSBC", filter: "action", reasons: [{ code: "review", count: 3 }] }]);
    wrap(<DebtListView />);
    expect(await screen.findByRole("button", { name: "Needs attention 1" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("navigation", { name: "Assets & Debt sections" })).toBeNull();
    const hsbc = await screen.findByRole("link", { name: /HSBC/ });
    expect(hsbc.closest('[role="row"]')).toHaveTextContent("3 changes to review");
    expect(hsbc).toHaveAttribute("href", "/loans/d1?view=repayments&filter=action");
    expect(screen.getByRole("link", { name: /Car/ })).toHaveAttribute("href", "/loans/d2");
  });
});

describe("Loans & Debt list", () => {
  withViewport();

  it("renders 1,000 debts with a bounded DOM", () => {
    wrap(<DebtList debts={Array.from({ length: 1000 }, (_, i) => summary(i))} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(60);
    expect(screen.getByRole("table", { name: "1000 debts" })).toBeInTheDocument();
  });

  it("labels the table columns and retains one navigable row per loan", () => {
    mockDirectory.current = DIRECTORY;
    wrap(<DebtList debts={[summary(1, { liabilityAccountId: "loan" }), summary(2, { status: "archived" }), summary(3, { paidOffOn: "2021-01-01" })]} />);
    const table = screen.getByRole("table", { name: "3 debts" });
    expect(table).toHaveAttribute("aria-rowcount", "4");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Loan", "Terms", "Outstanding", "Next payment", "Principal paid", "Interest", "Ends / Paid off", "Accounts", "Status"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    rows.forEach((row, index) => {
      expect(row).toHaveAttribute("aria-rowindex", String(index + 2));
      expect(within(row).getAllByRole("cell")).toHaveLength(9);
      expect(within(row).getAllByRole("link")).toHaveLength(1);
    });
    expect(rows[0]).toHaveTextContent("Home loan");
    expect(rows[0]).toHaveTextContent("Mortgage");
    expect(rows[0]).toHaveTextContent("5.00%");
    expect(rows[1]).toHaveTextContent("Archived");
    expect(rows[2]).toHaveTextContent("Paid off");
    mockDirectory.current = undefined;
  });

  it("shows a Blocked debt in words on its own row while the others stay usable", () => {
    wrap(<DebtList debts={[summary(1, { blocked: { code: "unsupported-config", message: "newer" } }), summary(2), summary(3, { status: "draft" })]} />);
    const [blocked, fine, draft] = screen.getAllByRole("row").slice(1);
    expect(blocked).toHaveTextContent("Blocked");
    expect(within(blocked).getByLabelText("Blocked: configured by a newer version of Actual Bench")).toBeInTheDocument();
    // Status is explicit on every row.
    expect(fine).not.toHaveTextContent("Blocked");
    expect(within(fine).getByRole("link")).toHaveAttribute("href", "/loans/d2");
    expect(draft).toHaveTextContent("Draft");
  });

  it("shows recorded history separately from the remaining forecast", async () => {
    mocked.getLoanSummary.mockResolvedValue({ ok: true, summary: { forecastFrom: "2020-01-01", paymentsMade: 2, totalPayments: 3, next: { date: "2999-04-01", amountMinor: 50_000 }, interestToDateMinor: 18_000, totalInterestMinor: 20_000, calculatedBalanceMinor: 20_000, payoffDate: "2999-04-01", regularRepaymentMinor: 50_000, dueSoonMinor: 0, dueSoonCount: 0 } });
    wrap(<DebtList debts={[summary(1, { openingDate: "2020-01-01", liabilityAccountId: null })]} />);
    const row = screen.getAllByRole("row")[1];
    await waitFor(() => expect(row).toHaveTextContent("2 recorded · 1 scheduled left"));
    const cells = within(row).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("500.00");
    expect(cells[3]).not.toHaveTextContent(/left|recorded|payments/);
    expect(cells[4]).toHaveTextContent("2 recorded · 1 scheduled left");
    expect(row).toHaveTextContent("200.00");
    expect(row).toHaveTextContent("(calculated)");
    expect(row).toHaveTextContent("180.00 recorded");
    expect(row).toHaveTextContent("Forecast from");
    expect(within(row).getByRole("progressbar", { name: "Principal paid for Loan 1" })).toBeInTheDocument();
  });

  it("keeps unavailable outstanding totals explicit while reporting a known upcoming schedule", async () => {
    mocked.getLoanSummary.mockResolvedValue({ ok: true, summary: { forecastFrom: "2020-01-01", paymentsMade: 0, totalPayments: 2, next: null, interestToDateMinor: 0, totalInterestMinor: 0, calculatedBalanceMinor: 60_000, payoffDate: null, regularRepaymentMinor: 50_000, dueSoonMinor: 50_000, dueSoonCount: 1 } });
    wrap(<LoansSummary debts={[summary(1, { openingDate: "2020-01-01", liabilityAccountId: null }), summary(2, { openingDate: "2020-01-01", liabilityAccountId: null }), summary(3, { paidOffOn: "2021-01-01" })]} />);
    const totals = screen.getByLabelText("All loans");
    expect(totals).toHaveTextContent("Active loans2");
    await waitFor(() => expect(totals).toHaveTextContent("Due in the next 30 days1,000.00(2 repayments)"));
    expect(totals).toHaveTextContent("OwedUnavailable");
  });

  it("says what each loan needs, in words, next to its status", () => {
    wrap(<DebtList debts={[summary(1), summary(2)]} attention={{ d1: "31 changes to review" }} />);
    const [first, second] = screen.getAllByRole("row").slice(1);
    expect(first).toHaveTextContent("31 changes to review");
    expect(second).not.toHaveTextContent("to review");
  });
});

describe("the simulator workspace", () => {
  withViewport();
  beforeEach(() => jest.clearAllMocks());

  it("opens with the sample loan and shows the four headline figures, chart and schedule without reading Actual", async () => {
    wrap(<Harness initial={newSimulation({ currency: "AUD", today: "2024-01-01" })} />);
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    expect(screen.getByLabelText("Frequency")).toBeInTheDocument();
    expect(screen.getByLabelText("Loan amount")).toHaveValue("500,000");
    expect(screen.getByLabelText("Years")).toHaveValue("20");
    expect(screen.getByLabelText("Interest rate")).toHaveValue("5.4");

    const results = screen.getByTestId("results-region");
    await waitFor(() => expect(within(results).getByText("Total interest").nextSibling).not.toHaveTextContent("–"), WAIT);
    for (const tile of ["Monthly repayment", "Total repayments", "Total interest", "Payoff date"]) expect(within(results).getByText(tile)).toBeInTheDocument();
    const repaymentLabel = within(results).getByText("Monthly repayment");
    expect(repaymentLabel).not.toHaveClass("uppercase");
    expect(repaymentLabel.nextSibling).toHaveClass("text-2xl", "tabular-nums");
    expect(repaymentLabel.nextElementSibling?.querySelector(".text-base")).toHaveTextContent(/^\.\d{2}$/);
    for (const label of ["Total repayments", "Total interest"]) {
      expect(within(results).getByText(label).nextElementSibling?.querySelector(".text-base")).toHaveTextContent(/^\.\d{2}$/);
    }
    expect(within(results).getByText("Payoff date").nextSibling).toHaveTextContent(/^\d{2} [A-Z][a-z]{2} \d{4}$/);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(within(screen.getByTestId("schedule-region")).getByRole("table", { name: /Schedule/ })).toBeInTheDocument();
    expect(screen.queryByTestId("events-impact")).toBeNull();

    // Nothing Actual-specific is asked for, and nothing was saved or read.
    for (const word of [/Loan account/, /Repayments come from/, /category/i, /lender/i, /strategy/i, /drift/i, /^Name$/]) expect(screen.queryByLabelText(word)).toBeNull();
    expect(mocked.createDebt).not.toHaveBeenCalled();
    expect(mocked.updateDebt).not.toHaveBeenCalled();
  });

  it("keeps events and the schedule beneath the chart in the right results column", async () => {
    wrap(<Harness initial={shortLoan()} />);
    const rail = screen.getByTestId("control-rail");
    expect(rail.className).toContain("lg:w-[396px]");
    expect(rail.className).not.toContain("rounded");
    // No divider between inputs and results (rev 4): the inputs are a tinted column of white cards.
    expect(rail.className).not.toContain("lg:border-r");
    expect(rail.className).toContain("bg-muted/40");
    expect(rail).toHaveAttribute("aria-label", "Loan inputs");
    const results = screen.getByTestId("results-region");
    expect(results.className).toContain("flex-1");
    // Rail and results share a row; the lower modelling surfaces stay in results, never under the rail.
    expect(rail.parentElement).toBe(results.parentElement);
    const schedule = await screen.findByTestId("schedule-region", undefined, WAIT);
    expect(results).toContainElement(schedule);
    expect(rail).not.toContainElement(schedule);
    expect(results).toContainElement(screen.getByRole("region", { name: "Events" }));
    expect(screen.getByTestId("not-advice")).toHaveTextContent(NOT_ADVICE);
    // No tab switching between inputs and results.
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("shows rate periods with transaction events and opens the shared rate editor from both surfaces", async () => {
    const states: SimulationState[] = [];
    const base = shortLoan();
    const initial = {
      ...base,
      rates: [...base.rates, { ...base.rates[0], key: "r2", accrualEffectiveFrom: "2024-03-01", annualRateDecimal: "0.07" }],
      assumptions: [{ key: "extra", kind: "extra-repayment" as const, effectiveFrom: "2024-04-01", recurrence: null, amountMinor: 50_000, feeTreatment: null, offsetAccountId: null, note: "Bonus" }],
    };
    wrap(<Harness initial={initial} onState={(state) => states.push(state)} />);

    const events = await screen.findByRole("region", { name: "Events" }, WAIT);
    expect(within(events).queryByRole("button", { name: "Set absolute offset balance" })).toBeNull();
    const heading = within(events).getByRole("heading", { name: "Events" });
    const description = within(events).getByText("Additional payments, deposits, withdrawals, fees, rates, loan, and offset changes.");
    expect(heading.parentElement).toContainElement(description);
    for (const action of ["Extra payment", "Redraw / Withdraw", "Rate change"]) expect(within(events).getByRole("button", { name: action })).toBeInTheDocument();
    expect(within(events).queryByRole("button", { name: "Fee" })).toBeNull();
    expect(within(events).getByRole("button", { name: "Add event" })).toHaveClass("md:hidden");
    expect(within(events).getByRole("button", { name: "Extra payment" }).parentElement).toHaveClass("hidden", "md:flex");
    fireEvent.click(within(events).getByRole("button", { name: "More" }));
    expect(await screen.findByRole("menuitem", { name: "Fee" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Repayment change" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Fee" }), { key: "Escape" });
    const table = await within(events).findByRole("table", { name: "Events" }, WAIT);
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent(/01 Mar 2024\s*Rate change\s*6% → 7%/);
    expect(rows[2]).toHaveTextContent(/01 Apr 2024\s*Extra payment\s*500\.00/);
    expect(within(events).queryByText(/Contractual rate changes remain included/)).toBeNull();
    fireEvent.click(within(events).getByRole("button", { name: "About Event impact comparison" }));
    expect(await screen.findByRole("dialog", { name: "Event impact comparison" })).toHaveTextContent(/Contractual rate changes remain in both/);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Event impact comparison" }), { key: "Escape" });

    const interest = screen.getByRole("group", { name: "Interest Rate" });
    fireEvent.click(within(interest).getByRole("button", { name: /Rate changes/ }));
    const rateList = await screen.findByRole("dialog", { name: "Rate changes" });
    expect(rateList).toHaveTextContent(/2024-03-01\s*7% p\.a\./);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    fireEvent.click(within(events).getByRole("button", { name: "Rate change" }));
    expect(await screen.findByRole("dialog", { name: "Rate change" })).toBeInTheDocument();
    expect(screen.getByLabelText("New rate (per year)")).toHaveValue("6");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Rate change" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rate change" })).toBeNull());

    fireEvent.click(within(events).getByRole("button", { name: "Edit rate change on 2024-03-01" }));
    expect(await screen.findByLabelText("New rate (per year)")).toHaveValue("7");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Rate change" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rate change" })).toBeNull());
    fireEvent.click(within(events).getByRole("button", { name: "Remove rate change on 2024-03-01" }));
    await waitFor(() => expect(states.at(-1)?.rates).toHaveLength(1), WAIT);
  }, 15_000);

  it("routes unified payment and withdrawal actions to the active offset account and restores them after re-enabling it", async () => {
    const states: SimulationState[] = [];
    const offset = offsetOf(100_000);
    wrap(<Harness initial={shortLoan(offset)} onState={(state) => states.push(state)} />);

    const events = await screen.findByRole("region", { name: "Events" }, WAIT);
    expect(within(events).queryByRole("button", { name: "Set absolute offset balance" })).toBeNull();
    fireEvent.click(within(events).getByRole("button", { name: "Extra payment" }));
    let dialog = await screen.findByRole("dialog", { name: "Extra payment" });
    const destination = within(dialog).getByRole("combobox", { name: "Destination" });
    fireEvent.click(destination);
    const offsetDestination = screen.getByRole("option", { name: "Offset account" });
    fireEvent.pointerDown(offsetDestination, { pointerType: "mouse" });
    fireEvent.pointerUp(offsetDestination, { pointerType: "mouse" });
    fireEvent.mouseUp(offsetDestination, { button: 0 });
    fireEvent.click(offsetDestination);
    const depositAmount = await within(dialog).findByLabelText("Deposit amount", undefined, WAIT);
    fireEvent.change(depositAmount, { target: { value: "50" } });
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2024-02-10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save event" }));
    await waitFor(() => expect(states.at(-1)?.assumptions.at(-1)).toMatchObject({
      kind: "offset-deposit",
      amountMinor: 5_000,
      offsetAccountId: offset.offsets[0].placeholderAccountId,
    }), WAIT);

    fireEvent.click(within(events).getByRole("button", { name: "Redraw / Withdraw" }));
    dialog = await screen.findByRole("dialog", { name: "Redraw / withdrawal" });
    const source = within(dialog).getByRole("combobox", { name: "Source" });
    fireEvent.click(source);
    const offsetSource = screen.getByRole("option", { name: "Offset account" });
    fireEvent.pointerDown(offsetSource, { pointerType: "mouse" });
    fireEvent.pointerUp(offsetSource, { pointerType: "mouse" });
    fireEvent.mouseUp(offsetSource, { button: 0 });
    fireEvent.click(offsetSource);
    const withdrawalAmount = await within(dialog).findByLabelText("Withdrawal amount", undefined, WAIT);
    fireEvent.change(withdrawalAmount, { target: { value: "25" } });
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2024-03-10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save event" }));
    await waitFor(() => expect(states.at(-1)?.assumptions.at(-1)).toMatchObject({
      kind: "offset-withdrawal",
      amountMinor: 2_500,
      offsetAccountId: offset.offsets[0].placeholderAccountId,
    }), WAIT);

    const table = await within(events).findByRole("table", { name: "Events" }, WAIT);
    expect(within(table).getByText("Offset deposit")).toBeInTheDocument();
    expect(within(table).getByText("Offset withdrawal")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: /Offset account/ }));
    await waitFor(() => expect(states.at(-1)?.offsets).toEqual([]), WAIT);
    expect(states.at(-1)?.assumptions.some((assumption) => assumption.kind.startsWith("offset-"))).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: /Offset account/ }));
    await waitFor(() => expect(states.at(-1)?.assumptions.filter((assumption) => assumption.kind.startsWith("offset-")).map((assumption) => assumption.kind)).toEqual([
      "offset-balance",
      "offset-deposit",
      "offset-withdrawal",
    ]), WAIT);
  }, 20_000);

  it("announces one settled summary per recalculation, not every keystroke", async () => {
    wrap(<Harness initial={shortLoan()} />);
    const live = document.querySelector("[aria-live=polite]")!;
    await waitFor(() => expect(live.textContent).toMatch(/^repayment .* monthly; total repayments .*; total interest .*; paid off 01 Jan 2027\.$/), WAIT);
    const before = live.textContent;
    type("Loan amount", "31");
    type("Loan amount", "310");
    type("Loan amount", "3100");
    // While calculating nothing new is announced; the tiles themselves are not live.
    expect(live.textContent === before || live.textContent === "").toBe(true);
    expect(screen.getByText("Total interest").closest("[aria-live]")).toBeNull();
    await waitFor(() => expect(live.textContent).toMatch(/total interest/), WAIT);
    expect(live.textContent).not.toBe(before);
  });

  it("ties validation to inputs, formats amounts without cursor jumping, and has no rate slider", async () => {
    wrap(<Harness initial={shortLoan()} />);
    // A person focuses a field before typing; while focused it keeps what was typed.
    const amount = screen.getByLabelText("Loan amount");
    fireEvent.focus(amount);
    type("Loan amount", "12x");
    expect(amount).toHaveAttribute("aria-invalid", "true");
    const message = document.getElementById(amount.getAttribute("aria-describedby")!.split(" ").at(-1)!);
    expect(message).toHaveTextContent(/amount/i);
    fireEvent.focus(screen.getByLabelText("Years"));
    type("Years", "-1");
    expect(screen.getByLabelText("Years")).toHaveAccessibleDescription("Enter a whole number of at least 0");

    fireEvent.focus(amount);
    type("Loan amount", "20000.00");
    expect(amount).toHaveValue("20000.00");
    fireEvent.blur(amount);
    expect(amount).toHaveValue("20,000.00");
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByLabelText("Interest rate")).toHaveValue("6");
  });

  it("the chart has a text alternative, keyboard-operable series and detail switches", async () => {
    wrap(<Harness initial={shortLoan()} />);
    await screen.findByTestId("chart", undefined, WAIT);
    expect(screen.getByText(/Loan balance from .* ending at/)).toHaveClass("sr-only");
    fireEvent.click(screen.getByRole("button", { name: "About Balance chart help" }));
    expect(await screen.findByRole("dialog", { name: "Balance chart help" })).toHaveTextContent(/Loan balance from .* ending at/);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Balance chart help" }), { key: "Escape" });
    const chip = screen.getByRole("button", { name: /Loan balance/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("chart").dataset.series).not.toContain("balance");
    const detail = screen.getByRole("radiogroup", { name: "Chart detail" });
    fireEvent.click(within(detail).getByRole("radio", { name: "Monthly" }));
    expect(within(detail).getByRole("radio", { name: "Monthly" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("group", { name: /Loan balance chart/ })).toBeInTheDocument();
  });

  it("Events: the add buttons sit on the heading line, and an empty loan says it has no events yet", async () => {
    wrap(<Harness initial={shortLoan()} />);
    const heading = await screen.findByRole("heading", { name: "Events" }, WAIT);
    expect(heading.parentElement).toContainElement(screen.getByRole("group", { name: "Add an event" }));
    expect(await screen.findByText("No extra payments, redraws or rate changes yet.", undefined, WAIT)).toBeInTheDocument();
  });

  it("uses accessible switches, hides disabled feature controls, and exposes the calculation drawer", async () => {
    wrap(<Harness initial={shortLoan()} />);
    const permanent = ["Loan", "Interest Rate", "Repayments"].map((name) => screen.getByRole("group", { name }));
    for (const section of permanent) expect(section).toHaveClass("rounded-lg", "border");
    const optional = ["Interest-only periods", "Balloon payment", "Offset account", "Fees and other costs"].map((name) => screen.getByRole("group", { name }));
    // Switched off, each option is a light card row (not a full group) that stays visible.
    for (const section of optional) expect({ tag: section.tagName, light: section.classList.contains("bg-background") }).toEqual({ tag: "DIV", light: true });
    for (const name of ["Loan", "Interest Rate", "Repayments", "Interest-only periods", "Balloon payment", "Offset account", "Fees and other costs"]) {
      expect(screen.getByRole("button", { name: `About ${name} help` })).toBeInTheDocument();
    }
    const ordered = [...permanent, ...optional];
    for (let index = 1; index < ordered.length; index++) expect(ordered[index - 1].compareDocumentPosition(ordered[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const label of ["Interest-only periods", "Balloon payment", "Offset account", "Fees and other costs"]) {
      const control = screen.getByRole("switch", { name: new RegExp(label) });
      expect(control).toHaveAttribute("aria-checked", "false");
      expect(control).toHaveAttribute("tabindex", "0");
    }
    expect(screen.queryByRole("switch", { name: /Choose first repayment date/ })).toBeNull();
    expect(screen.getByLabelText("First repayment date (optional)")).toHaveValue("");
    expect(screen.queryByLabelText("Contract term")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: /Interest-only periods/ }));
    const interestOnly = screen.getByRole("group", { name: "Interest-only periods" });
    expect(interestOnly).toHaveClass("rounded-lg", "border");
    expect(within(interestOnly).queryByLabelText("Interest-only for")).toBeNull();
    expect(within(interestOnly).getByRole("button", { name: "Edit periods" })).toBeInTheDocument();
    fireEvent.click(within(interestOnly).getByRole("button", { name: "Edit periods" }));
    expect(await screen.findByLabelText("At the end")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Interest-only periods" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("switch", { name: /Balloon payment/ }));
    expect(screen.getByRole("group", { name: "Balloon payment" })).toHaveClass("rounded-lg", "border");
    expect(screen.getByLabelText("Contract term")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "About Loan help" }));
    const help = await screen.findByRole("dialog", { name: "Loan help" });
    expect(help).toHaveTextContent(/Loan type.*Loan amount.*Years and months.*Start date/);
    fireEvent.keyDown(help, { key: "Escape" });

    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "How this loan is calculated" }));
    const explanation = await screen.findByRole("dialog", { name: "How this loan is calculated" });
    expect(explanation).toHaveStyle({ width: "min(806px, 92vw)", maxWidth: "none" });
    fireEvent.keyDown(explanation, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "How this loan is calculated" })).toBeNull());

    const interestRate = screen.getByRole("group", { name: "Interest Rate" });
    fireEvent.click(within(interestRate).getByRole("button", { name: "Open calculation method settings" }));
    const drawer = await screen.findByRole("dialog", { name: "Calculation method" });
    expect(drawer).toHaveAttribute("data-side", "left");
    expect(drawer).toHaveStyle({ width: "min(615px, 92vw)", maxWidth: "none" });
    expect(drawer.className).toContain("overflow-x-hidden");
    const overlay = document.querySelector('[data-slot="sheet-overlay"]');
    expect(overlay).toHaveClass("bg-transparent", "supports-backdrop-filter:backdrop-blur-none");
    expect(within(drawer).queryByText(/Most loans never need these/i)).toBeNull();
    expect(within(drawer).queryByText(/not any particular lender/i)).toBeNull();
    expect(within(drawer).getByText("A preset describes a calculation shape.")).toBeInTheDocument();
    const interestSection = within(drawer).getByRole("group", { name: "Interest" });
    expect(within(interestSection).getByRole("button", { name: "More about interest calculation fields" })).toBeInTheDocument();
    expect(within(interestSection).getByLabelText("Rate quoted as")).toBeInTheDocument();
    expect(within(interestSection).getByLabelText("Transactions on the same day as interest")).toBeInTheDocument();
    const repaymentSection = within(drawer).getByRole("group", { name: "Repayment" });
    expect(within(repaymentSection).getByRole("button", { name: "More about repayment calculation fields" })).toBeInTheDocument();
    expect(within(repaymentSection).getByLabelText("Repayment amount")).toBeInTheDocument();
    expect(within(repaymentSection).getByLabelText("Final repayment (end of loan)")).toBeInTheDocument();
    expect(within(repaymentSection).queryByText("End of the loan")).toBeNull();
    const precisionSection = within(drawer).getByRole("group", { name: "Precision and rounding" });
    expect(within(precisionSection).getByRole("button", { name: "More about precision and rounding fields" })).toBeInTheDocument();
    expect(precisionSection).toHaveClass("lg:col-span-2", "border");
    expect(within(drawer).getByLabelText("Amount decimal places")).toBeInTheDocument();
    expect(within(drawer).queryByText(/Currency decimal places/i)).toBeNull();
  });

  it("preserves an existing first-repayment override and restores automatic date semantics when cleared", async () => {
    const states: SimulationState[] = [];
    wrap(<Harness initial={{ ...shortLoan(), firstPaymentDate: "2024-02-15" }} onState={(state) => states.push(state)} />);
    const field = screen.getByLabelText("First repayment date (optional)");
    expect(field).not.toHaveValue("");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    await waitFor(() => expect(states.at(-1)?.firstPaymentDate).toBeNull(), WAIT);
    expect(screen.getByLabelText("First repayment date (optional)")).toHaveValue("");
  });

  it("summarizes recurring cash-paid and capitalized costs without conflating them", () => {
    wrap(<Harness initial={shortLoan({ components: [
      { key: "cash", economicKind: "insurance", amountRule: "fixed", fixedAmountMinor: 1_250, treatment: null },
      { key: "loan", economicKind: "fee", amountRule: "fixed", fixedAmountMinor: 500, treatment: "capitalized" },
    ] })} />);
    const fees = screen.getByRole("group", { name: "Fees and other costs" });
    expect(fees).toHaveClass("rounded-lg", "border");
    expect(fees).toHaveTextContent(/2 recurring costs/);
    expect(fees).toHaveTextContent(/12\.50 paid each repayment/);
    expect(fees).toHaveTextContent(/5\.00 added to the loan each repayment/);
    expect(within(fees).getByRole("button", { name: "Manage costs" })).toBeInTheDocument();
  });

  it("shows no currency markers and confirms before resetting changed inputs to the sample loan", async () => {
    wrap(<Harness initial={newSimulation({ currency: "AUD", today: "2026-10-01" })} />);
    await screen.findByTestId("schedule-region", undefined, WAIT);
    expect(document.body).not.toHaveTextContent(/\bAUD\b|\bAED\b|\bUSD\b|\$/);
    type("Loan amount", "12345");
    fireEvent.click(screen.getByRole("button", { name: "More schedule actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reset loan" }));
    const confirm = await screen.findByRole("dialog", { name: "Reset this loan?" });
    expect(confirm).toHaveTextContent(/discards the current simulation inputs/i);
    fireEvent.click(within(confirm).getByRole("button", { name: "Reset loan" }));
    expect(screen.getByLabelText("Loan amount")).toHaveValue("500,000");
    expect(screen.getByLabelText("Years")).toHaveValue("20");
    expect(screen.getByLabelText("Interest rate")).toHaveValue("5.4");
  });
});

describe("O1: features that need day-by-day interest", () => {
  withViewport();

  it("an offset under the period-by-period method asks first; Cancel leaves the loan unchanged", async () => {
    const states: SimulationState[] = [];
    const initial = periodicShortLoan();
    wrap(<Harness initial={initial} onState={(s) => states.push(s)} />);
    fireEvent.click(screen.getByRole("switch", { name: /Offset account/ }));
    const dialog = await screen.findByRole("dialog", { name: "This feature needs day-by-day interest calculation" });
    expect(dialog).toHaveTextContent(/offset/i);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(states).toEqual([]);
    expect(screen.getByRole("switch", { name: /Offset account/ })).not.toBeChecked();
    expect(screen.queryByLabelText("Offset account starting balance")).toBeNull();
  });

  it("Escape also cancels the prompt", async () => {
    const states: SimulationState[] = [];
    wrap(<Harness initial={periodicShortLoan()} onState={(s) => states.push(s)} />);
    fireEvent.click(screen.getByRole("switch", { name: /Offset account/ }));
    const dialog = await screen.findByRole("dialog", { name: "This feature needs day-by-day interest calculation" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(prompt()).toBeNull());
    expect(states).toEqual([]);
  });

  it("accepting switches only the interest method, keeps every value, and recalculates", async () => {
    const states: SimulationState[] = [];
    const initial = periodicShortLoan();
    wrap(<Harness initial={initial} onState={(s) => states.push(s)} />);
    fireEvent.click(screen.getByRole("switch", { name: /Offset account/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Switch to day-by-day" }));
    await waitFor(() => expect(states).toHaveLength(1));
    const [next] = states;
    expect(next.profile).toMatchObject({ accrual: "daily-simple", capitalization: "at-charge", presetId: null });
    expect(next.offsets).toHaveLength(1);
    expect({ ...next, profile: null, offsets: [], assumptions: [] }).toEqual({ ...initial, profile: null, offsets: [], assumptions: [] });
    expect(project(next).ok).toBe(true);
    expect(await screen.findByLabelText("Offset account starting balance")).toBeInTheDocument();
    expect(screen.queryByText("Enter the starting balance of your offset account.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About Offset account help" }));
    expect(await screen.findByRole("dialog", { name: "Offset account help" })).toHaveTextContent(/opening simulated offset balance/);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Offset account help" }), { key: "Escape" });
    // The Calculation method summary follows the switch.
    expect(screen.getByText(/Daily interest · Level payment/)).toBeInTheDocument();
    expect(mocked.createDebt).not.toHaveBeenCalled();
    expect(mocked.updateDebt).not.toHaveBeenCalled();
  });

  it("enables simulated offset funding and labels the multiple-account source selector", async () => {
    const states: SimulationState[] = [];
    const offset = offsetOf(2_000_000);
    const initial = sim({ ...offset, profile: { ...sim().profile, ...DAILY_MONTHLY_CHARGE } });
    const firstRender = wrap(<Harness initial={initial} onState={(s) => states.push(s)} />);
    const funding = screen.getByRole("switch", { name: /Draw scheduled repayments from offset/ });
    expect(funding).not.toBeChecked();
    expect(screen.queryByText(/Simulation only.*does not create, move, or match transactions in Actual/)).toBeNull();
    expect(screen.queryByLabelText("Offset start date")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced offset settings" }));
    expect(screen.getByLabelText("Offset start date")).toBeInTheDocument();
    expect(screen.getByLabelText("Offset end date (optional)")).toBeInTheDocument();
    fireEvent.click(funding);
    await waitFor(() => expect(states.at(-1)?.offsets[0].fundScheduledRepayments).toBe(true));
    const fundingStart = await screen.findByLabelText("Start drawing from (optional)");
    fireEvent.change(fundingStart, { target: { value: "2024-02-15" } });
    fireEvent.keyDown(fundingStart, { key: "Enter" });
    await waitFor(() => expect(states.at(-1)?.offsets[0].fundScheduledRepaymentsFrom).toBe("2024-02-15"));
    expect(screen.getByText(/First eligible funded repayment: 2024-03-01/)).toBeInTheDocument();
    firstRender.unmount();

    const second = { ...initial.offsets[0], key: "offset-2", placeholderAccountId: "offset-2", fundScheduledRepayments: false };
    wrap(<Harness initial={{ ...initial, offsets: [...initial.offsets, second] }} />);
    expect(screen.getByLabelText("Scheduled repayment funding account")).toBeInTheDocument();
  });

  it("an extra repayment between repayment dates asks; one on a repayment date does not", async () => {
    const states: SimulationState[] = [];
    wrap(<Harness initial={periodicShortLoan()} onState={(s) => states.push(s)} />);
    const addExtra = async (date: string) => {
      fireEvent.click(await screen.findByRole("button", { name: "Extra payment" }, WAIT));
      const dialog = await screen.findByRole("dialog", { name: "Extra payment" });
      fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "500" } });
      const field = within(dialog).getByLabelText("Date");
      fireEvent.change(field, { target: { value: date } });
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Save event" }));
    };
    await addExtra("2024-06-01");
    await waitFor(() => expect(states).toHaveLength(1));
    expect(prompt()).toBeNull();
    const transactions = await screen.findByRole("table", { name: "Events" }, WAIT);
    expect(within(transactions).getByText("500.00")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("events-impact")).not.toHaveTextContent(/calculating/i), WAIT);
    expect(within(screen.getByTestId("events-impact")).getByText("Interest saved")).toBeInTheDocument();
    expect(within(screen.getByTestId("events-impact")).getByText("83.57")).toBeInTheDocument();
    expect(within(screen.getByTestId("events-impact")).getByText("Payoff time unchanged")).toBeInTheDocument();
    expect(within(screen.getByTestId("events-impact")).getByText("No change")).toBeInTheDocument();
    expect(screen.queryByText(/Contractual rate changes remain included/)).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Extra repayment" })).toBeNull());

    await addExtra("2024-06-15");
    expect(await screen.findByRole("dialog", { name: "This feature needs day-by-day interest calculation" })).toHaveTextContent(/between repayment dates/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(states).toHaveLength(1);
  }, 15_000);

  it("a rate change part-way through a period asks; compatible features do not", async () => {
    const states: SimulationState[] = [];
    wrap(<Harness initial={periodicShortLoan()} onState={(s) => states.push(s)} />);
    fireEvent.click(screen.getByRole("switch", { name: /Fees and other costs/ }));
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("switch", { name: /Interest-only period/ }));
    expect(prompt()).toBeNull();
    const accepted = states.length;
    expect(accepted).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: /Rate changes/ }));
    const dialog = await screen.findByRole("dialog", { name: "Rate changes" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Add a rate change/ }));
    const field = screen.getByLabelText("Starts accruing");
    fireEvent.change(field, { target: { value: "2024-03-15" } });
    fireEvent.keyDown(field, { key: "Enter" });
    type("New rate (per year)", "7");
    fireEvent.click(screen.getByRole("button", { name: "Save rate change" }));
    expect(await screen.findByRole("dialog", { name: "This feature needs day-by-day interest calculation" })).toHaveTextContent(/part-way through/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(states).toHaveLength(accepted);
  });
});

describe("contract terms and lender-stated repayment", () => {
  withViewport();

  it("uses the optional contractual repayment and preserves an ordinary-loan maturity", async () => {
    const states: SimulationState[] = [];
    wrap(<Harness initial={shortLoan()} onState={(s) => states.push(s)} />);
    expect(screen.getByLabelText("Contract maturity date (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Contract repayment amount (optional)")).toBeInTheDocument();

    type("Contract maturity date (optional)", "2027-11-01");
    fireEvent.keyDown(screen.getByLabelText("Contract maturity date (optional)"), { key: "Enter" });
    type("Contract repayment amount (optional)", "8379.57");
    await waitFor(() => expect(states.at(-1)?.contractualPaymentMinor).toBe(837_957), WAIT);
    expect(states.at(-1)?.maturityDate).toBe("2027-11-01");
    expect(states.at(-1)?.profile.repaymentDerivation).toBe("contractual-fixed");
    expect(screen.getByText(/contract's fixed payment/)).toBeInTheDocument();

    type("Contract repayment amount (optional)", "");
    await waitFor(() => expect(states.at(-1)?.contractualPaymentMinor).toBeNull(), WAIT);
    expect(states.at(-1)?.profile.repaymentDerivation).toBe("annuity-at-payment-frequency");
  });
});

describe("the schedule (O2 rate column, O5 labels)", () => {
  withViewport();
  const eventsOf = (s: SimulationState) => {
    const p = project(s);
    if (!p.ok) throw new Error("blocked");
    return p.events;
  };
  const headers = () => screen.getAllByRole("columnheader").map((h) => h.textContent);

  it("says Principal when interest is part of each repayment, with no Rate column for one rate", () => {
    const s = shortLoan();
    render(<ScheduleTable events={eventsOf(s)} profile={s.profile} startDate={s.startDate} digits={2} />);
    expect(headers()).toEqual(["Payment #", "Period", "Payment", "Principal", "Interest", "Balance"]);
    expect(screen.getAllByRole("cell").some((cell) => cell.textContent === "1")).toBe(true);
    expect(screen.getByText("Yr 1, Mo 2 · Feb 2024")).toBeInTheDocument();
    expect(screen.queryByText(/Interest is charged separately/)).toBeNull();
  });

  it("says Debt reduction, with help, when interest is charged separately; interest charges are their own events", () => {
    const s = shortLoan({ profile: { ...shortLoan().profile, ...DAILY_MONTHLY_CHARGE } });
    render(<ScheduleTable events={eventsOf(s)} profile={s.profile} startDate={s.startDate} digits={2} />);
    expect(headers()).toContain("Debt reduction");
    expect(headers()).not.toContain("Principal");
    expect(screen.queryByText(/Interest is charged separately, so repayments reduce the outstanding loan balance/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About Amortization schedule help" }));
    expect(screen.getByRole("dialog", { name: "Amortization schedule help" })).toHaveTextContent(/Interest is charged separately, so repayments reduce the outstanding loan balance/);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Amortization schedule help" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("radio", { name: "All events" }));
    expect(headers()).toContain("Debt reduction");
    expect(screen.getAllByText("Interest charged").length).toBeGreaterThan(0);
  });

  it("shows the engine's rate, and Multiple for a month with a mid-month change", () => {
    const base = shortLoan({ profile: { ...shortLoan().profile, ...DAILY_MONTHLY_CHARGE } });
    const s = { ...base, rates: [...base.rates, { ...base.rates[0], key: "r2", accrualEffectiveFrom: "2024-03-15", annualRateDecimal: "0.07" }] };
    render(<ScheduleTable events={eventsOf(s)} profile={s.profile} startDate={s.startDate} digits={2} />);
    expect(headers()).toContain("Rate");
    const rows = screen.getAllByRole("row").slice(1);
    const cellsOf = (period: RegExp) => within(rows.find((r) => within(r).queryByText(period))!).getAllByRole("cell").map((c) => c.textContent);
    const rateAt = headers().indexOf("Rate");
    expect(cellsOf(/Feb 2024/)[rateAt]).toBe("6%");
    expect(cellsOf(/Apr 2024/)[rateAt]).toBe("Multiple");
    expect(cellsOf(/Jun 2024/)[rateAt]).toBe("7%");
  });

  it("keeps wide dynamic schedules inside one opaque sticky-header scroll container in every view", () => {
    const offset = offsetOf(2_000_000);
    offset.offsets[0].fundScheduledRepayments = true;
    const base = shortLoan({
      ...offset,
      profile: { ...shortLoan().profile, ...DAILY_MONTHLY_CHARGE, finalPayment: "contractual-balloon" },
      contractTermMonths: 24,
      components: [{ key: "fee", economicKind: "fee", amountRule: "fixed", fixedAmountMinor: 1_000, treatment: "cash-paid" }],
      assumptions: [
        ...offset.assumptions,
        { key: "extra", kind: "extra-repayment", effectiveFrom: "2024-03-01", recurrence: null, amountMinor: 10_000, feeTreatment: null, offsetAccountId: null, note: null },
        { key: "draw", kind: "draw", effectiveFrom: "2024-04-01", recurrence: null, amountMinor: 5_000, feeTreatment: null, offsetAccountId: null, note: null },
      ],
      rates: [...shortLoan().rates, { ...shortLoan().rates[0], key: "r2", accrualEffectiveFrom: "2024-03-15", annualRateDecimal: "0.07" }],
    });
    render(<ScheduleTable events={eventsOf(base)} profile={base.profile} startDate={base.startDate} digits={2} />);

    const scroll = screen.getByTestId("schedule-scroll-container");
    expect(scroll).toHaveClass("overflow-auto");
    expect(scroll.parentElement).toHaveClass("overflow-hidden");
    const headerGroup = screen.getAllByRole("rowgroup")[0];
    expect(headerGroup).toHaveClass("sticky", "bg-muted");
    expect(headerGroup).not.toHaveClass("backdrop-blur", "bg-muted/80");
    const headerRow = within(headerGroup).getByRole("row");
    expect(Number.parseInt(headerRow.style.minWidth, 10)).toBeGreaterThan(720);
    expect(within(headerRow).getByRole("columnheader", { name: "Payment #" })).toHaveClass("text-left");

    for (const view of ["Yearly", "All events", "Monthly"]) {
      fireEvent.click(screen.getByRole("radio", { name: view }));
      expect(screen.getByRole("radio", { name: view })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("table", { name: new RegExp(view, "i") })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("radio", { name: "All events" }));
    const interestRow = screen.getAllByRole("row").find((row) => within(row).queryByText("Interest charged"));
    expect(interestRow).toBeDefined();
    expect(within(interestRow!).getAllByRole("cell")[0]).toHaveTextContent("");
  });
});

describe("tracking setup", () => {
  function Tracking({ initial }: { initial: TrackingState }) {
    const [t, setT] = useState(initial);
    return <TrackingSetup sim={shortLoan()} tracking={t} setTracking={setT} directory={DIRECTORY} issues={[]} />;
  }

  it("asks how the lender records interest in plain words, with nothing chosen for the person", () => {
    render(<Tracking initial={newTracking(shortLoan())} />);
    const group = screen.getByRole("group", { name: "Your lender statement shows interest" });
    const choices = within(group).getAllByRole("button");
    expect(choices.map((b) => b.textContent)).toEqual(["Inside each repayment", "As its own transaction"]);
    expect(choices.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    fireEvent.click(choices[0]);
    expect(within(group).getByRole("button", { name: "Inside each repayment" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/Pattern [AB]/)).toBeNull();
  });

  it("is two columns of loan settings, edited in place: no dialog, and who owes the money comes from the kind of loan", () => {
    render(<Tracking initial={{ ...newTracking(shortLoan()), liabilityAccountId: "loan", paymentAccountId: "sav" }} />);
    expect(screen.queryByRole("button", { name: /Edit how repayments are recorded/ })).toBeNull();
    expect(screen.queryByText("Who owes the money?")).toBeNull();
    expect(screen.queryByText(/Calculation engine/)).toBeNull();
    const table = screen.getByRole("table", { name: "How each part of a repayment is recorded" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Part", "Goes to", "Category", "Note on the line"]);
    expect(within(table).getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["Principal", "Interest"]);
    expect(within(table).getByText(/^Transfer to /)).toBeInTheDocument();
    expect(screen.getByText(/The loan payment category is used whenever a repayment, or its principal part, leaves your budget/)).toBeInTheDocument();
    expect(screen.getByLabelText("Loan account")).toBeInTheDocument();
  });

  it("asks for an existing category only when the accounts cross the budget boundary, and never offers to create one", () => {
    render(<Tracking initial={{ ...newTracking(shortLoan()), liabilityAccountId: "loan", paymentAccountId: "sav" }} />);
    expect(screen.getByText("Loan payment category")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create|new category/i })).toBeNull();
  });

  it("does not offer a calculation engine choice: the engine follows the calculation method", () => {
    render(<Tracking initial={newTracking(shortLoan())} />);
    expect(screen.queryByText(/An Actual formula rule/)).toBeNull();
    expect(engineLine(shortLoan())).toMatch(/^Kept in Actual by Actual Bench, /);
  });
});

describe("the new-loan flow", () => {
  withViewport();
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it("opens on Schedule in the workspace, keeps the unsaved simulation per connection and budget, and saves only from Settings", async () => {
    wrap(<NewLoanView />);
    await screen.findByLabelText("Loan amount");
    const sections = screen.getByRole("navigation", { name: "Loan sections" });
    expect(within(sections).getAllByRole("button").map((b) => b.textContent)).toEqual(["Terms & Schedule", "Link to Actual", "Sync Repayments"]);
    expect(within(sections).getByRole("button", { name: "Terms & Schedule" })).toHaveAttribute("aria-current", "page");
    expect(within(sections).getByRole("button", { name: "Sync Repayments" })).toBeDisabled();
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Loans & Debt/ })).toBeInTheDocument();
    const how = screen.getByRole("button", { name: "How this loan is calculated" });
    const method = screen.getByRole("button", { name: "Set calculation method" });
    const reset = screen.getByRole("button", { name: "More loan actions" });
    expect(how.compareDocumentPosition(method) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(method.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const button of [how, method, reset]) expect(button.querySelector("svg")).not.toBeNull();
    type("Loan amount", "30000");
    type("Years", "3");
    type("Interest rate", "6");
    expect(sessionStorage.getItem("assets-debt:new-loan:c1:b1")).toBeNull();
    expect(Object.keys(sessionStorage)).toEqual([]);
    expect(mocked.createDebt).not.toHaveBeenCalled();

    const next = screen.getByRole("button", { name: "Next: Link to Actual" });
    expect(next.querySelector(".lucide-arrow-right")).not.toBeNull();
    await waitFor(() => expect(next).toBeEnabled(), WAIT);
    fireEvent.click(next);
    expect(await screen.findByLabelText("Setup checklist")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(SAVE_BOUNDARY.replace(/[.]/g, "\\.")))).toBeInTheDocument();
    expect(SAVE_BOUNDARY).toBe("Saving this loan does not create or modify financial transactions in Actual.");
    expect(screen.getByText(/Required once the loan is saved/)).toBeInTheDocument();
    // The loan settings are not complete yet, so the save keeps it as a draft to finish later.
    expect(screen.getByRole("button", { name: "Save as draft" })).toBeInTheDocument();
    expect(mocked.createDebt).not.toHaveBeenCalled();
  });
});

describe("an existing loan", () => {
  withViewport();

  it("marks unsaved changes, compares with the saved loan, and never saves by viewing", async () => {
    const saved = shortLoan();
    wrap(<Harness initial={saved} saved={saved} />);
    await waitFor(() => expect(screen.getByText("Total interest").nextSibling).not.toHaveTextContent("–"), WAIT);
    type("Interest rate", "5");
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare with saved" }));
    await waitFor(() => expect(screen.getByText(/less than saved/)).toBeInTheDocument(), WAIT);
    await waitFor(() => expect(screen.getByTestId("chart").dataset.series).toContain("comparison"));
    await act(async () => {});
    expect(mocked.updateDebt).not.toHaveBeenCalled();
    expect(mocked.createDebt).not.toHaveBeenCalled();
  });
});

describe("an existing loan page", () => {
  withViewport();
  const db = tempDebtDb();
  const loan = shortLoan();
  const input = statesToSaveInput(loan, { ...newTracking(loan), name: "Car loan", lenderPattern: "embedded-interest", liabilityAccountId: "acc-car", paymentAccountId: "acc-checking", loanPaymentCategoryId: "cat-loan" }, "budget-1", "bench-periodic");
  if (!input.ok) throw new Error(JSON.stringify(input.issues));
  const saved = createDebtConfiguration(db, input.input, fixtureDirectory());
  const detail = getDebtDetail(db, saved.debt.id)!;

  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveBudgetSyncId = "budget-1";
    mockDirectory.current = fixtureDirectory();
    mocked.getDebt.mockResolvedValue(detail);
    mocked.updateDebt.mockImplementation(async () => ({ ...detail, debt: { ...detail.debt, currentRevision: 2 } }));
  });
  afterEach(() => { mockDirectory.current = undefined; mockActiveBudgetSyncId = "b1"; });

  const withView = async (view: string | null, run: () => Promise<void>) => {
    const nav = jest.requireMock("next/navigation") as { useSearchParams: () => URLSearchParams };
    const original = nav.useSearchParams;
    nav.useSearchParams = () => new URLSearchParams(view ? `view=${view}` : "");
    try {
      await run();
    } finally {
      nav.useSearchParams = original;
    }
  };

  it("Calculation: loads the saved loan, marks edits unsaved, discards them, and saves only on Save changes", async () => {
    await withView("calculation", async () => {
      wrap(<LoanView id={detail.debt.id} />);
      expect(await screen.findByText(/^Active · setup \d of \d$/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
      await waitFor(() => expect(screen.getByText("Payoff date").nextSibling).toHaveTextContent("01 Jan 2027"), WAIT);

      type("Interest rate", "5");
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      expect(await screen.findByText(/^Active · setup \d of \d$/)).toBeInTheDocument();
      expect(screen.getByLabelText("Interest rate")).toHaveValue("6");
      expect(mocked.updateDebt).not.toHaveBeenCalled();

      type("Interest rate", "5");
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(mocked.updateDebt).toHaveBeenCalledTimes(1));
      const [id, body, dir] = mocked.updateDebt.mock.calls[0];
      expect(id).toBe(detail.debt.id);
      expect(body.rates).toEqual([expect.objectContaining({ annualRateDecimal: "0.05" })]);
      expect(dir).toBe(mockDirectory.current);
      expect(mocked.createDebt).not.toHaveBeenCalled();
    });
  });

  it("preserves unsaved edits when the saved loan changes and allows explicit reload", async () => {
    await withView("calculation", async () => {
      const { client } = wrap(<LoanView id={detail.debt.id} />);
      await screen.findByText(/^Active · setup \d of \d$/);
      type("Interest rate", "5");
      await act(async () => {
        client.setQueryData(["assets-debt", "debt", detail.debt.id], { ...detail, debt: { ...detail.debt, name: "Updated elsewhere", currentRevision: detail.debt.currentRevision + 1 } });
      });
      expect(await screen.findByText(/The saved loan changed\. Your edits are preserved/)).toBeInTheDocument();
      expect(screen.getByLabelText("Interest rate")).toHaveValue("5");
      expect(mocked.updateDebt).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Discard edits and reload" }));
      await waitFor(() => expect(screen.getByLabelText("Interest rate")).toHaveValue("6"));
      expect(screen.queryByText(/The saved loan changed\. Your edits are preserved/)).toBeNull();
    });
  });

  it("shows save progress for an existing loan without losing the editor", async () => {
    await withView("calculation", async () => {
      let finish!: (next: typeof detail) => void;
      mocked.updateDebt.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      wrap(<LoanView id={detail.debt.id} />);
      await screen.findByText(/^Active · setup \d of \d$/);
      type("Interest rate", "5");
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      expect(await screen.findByRole("button", { name: "Saving loan revision…" })).toBeDisabled();
      await act(async () => { finish(detail); });
      await screen.findByRole("button", { name: "Save changes" });
    });
  });

  it("makes a tracked Actual extra read-only in the Events table", async () => {
    await withView("calculation", async () => {
      mocked.getDebt.mockResolvedValue({ ...detail, actualExtraPaymentAssumptionIds: ["actual-extra-event"], assumptions: [{
        id: "actual-extra-event", debtId: detail.debt.id, assumptionKind: "extra-repayment", effectiveFrom: "2024-04-01", recurrence: null,
        amountMinor: 100000, feeTreatment: null, offsetAccountId: null, note: "Extra payment recorded from Actual", createdAt: "2024-04-01", updatedAt: "2024-04-01",
      }] });
      wrap(<LoanView id={detail.debt.id} />);
      expect(await screen.findByRole("button", { name: "Remove Extra payment on 2024-04-01" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Edit Extra payment on 2024-04-01" })).toBeDisabled();
      expect(screen.getByText("Recorded from Actual · manage in Sync Repayments")).toBeInTheDocument();
      expect(mocked.updateDebt).not.toHaveBeenCalled();
    });
  });

  it("Terms & Schedule uses the loan's top bar: Compare, How and Set calculation method there, one ⋯ menu with Reset loan", async () => {
    await withView("schedule", async () => {
      wrap(<LoanView id={detail.debt.id} />);
      expect(await screen.findByRole("button", { name: "Set calculation method" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "How this loan is calculated" })).toBeInTheDocument();
      expect(screen.getByText("Compare with saved")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "More schedule actions" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "More loan actions" }));
      expect(await screen.findByRole("menuitem", { name: "Reset loan" })).toBeInTheDocument();
    });
  });

  it("the workspace has exactly Schedule, Settings and Transactions; old links open the tab that now holds their content", async () => {
    await withView("matching", async () => {
      wrap(<LoanView id={detail.debt.id} />);
      const sections = await screen.findByRole("navigation", { name: "Loan sections" });
      expect(within(sections).getAllByRole("button").map((b) => b.textContent)).toEqual(["Terms & Schedule", "Link to Actual", "Sync Repayments"]);
      expect(within(sections).getByRole("button", { name: "Link to Actual" })).toHaveAttribute("aria-current", "page");
      expect(await screen.findByRole("heading", { name: /Repayment matching/ })).toBeInTheDocument();
      expect(screen.getByText("Saved separately")).toBeInTheDocument();
      expect(screen.getByLabelText("Setup checklist")).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Assets & Debt sections" })).toBeNull();
    });
  });

  it("an existing loan opens on Transactions: the status strip, and lender statements in a drawer", async () => {
    await withView(null, async () => {
      wrap(<LoanView id={detail.debt.id} />);
      const sections = await screen.findByRole("navigation", { name: "Loan sections" });
      expect(within(sections).getByRole("button", { name: "Sync Repayments" })).toHaveAttribute("aria-current", "page");
      expect(await screen.findByRole("region", { name: "Loan status" })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Filter changes" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Check against lender statement" }));
      expect(await screen.findByText(/to see which side is off/)).toBeInTheDocument();
      expect(await screen.findByText(/No statements yet/)).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Add a statement" })).toBeInTheDocument();
    });
  });

});
