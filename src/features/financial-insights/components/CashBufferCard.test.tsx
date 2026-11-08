import { fireEvent, render, screen, within } from "@testing-library/react";
import type { BufferAdjustments, BufferCategoryRow, BufferSettings } from "@/lib/financial-insights/bufferScenario";
import type { CashBuffer } from "@/lib/financial-insights/measures";
import { CashBuffer as CashBufferCard } from "./CashBufferCard";
import { TipProvider } from "./charts/Tip";

const select = jest.fn();
let hook: Record<string, unknown> = {};
const saveSettings = jest.fn();
let settings: BufferSettings = { goalMonths: null, averageMonths: 12, method: "average" };
jest.mock("../hooks/useCashBufferScenarios", () => ({ useCashBufferScenarios: () => hook }));
jest.mock("../hooks/useCashBufferSettings", () => ({ useCashBufferSettings: () => ({ settings, save: saveSettings, saving: false }) }));

const categories: BufferCategoryRow[] = [
  { id: "rent", name: "Rent", group: "Housing", hidden: false, avgMinor: 200_000 },
  { id: "fun", name: "Fun", group: "Leisure", hidden: false, avgMinor: 40_000 },
];
const value = { months: 3_000_000 / 340_000, cashMinor: 3_000_000, grossCashMinor: 3_000_000, cardsOwedMinor: 0, monthlyNeedMinor: 340_000, spendingMinor: 240_000, spendingMonths: 12, loans: [{ accountId: "m", name: "Mortgage", monthlyMinor: 100_000, source: "schedule" as const }] };
const ready = { state: "ready" as const, value: value as CashBuffer };
const groups = { groups: [{ name: "Housing", avgMinor: 200_000 }, { name: "Leisure", avgMinor: 40_000 }], categories, spendingMinor: 240_000, loanInterestMinor: 0, incomeMinor: 600_000, months: 12, startMonth: "2025-11", endMonth: "2026-10" };
const adjustments = (over: Partial<BufferAdjustments>): BufferAdjustments => ({ excluded: [], amounts: {}, loansExcluded: [], loanAmounts: {}, ...over });
const scenario = (over: Partial<BufferAdjustments>, result: object | null = null) => ({ id: "s1", name: "Lean", adjustments: adjustments(over), result, budgetSyncId: "b", createdAt: "", updatedAt: "" });
const setHook = (active: ReturnType<typeof scenario> | null, list = active ? [active] : []) => { hook = { scenarios: list, active, loading: false, failed: false, select, saveScenario: jest.fn(), deleteScenario: jest.fn(), saving: false }; };
const show = () => render(<TipProvider><CashBufferCard buffer={ready} groups={groups} today="2026-11-18" /></TipProvider>);

