import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { buildVarianceModel } from "../../../lib/varianceInvestigation";
import { createVarianceFormat } from "../../../lib/varianceInvestigation/varianceFormat";
import { statesFor, type CategorySpec } from "../../../lib/varianceInvestigation/testing";
import { buildMonthPoints } from "../../../lib/varianceInvestigation";
import { DriverList } from "./DriverList";
import { TimelineChart } from "./TimelineChart";
import { VarianceSummary } from "./VarianceSummary";
import { WaterfallChart } from "./WaterfallChart";

// Charts measure themselves with ResizeObserver, which jsdom lacks.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const format = createVarianceFormat(false);
const exp = (id: string, budget: number, spent: number, group = id): CategorySpec => ({
  id,
  group,
  budgeted: -budget * 100,
  actuals: -spent * 100,
});

const SPECS = [
  exp("travel", 4000, 8000),
  exp("family", 2000, 3500),
  exp("transport", 1500, 2600),
  exp("shopping", 1000, 1700),
  exp("food", 3000, 3300),
  exp("utilities", 800, 1000),
  exp("leisure", 2500, 1000),
  exp("education", 3000, 2400),
  exp("rent", 12000, 12000),
];

function tracking(months = ["2026-08"], specs = SPECS) {
  return buildVarianceModel({
    mode: "tracking",
    side: "expense",
    months,
    statesByMonth: statesFor(Object.fromEntries(months.map((m) => [m, specs]))),
  });
}

