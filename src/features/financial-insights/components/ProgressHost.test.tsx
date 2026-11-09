import { render, screen } from "@testing-library/react";
import { factsOf, inputOf, row, months, chk, home } from "@/lib/financial-insights/testing/progressFixture";
import type { AccountFact } from "@/lib/financial-insights/measures";
import { ProgressHost } from "./ProgressHost";

const useWealth = jest.fn();
jest.mock("../hooks/useWealth", () => ({ useWealth: (...args: unknown[]) => useWealth(...args) }));

const house: AccountFact = { id: "house", name: "Maple Cottage", accountClass: "property", treatment: null, offBudget: true };
const input = inputOf(factsOf([chk, house], months(1, 10).map((m) => row(m, "chk", 1_000_000, { categoryId: "salary" }))));
const registry = (over: Record<string, unknown> = {}) => ({ read: true, assets: [{ id: "home-1", name: "Maple Cottage", actualAccountId: "house", status: "active" }], metadata: [], debtLinks: [{ assetId: "home-1", debtId: "d1" }], assetEntries: [], assetRowCount: 0, savedClassifications: [], ...over });
const data = (over: Record<string, unknown> = {}) => ({ ...input, registry: registry(), drill: { today: "2026-11-18" }, ...over }) as never;
const show = (d = data()) => render(<ProgressHost data={d} today="2026-11-18" switches={{ showDates: true, showText: true }} onSwitches={jest.fn()} />);
const READY = { state: "ready", rows: [], series: {}, refreshing: false, hasFailedBooks: false, retryBooks: jest.fn() };
const UNAVAILABLE = "Property cards are unavailable because property values could not be read.";

beforeEach(() => jest.clearAllMocks());

describe("the Progress host and unreadable properties", () => {
  it("says so once when a property has no series, because its book did not reconcile, was too big, or could not be read", () => {
    useWealth.mockReturnValue({ ...READY, properties: [] });
    show();
    expect(screen.getAllByText(UNAVAILABLE)).toHaveLength(1);
  });

  it("says so when the registry could not be read", () => {
    useWealth.mockReturnValue({ ...READY, properties: [] });
    show(data({ registry: registry({ read: false, assets: [], debtLinks: [] }) }));
    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
  });

  it("says nothing when every property has its series, or when there is no property", () => {
    useWealth.mockReturnValue({ ...READY, properties: [{ ...home("home-1", [70, 69, 68, 67, 66, 65, 64, 63, 62, 61]), assetId: "home-1" }] });
    const { unmount } = show();
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
    unmount();
    useWealth.mockReturnValue({ ...READY, properties: [] });
    show(data({ registry: registry({ assets: [], debtLinks: [] }) }));
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it("does not count an archived asset, or an account that is no longer a fixed asset", () => {
    useWealth.mockReturnValue({ ...READY, properties: [] });
    show(data({ registry: registry({ assets: [{ id: "home-1", name: "x", actualAccountId: "house", status: "archived" }] }) }));
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });
});