describe("the cash buffer card", () => {
  beforeEach(() => { select.mockClear(); saveSettings.mockClear(); settings = { goalMonths: null, averageMonths: 12, method: "average" }; });

  it("shows the real buffer with a Simulate button when there is no scenario", () => {
    setHook(null);
    show();
    expect(screen.getByText(/8\.8/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Simulate/ })).toBeInTheDocument();
    expect(screen.queryByText(/Simulated:/)).not.toBeInTheDocument();
  });

  it("explains today's cash using eligible account balances, including overdrafts, for a scenario", () => {
    setHook(scenario({ excluded: ["fun"] }));
    const balances: Record<string, number> = { checking: 1_900_000, savings: 1_200_000, overdraft: -200_000, closed: 100_000, deposit: 900_000, investment: 800_000 };
    const ledger = {
      account: new Map([
        ["checking", { id: "checking", name: "Checking" }], ["savings", { id: "savings", name: "Off-budget savings" }],
        ["overdraft", { id: "overdraft", name: "Overdraft" }], ["deposit", { id: "deposit", name: "Restricted deposit" }],
        ["investment", { id: "investment", name: "Brokerage" }], ["empty", { id: "empty", name: "Empty account" }],
        ["closed", { id: "closed", name: "Old account", closed: true }], ["closedEmpty", { id: "closedEmpty", name: "Closed empty account", closed: true }],
      ]),
      role: new Map([["checking", "cash"], ["savings", "cash"], ["overdraft", "cash"], ["deposit", "fixed"], ["investment", "investment"], ["empty", "cash"], ["closed", "cash"], ["closedEmpty", "cash"]]),
      balanceAt: (id: string, month: string) => month === "2026-11" ? balances[id] ?? 0 : 0,
    };
    const data = { ledger } as unknown as NonNullable<Parameters<typeof CashBufferCard>[0]["data"]>;
    render(<TipProvider><CashBufferCard buffer={ready} groups={groups} today="2026-11-18" data={data} /></TipProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Cash & bank less card balances today.*see account balances/ }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("row", { name: /Checking/ })).toHaveTextContent("19,000.00");
    expect(within(table).getByRole("row", { name: /Off-budget savings/ })).toHaveTextContent("12,000.00");
    expect(within(table).getByRole("row", { name: /Overdraft/ })).toHaveTextContent("-2,000.00");
    expect(within(table).getByRole("row", { name: /Cash & bank less card balances/ })).toHaveTextContent("30,000.00");
    expect(within(table).getByRole("row", { name: /Credit cards owed/ })).toHaveTextContent("0.00");
    expect(within(table).queryByText("Restricted deposit")).not.toBeInTheDocument();
    expect(within(table).queryByText("Brokerage")).not.toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Empty account/ })).toHaveTextContent("0.00");
    expect(within(table).queryByText("Old account")).not.toBeInTheDocument();
    expect(within(table).queryByText("Closed empty account")).not.toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Closed account balances/ })).toHaveTextContent("1,000.00");
  });

  it("shows a scenario as simulated, against the actual, with what it left out", () => {
    setHook(scenario({ excluded: ["fun"], loanAmounts: { m: 120_000 } }, { months: 12, cashMinor: 3_000_000, monthlyNeedMinor: 250_000, actualMonths: 8.8, at: "2026-10-01T10:00:00Z" }));
    show();
    expect(screen.getByText("Simulated: Lean")).toBeInTheDocument();
    // spending 240,000 - 40,000; loans 120,000: need 320,000, so 9.4 months.
    expect(screen.getByText(/9\.4/)).toBeInTheDocument();
    expect(screen.getByText(/▲ \+0\.6 months against the actual 8\.8/)).toBeInTheDocument();
    expect(screen.getByText(/1 left out, 1 amount changed/)).toBeInTheDocument();
    expect(screen.getByText(/When saved on .*: 12\.0 months/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New/ })).toBeInTheDocument();
  });

  it("says Unavailable, and how to get back, when the scenario leaves nothing to spend", () => {
    setHook(scenario({ excluded: ["rent", "fun"], loansExcluded: ["m"] }));
    render(<TipProvider><CashBufferCard buffer={{ state: "ready", value: { ...value, spendingMinor: 240_000 } as CashBuffer }} groups={{ ...groups, categories: [{ ...categories[0], avgMinor: 240_000 }] }} today="2026-11-18" /></TipProvider>);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText(/show the actual buffer/)).toBeInTheDocument();
  });

  it("opens the dialog from Simulate", () => {
    setHook(null);
    show();
    fireEvent.click(screen.getByRole("button", { name: /Simulate/ }));
    expect(screen.getByText("Simulate your cash buffer")).toBeInTheDocument();
  });

  it("offers no simulation when the buffer is unavailable", () => {
    setHook(null);
    render(<TipProvider><CashBufferCard buffer={{ state: "unavailable", reason: "Insufficient history" }} groups={null} today="2026-11-18" /></TipProvider>);
    expect(screen.getByText("Insufficient history")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Simulate/ })).not.toBeInTheDocument();
  });

  it("keeps every scenario control in one row at the top right, and shows nothing about a goal until one is set", () => {
    setHook(scenario({}));
    show();
    const header = screen.getByRole("button", { name: "Edit this scenario" }).parentElement as HTMLElement;
    for (const name of ["Edit this scenario", "New scenario", "Goal and how a typical month is worked out"]) expect(within(header).getByRole("button", { name })).toBeInTheDocument();
    expect(within(header).getByRole("combobox", { name: "Show the real buffer or a scenario" })).toBeInTheDocument();
    expect(screen.queryByText(/goal/i)).not.toBeInTheDocument();
  });

  it("shows Simulated beside the title, and the title says only the date", () => {
    setHook(scenario({}));
    show();
    const title = screen.getByRole("heading", { name: "Your cash buffer" }).parentElement as HTMLElement;
    expect(title).toHaveTextContent("As of 18 Nov 2026");
    expect(title).not.toHaveTextContent("whatever period");
    expect((title.parentElement as HTMLElement)).toHaveTextContent("Simulated: Lean");
  });

  it("measures the buffer against the goal: short of it, or with months to spare", () => {
    setHook(null);
    settings = { goalMonths: 12, averageMonths: 12, method: "average" };
    const { unmount } = show();
    // 3,000,000 cash, 340,000 a month: 8.8 months; 12 months needs 4,080,000, so 1,080,000 more.
    expect(screen.getByText("your goal: 12 months")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("3.2 months short of your 12-month goal: 10,800.00 more cash & bank would reach it.");
    unmount();
    settings = { goalMonths: 6, averageMonths: 12, method: "average" };
    show();
    expect(screen.getByRole("status")).toHaveTextContent("Your 6-month goal is covered, with 2.8 months to spare.");
    // The goal is inside the bar's scale, so it is marked where it falls.
    expect(screen.getByText("your goal: 6 months")).toBeInTheDocument();
  });

  it("saves a goal, how many months and the median from the settings", () => {
    setHook(null);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Goal and how a typical month is worked out" }));
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    expect(saveSettings).toHaveBeenLastCalledWith({ goalMonths: 6, averageMonths: 12, method: "average" });
    fireEvent.click(screen.getByRole("button", { name: "3 months" }));
    expect(saveSettings).toHaveBeenLastCalledWith({ goalMonths: null, averageMonths: 3, method: "average" });
    fireEvent.click(screen.getByRole("button", { name: "Median" }));
    expect(saveSettings).toHaveBeenLastCalledWith({ goalMonths: null, averageMonths: 12, method: "median" });
    const other = screen.getByLabelText("Goal in months");
    fireEvent.change(other, { target: { value: "9" } });
    fireEvent.blur(other);
    expect(saveSettings).toHaveBeenLastCalledWith({ goalMonths: 9, averageMonths: 12, method: "average" });
    fireEvent.change(other, { target: { value: "500" } });
    fireEvent.blur(other);
    expect(saveSettings).toHaveBeenCalledTimes(4);
  });

  it("says how a typical month was worked out", () => {
    setHook(null);
    settings = { goalMonths: null, averageMonths: 6, method: "median" };
    show();
    expect(screen.getByText(/median of the last 12 complete months, without loan interest/)).toBeInTheDocument();
  });

  it("names the goal above the bar, so it cannot meet the scale under it when the goal is near the end", () => {
    setHook(null);
    settings = { goalMonths: 11, averageMonths: 12, method: "average" };
    show();
    const scale = screen.getByText("12 months");
    expect(scale.parentElement).not.toHaveTextContent("your goal");
    const label = screen.getByText("your goal: 11 months");
    expect(label.style.transform).toBe("translateX(-100%)"); // ends at its mark rather than running past the edge
  });
});
