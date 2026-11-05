import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PickerInsights } from "./PickerInsights";
import { emptyFilterState, emptyPicks, fetchAllRows, fetchFacet, type FacetRow, type InsightPicks, type PickedTransaction, type PickerFilterState } from "./transactionPickerQuery";

jest.mock("@/store/connection", () => ({ selectActiveInstance: (s: unknown) => s, useConnectionStore: (select: (s: unknown) => unknown) => select({ id: "conn" }) }));
jest.mock("./transactionPickerQuery", () => ({ ...jest.requireActual("./transactionPickerQuery"), fetchFacet: jest.fn(), fetchAllRows: jest.fn() }));

const reference = {
  names: { account: (id: string) => `Account ${id}`, category: (id: string) => `Category ${id}`, payee: (id: string) => `Payee ${id}` },
  groupOf: (id: string) => (id === "c3" ? "Housing" : "Daily"),
};
const facets: Record<string, FacetRow[]> = {
  category: [{ key: "c1", amountMinor: -300_00, count: 3, month: "2026-01" }, { key: "c2", amountMinor: -100_00, count: 1, month: "2026-01" }, { key: "c3", amountMinor: -600_00, count: 2, month: "2026-02" }, { key: null, amountMinor: -50_00, count: 1, month: "2026-02" }],
  account: [{ key: "a1", amountMinor: -1050_00, count: 7, month: "2026-01" }],
  payee: [{ key: "p1", amountMinor: -500_00, count: 4, month: "2026-01" }, { key: null, amountMinor: -550_00, count: 3, month: "2026-02" }],
  day: [{ key: "2026-07-01", amountMinor: -100_00, count: 1 }, { key: "2026-07-09", amountMinor: -50_00, count: 1 }, { key: "2026-07-28", amountMinor: -70_00, count: 2 }],
  month: [{ key: "2025-12", amountMinor: -200_00, count: 2 }, { key: "2026-01", amountMinor: -400_00, count: 3 }, { key: "2026-02", amountMinor: -450_00, count: 2 }],
};
beforeEach(() => { jest.clearAllMocks(); jest.mocked(fetchFacet).mockImplementation(async (_c, _s, _k, _t, dim) => facets[dim]); });

const RANGE = emptyFilterState({ date: { preset: "custom", from: "2025-12-01", to: "2026-02-28" } });
function renderCharts(kind: "income" | "spending" | "mixed" = "spending", picks: InsightPicks = emptyPicks(), hide?: ("categories" | "groups" | "accounts" | "payees")[], state: PickerFilterState = RANGE, extra: { initialView?: "accounts"; noun?: string } = {}) {
  const onPicks = jest.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PickerInsights options={{ kind, hide, ...extra }} state={state} constraints={{}} picks={picks} onPicks={onPicks} reference={reference} today="2026-10-24" />
    </QueryClientProvider>);
  return onPicks;
}

