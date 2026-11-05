import { fireEvent, render, screen, within } from "@testing-library/react";
import { CategoryHeatmap, type HeatGroupItem } from "./CategoryHeatmap";

const months = [{ key: "2026-09", label: "Sep 2026", partial: false }, { key: "2026-10", label: "Oct 2026", partial: true }];
const group = (name: string, total: number, order: number, rows: string[]): HeatGroupItem<string> => ({
  key: name, name, totalMinor: total, order, colour: "red", data: name,
  rows: rows.map((r, i) => ({ key: r, name: r, totalMinor: total / (i + 2), order: order + i, data: r })),
});
const groups = [group("Daily", 50_000, 2, ["Food", "Coffee"]), group("Home", 90_000, 1, ["Rent"])];

function setup(onCell = jest.fn()) {
  render(
    <CategoryHeatmap<string> id="h" title="Category by month" info={<p>about</p>} infoLabel="category by month" legend={<span>key</span>} months={months} groups={groups}
      renderCell={(item, i) => <td><button type="button" onClick={() => onCell(item.name, months[i].key)}>{item.name} {i}</button></td>} footer="Totals shown" />,
  );
  return onCell;
}
const order = () => screen.getAllByRole("rowheader").map((h) => h.textContent);

describe("category heatmap (shared by Spending and My budget)", () => {
  it("sorts groups by spend, highest first, and reverses, then by name and by budget order", () => {
    setup();
    expect(order()).toEqual(["Home", "Daily"]);
    fireEvent.click(screen.getByRole("button", { name: /Reverse the order/ }));
    expect(order()).toEqual(["Daily", "Home"]);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(order()).toEqual(["Daily", "Home"]);
    fireEvent.click(screen.getByRole("button", { name: "Budget order" }));
    expect(order()).toEqual(["Home", "Daily"]);
  });

  it("expands a group into its categories and marks the partial month in the header", () => {
    setup();
    expect(screen.queryByText("Coffee")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Daily" }));
    expect(screen.getByText("Coffee")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Oct 2026*" })).toBeInTheDocument();
    expect(screen.getByText("Totals shown")).toBeInTheDocument();
  });

  it("hands the clicked cell back to the caller with its row and month", () => {
    const onCell = setup();
    fireEvent.click(within(screen.getByRole("row", { name: /Home/ })).getByRole("button", { name: "Home 1" }));
    expect(onCell).toHaveBeenCalledWith("Home", "2026-10");
  });
});
