import { fireEvent, render } from "@testing-library/react";
import { BudgetBars, signedCompact } from "./BudgetBars";

const tip = () => null;
const colours = { within: "#2a8", over: "#c22", block: "#456" };
const labels = ["Jan", "Feb", "Mar", "Apr"];
// Jan over its budget, Feb under it, Mar exactly on it, Apr has nothing to draw.
const spent = [80_000, 40_000, 50_000, null];
const budget = [60_000, 50_000, 50_000, null];

function chart(over: Partial<React.ComponentProps<typeof BudgetBars>> = {}) {
  return render(<BudgetBars labels={labels} partialIndex={null} spent={spent} budget={budget} tip={tip} ariaLabel="Spent against budget" {...colours} {...over} />);
}
const bars = (container: HTMLElement) => [...container.querySelectorAll("rect[fill]")].map((r) => r.getAttribute("fill")).filter((f) => f !== "transparent");
const decorative = (container: HTMLElement) => [...container.querySelectorAll("text[aria-hidden='true']")].map((t) => t.textContent);

describe("signedCompact", () => {
  it("signs a month under its budget + and one over it −, and writes one exactly on it as 0", () => {
    expect(signedCompact(240_000)).toBe("+2.4k");
    expect(signedCompact(-1_400_000)).toBe("−14k");
    expect(signedCompact(0)).toBe("0");
  });

  it("writes amounts under a thousand as whole units, so none reads like a balance beside its neighbours", () => {
    expect(signedCompact(-8_988)).toBe("−90");
    expect(signedCompact(850)).toBe("+8.5");
    expect(signedCompact(-32)).toBe("−0.3");
  });
});

describe("BudgetBars", () => {
  it("draws a budget block behind each month that has a budget, and none for a month without", () => {
    const { container } = chart();
    expect(bars(container).filter((f) => f === colours.block)).toHaveLength(3);
  });

  it("draws a bar over its budget in the over colour and one within it in the other, with a month on its budget within", () => {
    const { container } = chart();
    expect(bars(container).filter((f) => f === colours.over)).toHaveLength(1);
    expect(bars(container).filter((f) => f === colours.within)).toHaveLength(2);
  });

  it("writes what was spent above each bar and how far under or over its budget in a row beneath", () => {
    const { container } = chart();
    // Month by month: the spent figure, then the variance. Jan is 200 over, Feb 100 under, Mar on its budget.
    expect(decorative(container)).toEqual(["800", "−200", "400", "+100", "500", "0"]);
  });

  it("puts the spent figure above the budget block when the block is the taller", () => {
    const { container } = chart();
    const figure = [...container.querySelectorAll("text[aria-hidden='true']")][2]; // Feb's spent figure: 40k spent of 50k budgeted
    const block = [...container.querySelectorAll("rect[fill='#456']")][1];
    expect(Number(figure.getAttribute("y"))).toBeLessThan(Number(block.getAttribute("y")));
  });

  it("says nothing in the row for the partial month, which is not compared, and draws it lighter and dashed", () => {
    const { container } = chart({ partialIndex: 2 });
    expect(decorative(container).slice(0, 5)).toEqual(["800", "−200", "400", "+100", "500"]);
    expect(decorative(container)[5]).toBe("–");
    expect(container.textContent).toContain("Mar*");
    expect(container.querySelectorAll("rect[fill-opacity='0.45']")).toHaveLength(1);
    expect(container.querySelectorAll("rect[stroke-dasharray]").length).toBeGreaterThanOrEqual(2);
  });

  it("leaves the figures out when the months are too narrow for them", () => {
    const many = Array.from({ length: 40 }, (_, i) => `M${i}`);
    const { container } = chart({ labels: many, spent: many.map(() => 40_000), budget: many.map(() => 50_000) });
    expect(decorative(container)).toEqual([]);
  });

  it("reports the month of a selected bar, and gives a month without a value nothing to select", () => {
    const onSelect = jest.fn();
    const { getAllByRole } = chart({ onSelect });
    const buttons = getAllByRole("button");
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith(1);
    fireEvent.keyDown(buttons[2], { key: " " });
    expect(onSelect).toHaveBeenLastCalledWith(2);
  });

  it("hangs a month of refunds below zero and still compares it with its budget", () => {
    const { container } = chart({ spent: [-10_000, 0, 0, null], budget: [50_000, 0, null, null] });
    expect(container.querySelector("line[stroke='var(--muted-foreground)']")).not.toBeNull();
    expect(decorative(container)).toContain("+600");
  });
});