describe("DriverList", () => {
  const model = tracking();
  const setup = (overrides = {}) => {
    const props = {
      model,
      format,
      selectedIds: ["g-travel"] as string[],
      filter: "all" as const,
      onFilter: jest.fn(),
      onSelect: jest.fn(),
      onDrill: jest.fn(),
      ...overrides,
    };
    render(<DriverList {...props} />);
    return props;
  };

  it("names what each share is measured against in the column heading, never the net", () => {
    setup();
    expect(screen.getByText("% of overspend / savings")).toBeInTheDocument();
    // Each row still says it in full for a screen reader.
    expect(screen.getByRole("button", { name: /^Group travel, .*% of overspend/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Group leisure, .*% of savings/ })).toBeInTheDocument();
  });

  it("narrows the share heading to the side being filtered", () => {
    setup({ filter: "favourable" });
    expect(screen.getByText("% of savings")).toBeInTheDocument();
    cleanup();
    setup({ filter: "unfavourable" });
    expect(screen.getByText("% of overspend")).toBeInTheDocument();
  });

  it("starts with nothing pressed when nothing is selected", () => {
    setup({ selectedIds: [] });
    for (const item of screen.getAllByRole("listitem")) {
      expect(within(item).getAllByRole("button").some((b) => b.getAttribute("aria-pressed") === "true")).toBe(false);
    }
  });

  it("selects on click and adds on Ctrl/Cmd-click", () => {
    const props = setup();
    const row = screen.getByRole("button", { name: /^Group family/ });
    fireEvent.click(row);
    expect(props.onSelect).toHaveBeenLastCalledWith(["family"], false);
    fireEvent.click(row, { ctrlKey: true });
    expect(props.onSelect).toHaveBeenLastCalledWith(["family"], true);
    fireEvent.click(row, { metaKey: true });
    expect(props.onSelect).toHaveBeenLastCalledWith(["family"], true);
  });

  it("drills into a group from its chevron without selecting it", () => {
    const props = setup();
    fireEvent.click(screen.getAllByRole("button", { name: /Drill into/ })[0]);
    expect(props.onDrill).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("marks the selected row as pressed", () => {
    setup({ selectedIds: ["family"] });
    expect(screen.getByRole("button", { name: /^Group family/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Group travel/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("offers Overspent and Saved for Tracking expenses", () => {
    setup();
    expect(screen.getByRole("button", { name: "Overspent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
  });

  it("offers Shortfall and Surplus for income", () => {
    const income = buildVarianceModel({
      mode: "tracking",
      side: "income",
      months: ["2026-08"],
      statesByMonth: statesFor({ "2026-08": [{ id: "salary", income: true, group: "gi", budgeted: 500000, actuals: 400000 }] }),
    });
    render(<DriverList model={income} format={format} selectedIds={[]} filter="all" onFilter={jest.fn()} onSelect={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Shortfall" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Surplus" })).toBeInTheDocument();
    expect(screen.getByText(/% of shortfall/)).toBeInTheDocument();
  });

  it("offers Deficit, Over allocation and Unspent for Envelope, and never says saved", () => {
    const envelope = buildVarianceModel({
      mode: "envelope",
      side: "expense",
      months: ["2026-08"],
      statesByMonth: statesFor({ "2026-08": [{ id: "a", group: "g1", budgeted: 10000, actuals: -15000, balance: -5000 }] }),
    });
    const { container } = render(
      <DriverList model={envelope} format={format} selectedIds={[]} filter="all" onFilter={jest.fn()} onSelect={jest.fn()} />
    );
    ["Deficit", "Over allocation", "Unspent"].forEach((name) =>
      expect(screen.getByRole("button", { name })).toBeInTheDocument()
    );
    expect(container.textContent?.toLowerCase()).not.toContain("saved");
    // The balance is a column, in red when below zero; the status is spoken on the row.
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^a, .*Deficit$/ })).toBeInTheDocument();
    expect(screen.getByText("−50")).toBeInTheDocument();
  });

  it("calls onFilter with the chosen filter", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Saved" }));
    expect(props.onFilter).toHaveBeenCalledWith("favourable");
  });

  it("lists every driver on one line each; the column scrolls rather than truncating", () => {
    setup();
    expect(model.drivers).toHaveLength(9);
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    // One row, one button, no second line of text under the name.
    const row = screen.getByRole("button", { name: /^Group travel/ });
    expect(row.querySelectorAll("span").length).toBeLessThanOrEqual(4);
  });
});

describe("WaterfallChart", () => {
  const model = tracking();

  it("starts at budget and ends at actual", () => {
    render(<WaterfallChart model={model} format={format} selectedIds={[]} onSelect={jest.fn()} />);
    expect(screen.getByRole("group", { name: /Budgeted to Spent/ })).toBeInTheDocument();
  });

  it("selects every driver an aggregated bar stands for", () => {
    const onSelect = jest.fn();
    render(<WaterfallChart model={model} format={format} selectedIds={[]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Other overspend/ }));
    const [ids] = onSelect.mock.calls[0];
    expect(ids.length).toBeGreaterThan(1);
    // Every member really is an unfavourable driver.
    for (const id of ids) {
      expect(model.drivers.find((d) => d.id === id)!.variance).toBeGreaterThan(0);
    }
  });

  it("passes the Ctrl/Cmd state through and works from the keyboard", () => {
    const onSelect = jest.fn();
    render(<WaterfallChart model={model} format={format} selectedIds={[]} onSelect={onSelect} />);
    const bar = screen.getByRole("button", { name: /^Group travel/ });
    fireEvent.click(bar, { ctrlKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(["travel"], true);
    fireEvent.keyDown(bar, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(["travel"], false);
  });

  it("does not make the budget and actual bars clickable", () => {
    render(<WaterfallChart model={model} format={format} selectedIds={[]} onSelect={jest.fn()} />);
    expect(screen.queryByRole("button", { name: /^Budgeted:/ })).not.toBeInTheDocument();
  });

  it("does not fade any bar when nothing is selected", () => {
    const { container } = render(<WaterfallChart model={model} format={format} selectedIds={[]} onSelect={jest.fn()} />);
    expect(container.querySelectorAll(".opacity-60")).toHaveLength(0);
    cleanup();
    const selected = render(<WaterfallChart model={model} format={format} selectedIds={["travel"]} onSelect={jest.fn()} />);
    expect(selected.container.querySelectorAll(".opacity-60").length).toBeGreaterThan(0);
  });

  it("marks selected bars as pressed", () => {
    render(<WaterfallChart model={model} format={format} selectedIds={["travel"]} onSelect={jest.fn()} />);
    expect(screen.getByRole("button", { name: /^Group travel/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Group family/ })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("TimelineChart", () => {
  const months = ["2026-01", "2026-02", "2026-03"];
  const model = tracking(months, [exp("a", 1000, 1500), exp("b", 1000, 900, "g2")]);

  it("filters by month on click, and toggles with the same click", () => {
    const onMonthClick = jest.fn();
    render(
      <TimelineChart model={model} format={format} points={model.monthly} periodMonths={months} showCumulative selectedMonth={null} onMonthClick={onMonthClick} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Feb 2026" }));
    expect(onMonthClick).toHaveBeenCalledWith("2026-02");
  });

  it("reports the cumulative variance, which equals the net", () => {
    render(<TimelineChart model={model} format={format} points={model.monthly} periodMonths={months} showCumulative selectedMonth={null} onMonthClick={jest.fn()} />);
    expect(model.monthly.at(-1)!.cumulative).toBe(model.gross.net);
    expect(screen.getByText(format.money(model.gross.net))).toBeInTheDocument();
    expect(screen.getByText("over budget")).toBeInTheDocument();
  });

  it("is context only, with no buttons, for a single-month period", () => {
    const single = tracking(["2026-08"]);
    const points = buildMonthPoints(single, ["2026-08"]);
    render(<TimelineChart model={single} format={format} points={points} periodMonths={["2026-08"]} showCumulative={false} selectedMonth={null} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("marks the selected month as pressed", () => {
    render(<TimelineChart model={model} format={format} points={model.monthly} periodMonths={months} showCumulative selectedMonth="2026-03" onMonthClick={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Mar 2026" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("VarianceSummary", () => {
  it("states the result and the equation that produces it", () => {
    render(<VarianceSummary model={tracking()} format={format} provisional={false} />);
    const m = tracking();
    expect(screen.getByText("over budget")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Variance equation" });
    expect(group).toHaveTextContent(`${format.money(m.gross.unfavourable)}overspent`);
    expect(group).toHaveTextContent(`${format.money(m.gross.favourable)}saved`);
    expect(group).toHaveTextContent(`${format.money(m.gross.net)}net over`);
  });

  it("puts the favourable amount first when the net is favourable, so it never subtracts to a negative", () => {
    const under = tracking(["2026-08"], [exp("a", 5000, 1000), exp("b", 1000, 1500, "g2")]);
    render(<VarianceSummary model={under} format={format} provisional={false} />);
    expect(screen.getByText("under budget")).toBeInTheDocument();
    const text = screen.getByRole("group", { name: "Variance equation" }).textContent!;
    expect(text.indexOf("saved")).toBeLessThan(text.indexOf("overspent"));
    expect(text).toContain("net under");
  });

  it("says so far for the current month", () => {
    render(<VarianceSummary model={tracking()} format={format} provisional />);
    expect(screen.getByText("over budget so far")).toBeInTheDocument();
  });

  it("uses shortfall, surplus and target wording for income", () => {
    const income = buildVarianceModel({
      mode: "tracking",
      side: "income",
      months: ["2026-08"],
      statesByMonth: statesFor({ "2026-08": [{ id: "salary", income: true, group: "gi", budgeted: 500000, actuals: 400000 }] }),
    });
    render(<VarianceSummary model={income} format={format} provisional={false} />);
    expect(screen.getByText("below target")).toBeInTheDocument();
    expect(screen.getByText("shortfall")).toBeInTheDocument();
    expect(screen.getByText("surplus")).toBeInTheDocument();
  });

  it("leads Envelope with the deficit and shows a bridge that reconciles", () => {
    const envelope = buildVarianceModel({
      mode: "envelope",
      side: "expense",
      months: ["2026-08"],
      statesByMonth: statesFor({
        "2026-08": [
          { id: "a", group: "g1", budgeted: 10000, actuals: -15000, balance: -5000 },
          { id: "b", group: "g2", budgeted: 10000, actuals: -2000, balance: 8000 },
        ],
      }),
    });
    const { container } = render(<VarianceSummary model={envelope} format={format} provisional={false} />);
    expect(screen.getAllByText("in deficit").length).toBeGreaterThan(0);
    expect(screen.getByRole("group", { name: "Closing balance" })).toHaveTextContent("available");
    expect(container.textContent).toContain("Balance bridge");
    expect(container.textContent).not.toContain("other adjustments");
    expect(container.textContent?.toLowerCase()).not.toContain("saved");
  });
});
