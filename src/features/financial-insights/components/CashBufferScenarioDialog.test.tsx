import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BufferCategoryRow } from "@/lib/financial-insights/bufferScenario";
import type { CashBuffer } from "@/lib/financial-insights/measures";
import { CashBufferScenarioDialog } from "./CashBufferScenarioDialog";

jest.mock("./DrillDialog", () => ({ DrillDialog: ({ target, onClose }: { target: unknown; onClose: () => void }) => <div role="dialog" aria-label="Transactions"><pre data-testid="target">{JSON.stringify(target)}</pre><button onClick={onClose}>Close list</button></div> }));

const rows: BufferCategoryRow[] = [
  { id: "rent", name: "Rent", group: "Housing", hidden: false, avgMinor: 200_000, order: 300, totalMinor: 2_400_000 },
  { id: "food", name: "Food", group: "Daily", hidden: false, avgMinor: 80_000, order: 201, totalMinor: 960_000 },
  { id: "fun", name: "Fun", group: "Daily", hidden: false, avgMinor: 40_000, order: 200, totalMinor: 480_000 },
];
const buffer = { months: 3_200_000 / 420_000, cashMinor: 3_200_000, monthlyNeedMinor: 420_000, spendingMinor: 320_000, spendingMonths: 12, loans: [{ accountId: "m", name: "Mortgage", monthlyMinor: 100_000, source: "schedule" }] } as CashBuffer;

function show(props: Partial<Parameters<typeof CashBufferScenarioDialog>[0]> = {}) {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  render(<CashBufferScenarioDialog buffer={buffer} rows={rows} basis="average of the last 12 complete months" scenario={null} saving={false} onSave={onSave} onClose={onClose} {...props} />);
  return { onSave, onClose };
}
const panel = () => screen.getByRole("complementary", { name: "The buffer in this scenario" });

