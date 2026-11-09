import { render, screen } from "@testing-library/react";
import { factsOf, inputOf, row, months, chk, home } from "@/lib/financial-insights/testing/progressFixture";
import type { AccountFact } from "@/lib/financial-insights/measures";
import { ProgressHost } from "./ProgressHost";

const useWealth = jest.fn();
jest.mock("../hooks/useWealth", () => ({ useWealth: (...args: unknown[]) => useWealth(...args) }));

const house: AccountFact = { id: "house", name: "Maple Cottage", accountClass: "property", treatment: null, offBudget: true };
const truck: AccountFact = { id: "truck", name: "Quartz Truck", accountClass: "vehicle", treatment: null, offBudget: true };
const holding: AccountFact = { id: "deposit", name: "Saffron Deposit", accountClass: "other-asset", treatment: null, offBudget: true };
const input = inputOf(factsOf([chk, house], months(1, 10).map((m) => row(m, "chk", 1_000_000, { categoryId: "salary" }))));
const registry = (over: Record<string, unknown> = {}) => ({ read: true, assets: [{ id: "home-1", name: "Maple Cottage", actualAccountId: "house", status: "active" }], metadata: [], debtLinks: [{ assetId: "home-1", debtId: "d1" }], assetEntries: [], assetRowCount: 0, savedClassifications: [], ...over });
const data = (over: Record<string, unknown> = {}) => ({ ...input, registry: registry(), drill: { today: "2026-11-18" }, ...over }) as never;
const show = (d = data()) => render(<ProgressHost data={d} today="2026-11-18" switches={{ showDates: true, showText: true }} onSwitches={jest.fn()} />);
const READY = { state: "ready", rows: [], series: {}, refreshing: false, hasFailedBooks: false, retryBooks: jest.fn() };
const UNAVAILABLE = "Some property cards may be missing because property values could not be read. See Property & assets for details.";

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

  it("does not count an archived asset, or an other-asset account that is only a holding and not a fixed asset", () => {
    useWealth.mockReturnValue({ ...READY, properties: [] });
    show(data({ registry: registry({ assets: [{ id: "home-1", name: "x", actualAccountId: "house", status: "archived" }] }) }));
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it("does not count a holding that is an Other Asset without the fixed-asset treatment", () => {
    useWealth.mockReturnValue({ ...READY, properties: [] });
    const withHolding = inputOf(factsOf([chk, holding], months(1, 10).map((m) => row(m, "chk", 1_000_000, { categoryId: "salary" }))));
    show({ ...withHolding, registry: registry({ assets: [{ id: "h", name: "x", actualAccountId: "deposit", status: "active" }], debtLinks: [] }), drill: { today: "2026-11-18" } } as never);
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it("does not warn about a vehicle whose book failed, or a registry that could not be read when there is no property", () => {
    useWealth.mockReturnValue({ ...READY, hasFailedBooks: true, properties: [{ ...home("home-1", [70, 69, 68, 67, 66, 65, 64, 63, 62, 61]), assetId: "home-1" }] });
    const withTruck = inputOf(factsOf([chk, house, truck], months(1, 10).map((m) => row(m, "chk", 1_000_000, { categoryId: "salary" }))));
    const { unmount } = show({ ...withTruck, registry: registry({ assets: [{ id: "home-1", name: "x", actualAccountId: "house", status: "active" }, { id: "t", name: "y", actualAccountId: "truck", status: "active" }] }), drill: { today: "2026-11-18" } } as never);
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
    unmount();
    useWealth.mockReturnValue({ ...READY, properties: [] });
    const none = inputOf(factsOf([chk, truck], months(1, 10).map((m) => row(m, "chk", 1_000_000, { categoryId: "salary" }))));
    show({ ...none, registry: registry({ read: false, assets: [], debtLinks: [] }), drill: { today: "2026-11-18" } } as never);
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it("says a property that is not registered in Assets has no card, and that vehicles do not need registering", () => {
    useWealth.mockReturnValue({ ...READY, properties: [] });
    const REGISTER = "A property is not registered in Assets, so it has no card here. Register it in Assets to add one.";
    show(data({ registry: registry({ assets: [], debtLinks: [] }) }));
    expect(screen.getByText(REGISTER)).toBeInTheDocument();
    const onlyTruck = inputOf(factsOf([chk, truck], months(1, 10).map((m) => row(m, "chk", 1_000_000, { categoryId: "salary" }))));
    show({ ...onlyTruck, registry: registry({ assets: [], debtLinks: [] }), drill: { today: "2026-11-18" } } as never);
    expect(screen.getAllByText(REGISTER)).toHaveLength(1);
  });
});
