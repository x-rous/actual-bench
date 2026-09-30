import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import { createDebtConfiguration, getDebtDetail, type DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import { directory as fixtureDirectory, tempDebtDb } from "@/lib/assets-debt/testing/debtFixtures";
import * as api from "../lib/debtsApi";
import { createSyncRunner } from "../lib/projectionRunner";
import { newSimulation, newTracking, statesToSaveInput, type SimulationState, type TrackingState } from "../lib/simulatorModel";
import { DAILY_MONTHLY_CHARGE, project, sim } from "../lib/simulatorTestKit";
import { ProjectionRunnerContext } from "../lib/useLiveProjection";
import { AssetsDebtTabs } from "./AssetsDebtTabs";
import { DebtList } from "./DebtList";
import { LoanView, NewLoanView } from "./LoanPages";
import { SAVE_BOUNDARY } from "./saveBoundary";
import { ScheduleTable } from "./simulator/ScheduleTable";
import { NOT_ADVICE, SimulatorView } from "./simulator/SimulatorView";
import { TrackingSetup } from "./tracking/TrackingSetup";

/**
 * The Assets & Debt workspace UI (RD-084 P1.3, P1.3b T204–T216, T219, T220).
 * Projections run on a synchronous runner here (jsdom has no Worker); the
 * chart is replaced by a stub because Recharts needs real layout.
 */

jest.mock("../lib/debtsApi", () => {
  const actual = jest.requireActual("../lib/debtsApi");
  return { ...actual, listDebts: jest.fn(async () => []), createDebt: jest.fn(), updateDebt: jest.fn(), getDebt: jest.fn(), archiveDebt: jest.fn() };
});
const mockDirectory: { current: AccountDirectory | undefined } = { current: undefined };
jest.mock("../lib/useAccountDirectory", () => ({
  useAccountDirectory: () => ({ data: mockDirectory.current, isLoading: false }),
  useActiveBudgetSyncId: () => "b1",
}));
jest.mock("@/store/connection", () => ({
  useConnectionStore: (select: (s: unknown) => unknown) => select({}),
  selectActiveInstance: () => ({ id: "c1", budgetSyncId: "b1" }),
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/assets-debt/loans", useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useSearchParams: () => new URLSearchParams() }));
jest.mock("next/dynamic", () => () => function ChartStub({ visible }: { visible: string[] }) {
  return <div data-testid="chart" data-series={visible.join(",")} />;
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

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
  return { id: `d${i}`, name: `Loan ${i}`, debtType: "mortgage", behaviorClass: "term-loan", status: "active", currency: "AUD", currencyMinorDigits: 2, liabilityAccountId: `l${i}`, executionStrategy: "bench-daily", openingPrincipalMinor: 100_000, currentRevision: 1, blocked: null, ...patch };
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
  return render(
    <QueryClientProvider client={client}>
      <ProjectionRunnerContext.Provider value={createSyncRunner()}>{ui}</ProjectionRunnerContext.Provider>
    </QueryClientProvider>,
  );
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
const prompt = () => screen.queryByRole("dialog", { name: "This feature needs day-by-day interest calculation" });

describe("Assets & Debt tabs", () => {
  it("labels the section navigation, marks the current tab, and moves with the arrow keys", () => {
    render(<AssetsDebtTabs />);
    const nav = screen.getByRole("navigation", { name: "Assets & Debt sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Overview", "Loans & Debt", "Assets", "Rules", "Activity"]);
    expect(screen.getByRole("link", { name: "Loans & Debt" })).toHaveAttribute("aria-current", "page");
    links[1].focus();
    fireEvent.keyDown(links[1], { key: "ArrowRight" });
    expect(document.activeElement).toBe(links[2]);
    fireEvent.keyDown(links[2], { key: "End" });
    expect(document.activeElement).toBe(links[4]);
    fireEvent.keyDown(links[4], { key: "ArrowRight" });
    expect(document.activeElement).toBe(links[0]);
  });
});

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

describe("the simulator (five-input path, layout, live results)", () => {
  withViewport();
  beforeEach(() => jest.clearAllMocks());

  it("five inputs give the four headline figures, the chart and the schedule on one screen, with nothing from Actual", async () => {
    wrap(<Harness initial={newSimulation({ currency: "AUD", today: "2024-01-01" })} />);
    expect(screen.getByText(/Enter the loan amount, term, interest rate to see the loan/)).toBeInTheDocument();
    // Start date and repayment frequency are already filled in; three values complete the loan.
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    expect(screen.getByLabelText("Repayment frequency")).toBeInTheDocument();
    type("Loan amount", "30000");
    type("Years", "3");
    type("Interest rate (per year)", "6");

    const results = screen.getByTestId("results-region");
    await waitFor(() => expect(within(results).getByText("Total interest").nextSibling).not.toHaveTextContent("–"), WAIT);
    for (const tile of ["Repayment", "Total repayments", "Total interest", "Payoff date"]) expect(within(results).getByText(tile)).toBeInTheDocument();
    expect(within(results).getByText("Payoff date").nextSibling).toHaveTextContent("2027-01-01");
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(within(screen.getByTestId("schedule-region")).getByRole("table", { name: /Schedule/ })).toBeInTheDocument();

    // Nothing Actual-specific is asked for, and nothing was saved or read.
    for (const word of [/Loan account/, /Repayments come from/, /category/i, /lender/i, /strategy/i, /drift/i, /^Name$/]) expect(screen.queryByLabelText(word)).toBeNull();
    expect(mocked.createDebt).not.toHaveBeenCalled();
    expect(mocked.updateDebt).not.toHaveBeenCalled();
  });

  it("lays out a narrow control rail beside the results, the schedule beneath at full width, and says it is not advice", async () => {
    wrap(<Harness initial={shortLoan()} />);
    const rail = screen.getByTestId("control-rail");
    expect(rail.className).toContain("lg:w-[360px]");
    expect(rail).toHaveAttribute("aria-label", "Loan inputs");
    const results = screen.getByTestId("results-region");
    expect(results.className).toContain("flex-1");
    // Rail and results share a row; the schedule sits after that row, outside both.
    expect(rail.parentElement).toBe(results.parentElement);
    const schedule = await screen.findByTestId("schedule-region", undefined, WAIT);
    expect(rail.contains(schedule) || results.contains(schedule)).toBe(false);
    expect(rail.parentElement!.compareDocumentPosition(schedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("not-advice")).toHaveTextContent(NOT_ADVICE);
    // No tab switching between inputs and results.
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("announces one settled summary per recalculation, not every keystroke", async () => {
    wrap(<Harness initial={shortLoan()} />);
    const live = document.querySelector("[aria-live=polite]")!;
    await waitFor(() => expect(live.textContent).toMatch(/^repayment .* monthly; total repayments .*; total interest .*; paid off 2027-01-01\.$/), WAIT);
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

  it("ties each validation message to its input, and the rate slider sets the same exact rate", async () => {
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

    fireEvent.change(screen.getByRole("slider", { name: "Interest rate slider" }), { target: { value: "4.25" } });
    expect(screen.getByLabelText("Interest rate (per year)")).toHaveValue("4.25");
  });

  it("the chart has a text alternative, keyboard-operable series and detail switches", async () => {
    wrap(<Harness initial={shortLoan()} />);
    await screen.findByTestId("chart", undefined, WAIT);
    expect(screen.getByText(/Loan balance from .* ending at/)).toBeInTheDocument();
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
});

describe("O1: features that need day-by-day interest", () => {
  withViewport();

  it("an offset under the period-by-period method asks first; Cancel leaves the loan unchanged", async () => {
    const states: SimulationState[] = [];
    const initial = shortLoan();
    wrap(<Harness initial={initial} onState={(s) => states.push(s)} />);
    fireEvent.click(screen.getByRole("switch", { name: /Offset account/ }));
    const dialog = await screen.findByRole("dialog", { name: "This feature needs day-by-day interest calculation" });
    expect(dialog).toHaveTextContent(/offset/i);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(states).toEqual([]);
    expect(screen.getByRole("switch", { name: /Offset account/ })).not.toBeChecked();
    expect(screen.queryByLabelText("Offset balance")).toBeNull();
  });

  it("Escape also cancels the prompt", async () => {
    const states: SimulationState[] = [];
    wrap(<Harness initial={shortLoan()} onState={(s) => states.push(s)} />);
    fireEvent.click(screen.getByRole("switch", { name: /Offset account/ }));
    const dialog = await screen.findByRole("dialog", { name: "This feature needs day-by-day interest calculation" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(prompt()).toBeNull());
    expect(states).toEqual([]);
  });

  it("accepting switches only the interest method, keeps every value, and recalculates", async () => {
    const states: SimulationState[] = [];
    const initial = shortLoan();
    wrap(<Harness initial={initial} onState={(s) => states.push(s)} />);
    fireEvent.click(screen.getByRole("switch", { name: /Offset account/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Switch to day-by-day" }));
    await waitFor(() => expect(states).toHaveLength(1));
    const [next] = states;
    expect(next.profile).toMatchObject({ accrual: "daily-simple", capitalization: "at-charge", presetId: null });
    expect(next.offsets).toHaveLength(1);
    expect({ ...next, profile: null, offsets: [], assumptions: [] }).toEqual({ ...initial, profile: null, offsets: [], assumptions: [] });
    expect(project(next).ok).toBe(true);
    expect(await screen.findByLabelText("Offset balance")).toBeInTheDocument();
    // The Calculation method summary follows the switch.
    expect(screen.getByText(/daily interest · charged with each repayment/)).toBeInTheDocument();
    expect(mocked.createDebt).not.toHaveBeenCalled();
    expect(mocked.updateDebt).not.toHaveBeenCalled();
  });

  it("an extra repayment between repayment dates asks; one on a repayment date does not", async () => {
    const states: SimulationState[] = [];
    wrap(<Harness initial={shortLoan()} onState={(s) => states.push(s)} />);
    const addExtra = async (date: string) => {
      fireEvent.click(screen.getByRole("button", { name: /extra transactions/ }));
      const dialog = await screen.findByRole("dialog", { name: "Extra transactions" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Add extra repayment" }));
      type("Amount", "500");
      const field = screen.getByLabelText("Date");
      fireEvent.change(field, { target: { value: date } });
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    };
    await addExtra("2024-06-01");
    await waitFor(() => expect(states).toHaveLength(1));
    expect(prompt()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Extra transactions" })).toBeNull());

    await addExtra("2024-06-15");
    expect(await screen.findByRole("dialog", { name: "This feature needs day-by-day interest calculation" })).toHaveTextContent(/between repayment dates/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(states).toHaveLength(1);
  });

  it("a rate change part-way through a period asks; compatible features do not", async () => {
    const states: SimulationState[] = [];
    wrap(<Harness initial={shortLoan()} onState={(s) => states.push(s)} />);
    fireEvent.click(screen.getByRole("switch", { name: /Fees and other costs/ }));
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("switch", { name: /Interest-only period/ }));
    expect(prompt()).toBeNull();
    const accepted = states.length;
    expect(accepted).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Add rate changes" }));
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
    render(<ScheduleTable events={eventsOf(s)} profile={s.profile} currency="AUD" digits={2} />);
    expect(headers()).toEqual(["Period", "Payment", "Principal", "Interest", "Balance"]);
    expect(screen.queryByText(/Interest is charged separately/)).toBeNull();
  });

  it("says Debt reduction, with help, when interest is charged separately; interest charges are their own events", () => {
    const s = shortLoan({ profile: { ...shortLoan().profile, ...DAILY_MONTHLY_CHARGE } });
    render(<ScheduleTable events={eventsOf(s)} profile={s.profile} currency="AUD" digits={2} />);
    expect(headers()).toContain("Debt reduction");
    expect(headers()).not.toContain("Principal");
    expect(screen.getByText(/Interest is charged separately, so repayments reduce the outstanding loan balance/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "All events" }));
    expect(headers()).toContain("Debt reduction");
    expect(screen.getAllByText("Interest charged").length).toBeGreaterThan(0);
  });

  it("shows the engine's rate, and Multiple for a month with a mid-month change", () => {
    const base = shortLoan({ profile: { ...shortLoan().profile, ...DAILY_MONTHLY_CHARGE } });
    const s = { ...base, rates: [...base.rates, { ...base.rates[0], key: "r2", accrualEffectiveFrom: "2024-03-15", annualRateDecimal: "0.07" }] };
    render(<ScheduleTable events={eventsOf(s)} profile={s.profile} currency="AUD" digits={2} />);
    expect(headers()).toContain("Rate");
    const rows = screen.getAllByRole("row").slice(1);
    const cellsOf = (period: string) => within(rows.find((r) => within(r).queryByText(period))!).getAllByRole("cell").map((c) => c.textContent);
    const rateAt = headers().indexOf("Rate");
    expect(cellsOf("2024-02")[rateAt]).toBe("6%");
    expect(cellsOf("2024-04")[rateAt]).toBe("Multiple");
    expect(cellsOf("2024-06")[rateAt]).toBe("7%");
  });
});

describe("tracking setup", () => {
  function Tracking({ initial }: { initial: TrackingState }) {
    const [t, setT] = useState(initial);
    return <TrackingSetup sim={shortLoan()} tracking={t} setTracking={setT} directory={DIRECTORY} issues={[]} />;
  }

  it("asks how the lender records interest in plain words, with nothing chosen for the person", () => {
    render(<Tracking initial={newTracking(shortLoan())} />);
    const group = screen.getByRole("group", { name: "Interest on your lender statement" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([false, false]);
    expect(within(group).getByText("Interest is part of each repayment")).toBeInTheDocument();
    expect(within(group).getByText("Interest appears as a separate lender transaction")).toBeInTheDocument();
    expect(screen.queryByText(/Pattern [AB]/)).toBeNull();
  });

  it("asks for an existing category only when the accounts cross the budget boundary, and never offers to create one", () => {
    render(<Tracking initial={{ ...newTracking(shortLoan()), liabilityAccountId: "loan", paymentAccountId: "sav" }} />);
    expect(screen.getByText("Loan payment category")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create|new category/i })).toBeNull();
  });

  it("does not claim Actual formula rules are available", () => {
    render(<Tracking initial={newTracking(shortLoan())} />);
    expect(screen.getAllByText(/Available once Actual Bench has checked/).length).toBeGreaterThan(0);
  });
});

describe("the new-loan flow", () => {
  withViewport();
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it("keeps the unsaved simulation per connection and budget in this tab, and the review says nothing reaches Actual", async () => {
    wrap(<NewLoanView />);
    await screen.findByLabelText("Loan amount");
    type("Loan amount", "30000");
    type("Years", "3");
    type("Interest rate (per year)", "6");
    await waitFor(() => expect(sessionStorage.getItem("assets-debt:new-loan:c1:b1")).toContain("3000000"));
    expect(Object.keys(sessionStorage)).toEqual(["assets-debt:new-loan:c1:b1"]);
    expect(mocked.createDebt).not.toHaveBeenCalled();

    const next = screen.getByRole("button", { name: "Set up tracking in Actual" });
    await waitFor(() => expect(next).toBeEnabled(), WAIT);
    fireEvent.click(next);
    expect(await screen.findByRole("heading", { name: "Set up tracking in Actual" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByTestId("save-boundary-notice")).toHaveTextContent("Saving this loan does not create or modify financial transactions in Actual.");
    expect(SAVE_BOUNDARY).toBe("Saving this loan does not create or modify financial transactions in Actual.");
    expect(screen.getByRole("button", { name: "Add loan to Assets & Debt" })).toBeInTheDocument();
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
    type("Interest rate (per year)", "5");
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
    mockDirectory.current = fixtureDirectory();
    mocked.getDebt.mockResolvedValue(detail);
    mocked.updateDebt.mockImplementation(async () => ({ ...detail, debt: { ...detail.debt, currentRevision: 2 } }));
  });
  afterEach(() => (mockDirectory.current = undefined));

  it("loads the saved loan, marks edits unsaved, discards them, and saves only on Save changes", async () => {
    wrap(<LoanView id={detail.debt.id} />);
    expect(await screen.findByText("Saved, revision 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await waitFor(() => expect(screen.getByText("Payoff date").nextSibling).toHaveTextContent("2027-01-01"), WAIT);

    type("Interest rate (per year)", "5");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByText("Saved, revision 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Interest rate (per year)")).toHaveValue("6");
    expect(mocked.updateDebt).not.toHaveBeenCalled();

    type("Interest rate (per year)", "5");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocked.updateDebt).toHaveBeenCalledTimes(1));
    const [id, body, dir] = mocked.updateDebt.mock.calls[0];
    expect(id).toBe(detail.debt.id);
    expect(body.rates).toEqual([expect.objectContaining({ annualRateDecimal: "0.05" })]);
    expect(dir).toBe(mockDirectory.current);
    expect(mocked.createDebt).not.toHaveBeenCalled();
  });

  it("the Activity view shows the current revision and saved state, with full history deferred", async () => {
    const nav = jest.requireMock("next/navigation") as { useSearchParams: () => URLSearchParams };
    const original = nav.useSearchParams;
    nav.useSearchParams = () => new URLSearchParams("view=activity");
    try {
      wrap(<LoanView id={detail.debt.id} />);
      expect(await screen.findByText(/Saved revision 1/)).toHaveTextContent("No unsaved changes.");
      expect(screen.getByText(/full revision history.*later phases/i)).toBeInTheDocument();
    } finally {
      nav.useSearchParams = original;
    }
  });
});