describe("the cash buffer scenario dialog", () => {
  it("starts from the real buffer, with each group and its typical amount", () => {
    show();
    expect(panel()).toHaveTextContent("7.6 months");
    expect(panel()).toHaveTextContent("0 left out · 0 amounts changed");
    expect(screen.getByRole("checkbox", { name: "Include Housing" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include Daily" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include Mortgage" })).toBeChecked();
  });

  it("leaves a whole group out, with the result moving as it changes, and saves the adjustments with the result", async () => {
    const { onSave } = show();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Daily" }));
    expect(screen.getByRole("checkbox", { name: "Include Daily" })).not.toBeChecked();
    expect(panel()).toHaveTextContent("2 left out");
    // Need is 420,000 - 120,000 = 300,000: 10.7 months.
    expect(panel()).toHaveTextContent("10.7 months");
    fireEvent.change(screen.getByLabelText("Scenario name"), { target: { value: "Lean" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and show" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ name: "Lean", id: undefined, adjustments: { excluded: expect.arrayContaining(["food", "fun"]), amounts: {}, loansExcluded: [], loanAmounts: {} } });
    expect(saved.result.months).toBeCloseTo(3_200_000 / 300_000, 6);
    expect(saved.result.actualMonths).toBeCloseTo(buffer.months, 6);
  });

  it("shows a partly included group as a dash, and changes one category's amount, with a reset to the typical one", async () => {
    const { onSave } = show();
    fireEvent.click(screen.getByRole("button", { name: "Expand Daily" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Fun" }));
    expect((screen.getByRole("checkbox", { name: "Include Daily" }) as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Fun" }));

    const food = screen.getByLabelText("Food per month");
    fireEvent.change(food, { target: { value: "50.00" } });
    fireEvent.blur(food);
    expect(panel()).toHaveTextContent("1 amount changed");
    expect(screen.getByLabelText("Daily total per month")).toHaveValue("450.00");
    fireEvent.click(screen.getByRole("button", { name: "Save and show" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].adjustments.amounts).toEqual({ food: 5_000 });

    fireEvent.click(screen.getByRole("button", { name: "Reset Food" }));
    expect(screen.getByLabelText("Food per month")).toHaveValue("800.00");
    expect(panel()).toHaveTextContent("0 amounts changed");
  });

  it("scales a group's categories when its total is set", async () => {
    const { onSave } = show();
    const total = screen.getByLabelText("Daily total per month");
    fireEvent.change(total, { target: { value: "600.00" } });
    fireEvent.blur(total);
    fireEvent.click(screen.getByRole("button", { name: "Save and show" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // 80,000 : 40,000 is kept: 60,000 in all becomes 40,000 and 20,000.
    expect(onSave.mock.calls[0][0].adjustments.amounts).toEqual({ food: 40_000, fun: 20_000 });
  });

  it("changes and leaves out a loan's repayment", () => {
    show();
    const loan = screen.getByLabelText("Mortgage repayment per month");
    fireEvent.change(loan, { target: { value: "1200.00" } });
    fireEvent.blur(loan);
    expect(panel()).toHaveTextContent("1 amount changed");
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Mortgage" }));
    expect(panel()).toHaveTextContent("1 left out");
  });

  it("refuses an amount it cannot read, and cannot be saved when nothing is left to spend", () => {
    show({ buffer: { ...buffer, spendingMinor: 320_000 - 0, loans: [] } as CashBuffer });
    const food = (screen.getByRole("button", { name: "Expand Daily" }), screen.getByLabelText("Daily total per month"));
    fireEvent.change(food, { target: { value: "abc" } });
    fireEvent.blur(food);
    expect(food).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("checkbox", { name: "Include every category" }));
    expect(panel()).toHaveTextContent("Unavailable");
    expect(screen.getByRole("button", { name: "Save and show" })).toBeDisabled();
  });

  it("edits a saved scenario, saves it as a new one, and asks before deleting", async () => {
    const onDelete = jest.fn();
    const { onSave } = show({ scenario: { id: "s1", name: "Lean", adjustments: { excluded: ["fun"], amounts: {}, loansExcluded: [], loanAmounts: {} } }, onDelete });
    expect(screen.getByLabelText("Scenario name")).toHaveValue("Lean");
    fireEvent.click(screen.getByRole("button", { name: "Save as new" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: undefined, name: "Lean (copy)" });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument(); // Delete sits with Cancel, Save as new and Save and show
    fireEvent.click(screen.getByRole("button", { name: "Delete scenario" }));
    expect(onDelete).not.toHaveBeenCalled();
    // Asking replaces the buttons with the question.
    expect(screen.queryByRole("button", { name: "Save and show" })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByText("Delete this scenario?").parentElement as HTMLElement).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalled();
  });

  it("finds a category and resets everything", () => {
    show({ scenario: { id: "s1", name: "Lean", adjustments: { excluded: ["fun"], amounts: { food: 1_000 }, loansExcluded: [], loanAmounts: {} } } });
    fireEvent.change(screen.getByLabelText("Find a category"), { target: { value: "ren" } });
    expect(screen.getByLabelText("Rent per month")).toBeInTheDocument();
    expect(screen.queryByLabelText("Food per month")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find a category"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    expect(panel()).toHaveTextContent("0 left out · 0 amounts changed");
  });

  it("sorts by the order of the budget unless told otherwise, or by spend or name", () => {
    show();
    const order = () => screen.getAllByRole("checkbox", { name: /^Include (Housing|Daily)$/ }).map((c) => c.getAttribute("aria-label"));
    // Daily holds the first category of the budget (200), Housing the last (300).
    expect(order()).toEqual(["Include Daily", "Include Housing"]);
    fireEvent.click(screen.getByRole("button", { name: "Expand Daily" }));
    const inside = () => screen.getAllByLabelText(/^(Food|Fun) per month$/).map((i) => i.getAttribute("aria-label"));
    expect(inside()).toEqual(["Fun per month", "Food per month"]); // budget order: Fun (200) then Food (201)
    fireEvent.click(screen.getByRole("button", { name: "Spend" }));
    expect(order()).toEqual(["Include Housing", "Include Daily"]); // Housing 2,000 > Daily 1,200
    expect(inside()).toEqual(["Food per month", "Fun per month"]); // Food 800 > Fun 400
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(order()).toEqual(["Include Daily", "Include Housing"]);
    expect(inside()).toEqual(["Food per month", "Fun per month"]);
  });

  it("shows each row's part of the monthly need, and a bar in the group's colour", () => {
    show({ colours: new Map([["Housing", 3], ["Daily", 1]]) });
    // 2,000 of a 4,200 need.
    expect(screen.getByLabelText("Housing total per month").closest("div")?.parentElement).toHaveTextContent("47.6%");
    const swatch = screen.getByRole("button", { name: "Expand Housing" }).querySelector("span.rounded-sm") as HTMLElement;
    expect(swatch.style.background).toBe("var(--fi-g3)");
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Housing" }));
    expect(screen.getByLabelText("Housing total per month").closest("div")?.parentElement).toHaveTextContent("-");
  });

  it("keeps the name in the normal text colour", () => {
    show();
    expect(screen.getByLabelText("Scenario name").className).toContain("text-foreground");
  });

  it("lists the transactions behind a typical amount, for a category and for a group", () => {
    show({ window: { startMonth: "2025-11", endMonth: "2026-10" }, drill: { data: {} as never, today: "2026-11-18" } });
    fireEvent.click(screen.getByRole("button", { name: "Housing: see the transactions behind 2,000.00" }));
    expect(JSON.parse(screen.getByTestId("target").textContent ?? "")).toMatchObject({ kind: "category", categoryIds: ["rent"], name: "Housing", amountMinor: 2_400_000, month: "2025-11", throughMonth: "2026-10" });
    fireEvent.click(screen.getByRole("button", { name: "Close list" }));
    expect(screen.queryByTestId("target")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Daily" }));
    fireEvent.click(screen.getByRole("button", { name: "Daily: see the transactions behind 1,200.00" }));
    expect(JSON.parse(screen.getByTestId("target").textContent ?? "")).toMatchObject({ categoryIds: expect.arrayContaining(["food", "fun"]), amountMinor: 1_440_000 });
  });

  it("shows no link to transactions when the page's data is not given", () => {
    show();
    expect(screen.queryByRole("button", { name: /see the transactions behind/ })).not.toBeInTheDocument();
  });

  it("measures the scenario against the goal, and keeps the loan's source apart from its name", () => {
    show({ goalMonths: 12 });
    // 3,200,000 cash, 420,000 a month: 7.6 months, short of 12.
    expect(panel()).toHaveTextContent("4.4 months short of your 12-month goal.");
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Daily" }));
    expect(panel()).toHaveTextContent("1.3 months short of your 12-month goal.");
    expect(screen.getByText("scheduled")).toBeInTheDocument();
    expect(screen.getByText("Mortgage")).toBeInTheDocument();
  });

  it("says nothing of a goal when none is set", () => {
    show();
    expect(panel()).not.toHaveTextContent("goal");
  });

  it("ticks and unticks every category from the checkbox in the header, with a dash for some", () => {
    show();
    const all = () => screen.getByRole("checkbox", { name: "Include every category" }) as HTMLInputElement;
    expect(all()).toBeChecked();
    fireEvent.click(all());
    expect(all()).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include Housing" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include Daily" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Housing" }));
    expect(all().indeterminate).toBe(true);
    fireEvent.click(all());
    expect(all()).toBeChecked();
    expect(screen.queryByRole("button", { name: "Include all" })).not.toBeInTheDocument();
  });

  it("applies the header checkbox only to the categories a search shows", () => {
    show();
    fireEvent.change(screen.getByLabelText("Find a category"), { target: { value: "ren" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Include every category shown" }));
    fireEvent.change(screen.getByLabelText("Find a category"), { target: { value: "" } });
    expect(screen.getByRole("checkbox", { name: "Include Housing" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include Daily" })).toBeChecked();
  });

  it("says the loan interest is counted in the repayments, and not in the categories", () => {
    show({ loanInterestMinor: 150_000, rows: rows.map((r) => (r.id === "rent" ? { ...r, loanInterestMinor: 150_000 } : r)), window: { startMonth: "2025-11", endMonth: "2026-10" }, drill: { data: {} as never, today: "2026-11-18" } });
    expect(screen.getByText("Include 1,500.00 a month of interest and fees, which the categories above leave out")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Housing: see the transactions behind 2,000.00" })).toHaveAttribute("title", expect.stringContaining("1,500.00 a month of loan interest and fees, which the loan repayments count instead"));
    expect(screen.queryByText(/always counted/)).not.toBeInTheDocument();
  });
});