describe("picker charts", () => {
  it("ranks where the money went with its share, and totals the entries in view", async () => {
    renderCharts();
    const list = await screen.findByRole("list", { name: "Categories" });
    const items = Array.from(list.querySelectorAll("[role=listitem]")).map((r) => r.textContent);
    expect(items[0]).toContain("Category c3");
    expect(items[0]).toContain("600");
    expect(items[0]).toContain("57%");
    expect(items.at(-1)).toContain("Uncategorized");
    expect(screen.getByRole("group", { name: "Averages for the entries in view" })).toHaveTextContent("Per month");
  });

  it("selects one row on a click, adds on Ctrl-click, and offers the groups view for spending only", async () => {
    const onPicks = renderCharts();
    fireEvent.click(await screen.findByRole("button", { name: /Category c1/ }));
    expect(onPicks).toHaveBeenLastCalledWith(expect.objectContaining({ categories: ["c1"] }));
    onPicks.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Category c2/ }), { ctrlKey: true });
    expect(onPicks).toHaveBeenLastCalledWith(expect.objectContaining({ categories: ["c2"] }));
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.click(await screen.findByRole("button", { name: /Housing/ }));
    expect(onPicks).toHaveBeenLastCalledWith(expect.objectContaining({ categories: ["c3"] }));
  });

  it("leaves out the views a caller hides, and Groups for anything but spending", async () => {
    renderCharts("income", emptyPicks(), ["payees"]);
    await screen.findByRole("list", { name: "Categories" });
    expect(screen.queryByRole("button", { name: "Groups" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Payees" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accounts" })).toBeInTheDocument();
  });

  it("opens on weeks when the list covers one month, marks the cut weeks partial, and selects a week", async () => {
    const onPicks = renderCharts("spending", emptyPicks(), undefined, emptyFilterState({ date: { preset: "custom", from: "2026-07-01", to: "2026-07-31" } }));
    const timeline = await screen.findByRole("list", { name: "Timeline" });
    const bars = Array.from(timeline.querySelectorAll("[role=listitem]"));
    // 29 Jun, 6 Jul, 13 Jul, 20 Jul and 27 Jul: the first and the last are cut by the month.
    expect(bars).toHaveLength(5);
    expect(bars[0]).toHaveTextContent("partial");
    expect(bars[1]).toHaveTextContent("week");
    expect(bars[4]).toHaveTextContent("partial");
    expect(screen.getByRole("button", { name: "Weeks" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Week of 6 Jul 2026/ }));
    expect(onPicks).toHaveBeenLastCalledWith(expect.objectContaining({ weeks: ["2026-07-06"], months: [] }));
  });

  it("opens on months for a longer list, and a user's choice of weeks is kept", async () => {
    renderCharts();
    await screen.findByRole("list", { name: "Timeline" });
    expect(screen.getByRole("button", { name: "Months" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Weeks" }));
    expect(screen.getByRole("button", { name: "Weeks" })).toHaveAttribute("aria-pressed", "true");
  });

  it("draws the timeline by month, selects a month, and groups into years", async () => {
    const onPicks = renderCharts();
    const timeline = await screen.findByRole("list", { name: "Timeline" });
    expect(timeline.querySelectorAll("[role=listitem]")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /Jan 2026: 400.00/ }));
    expect(onPicks).toHaveBeenLastCalledWith(expect.objectContaining({ months: ["2026-01"] }));
    fireEvent.click(screen.getByRole("button", { name: "Years" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Timeline" }).querySelectorAll("[role=listitem]")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /^2026: 850.00/ }));
    expect(onPicks).toHaveBeenLastCalledWith(expect.objectContaining({ months: ["2026-01", "2026-02"] }));
  });

  it("averages over every complete month of the period, empty ones included, and leaves out the current month", async () => {
    jest.mocked(fetchFacet).mockImplementation(async (_c, _s, _k, _t, dim) => dim === "month" ? [{ key: "2026-08", amountMinor: -300_00, count: 3 }, { key: "2026-10", amountMinor: -900_00, count: 2 }] : facets[dim]);
    renderCharts("spending", emptyPicks(), undefined, emptyFilterState({ date: { preset: "custom", from: "2026-08-01", to: "2026-10-24" } }));
    const timeline = await screen.findByRole("list", { name: "Timeline" });
    expect(timeline.querySelectorAll("[role=listitem]")).toHaveLength(3); // August, an empty September, and October
    // Complete months are August and September: 300 over two months, never over the one month that has entries.
    expect(screen.getByRole("group", { name: "Averages for the entries in view" })).toHaveTextContent("150 over 2 complete months");
    expect(screen.getByRole("button", { name: /Oct 2026 \(partial\)/ })).toBeInTheDocument();
    expect(screen.getByText(/hatched: this month, partial/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sep 2026: 0.00/ })).toBeInTheDocument();
  });

  it("draws a negative month below zero with its sign, and does not average a revaluation over one month", async () => {
    jest.mocked(fetchFacet).mockImplementation(async (_c, _s, _k, _t, dim) => dim === "month" ? [{ key: "2026-02", amountMinor: -156_000_00, count: 1 }] : [{ key: null, amountMinor: -156_000_00, count: 1, month: "2026-02" }]);
    renderCharts("mixed", emptyPicks(), undefined, emptyFilterState({ date: { preset: "custom", from: "2026-01-01", to: "2026-06-30" } }));
    const bar = await screen.findByRole("button", { name: /Feb 2026: -156,000.00/ });
    const fill = bar.querySelector("span[style*='--destructive']") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.bottom).toBe("0px"); // it rises from the bottom like any bar; the sign is in the label and the colour
    expect(screen.getByRole("group", { name: "Averages for the entries in view" })).toHaveTextContent("-26,000 over 6 complete months");
  });

  it("opens on the view a caller asks for", async () => {
    renderCharts("spending", emptyPicks(), undefined, RANGE, { initialView: "accounts", noun: "put into investments" });
    expect(await screen.findByRole("list", { name: "Accounts" })).toBeInTheDocument();
  });

  it("builds from the entries themselves when a tag needs an exact test, so the charts add up to the list", async () => {
    const entry = (id: string, amountMinor: number, categoryId: string | null, date: string): PickedTransaction => ({ id, accountId: "a1", accountName: "A", date, amountMinor, payeeId: null, payeeName: null, categoryId, categoryName: null, notes: "#rent", transferId: null });
    jest.mocked(fetchAllRows).mockResolvedValue({ rows: [entry("1", -100_00, "c1", "2026-01-05"), entry("2", -50_00, "c1", "2026-02-05"), entry("3", -25_00, null, "2026-02-06")], truncated: false });
    renderCharts("spending", emptyPicks(), undefined, { ...RANGE, tags: { names: ["#rent"], match: "any", none: false, not: false } });
    await waitFor(() => expect(screen.getByRole("list", { name: "Categories" }).textContent).toContain("Category c1"));
    expect(screen.getByRole("list", { name: "Categories" }).textContent).toContain("150");
    expect(fetchFacet).not.toHaveBeenCalled();
    const list = await screen.findByRole("list", { name: "Categories" });
    expect(list.textContent).toContain("Category c1");
  });

  it("says so, and shows no charts, when an exact test would need more entries than can be read", async () => {
    jest.mocked(fetchAllRows).mockResolvedValue({ rows: [], truncated: true });
    renderCharts("spending", emptyPicks(), undefined, { ...RANGE, search: "50%" });
    expect(await screen.findByText(/more than 20,000 match/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Timeline" })).not.toBeInTheDocument();
  });
});
