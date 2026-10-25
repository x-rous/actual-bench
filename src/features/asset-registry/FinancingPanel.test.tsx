import { fireEvent, render, screen, within } from "@testing-library/react";
import { testAsset } from "@/lib/asset-registry/testing";
import type { AssetDebtLink } from "@/lib/asset-registry/financing";
import type { DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import type { Account } from "@/types/entities";
import { FinancingPanel } from "./FinancingPanel";
import { registryRequest } from "./api";
jest.mock("./api", () => ({ registryRequest: jest.fn() }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const asset = testAsset("house");
const link = (from: string, to: string | null, bps: number): AssetDebtLink => ({ assetId: "house", debtId: "loan", allocationBps: bps, effectiveFrom: from, effectiveTo: to, note: null });
const registry = { assets: [asset], metadata: [], debtLinks: [link("2026-01-01", "2026-07-01", 10000), link("2026-07-01", null, 6000)] };
const loans = [{ id: "loan", name: "Mortgage", status: "active", liabilityAccountId: "liab", blocked: null, signConvention: "negative-is-debt" }] as unknown as DebtSummary[];
const accounts = [{ id: "liab", name: "Mortgage account" }] as Account[];
const debts = (june: number | null, july: number | null) => (on: string) => [{ debtId: "loan", magnitudeMinor: on < "2026-07-01" ? june : july }];
const renderPanel = (asOf: string, debtsAt = debts(100000, 80000)) => render(<FinancingPanel asset={asset} registry={registry} loans={loans} loansReady accounts={accounts} asOf={asOf} onAsOf={jest.fn()} today="2026-10-24" valueAt={() => 500000} debtsAt={debtsAt} onSaved={jest.fn(async () => {})} />);
beforeEach(() => jest.clearAllMocks());
it("shows June at 100% and July at 60% from same-date Actual debt, with the remainder explicit", () => {
  const june = renderPanel("2026-06-30");
  expect(screen.getByText("Tracked equity").nextElementSibling).toHaveTextContent("4,000.00");
  june.unmount();
  renderPanel("2026-07-31");
  expect(screen.getByText("Tracked equity").nextElementSibling).toHaveTextContent("4,520.00");
  const table = screen.getByLabelText("Asset loan allocations");
  expect(within(table).getByText("Unallocated 40.00%")).toBeInTheDocument(); // the remainder is in the same table
});
it("makes equity unavailable instead of substituting data when the dated Actual balance is missing", () => {
  renderPanel("2026-07-31", debts(100000, null));
  expect(screen.getByText("Tracked equity").nextElementSibling).toHaveTextContent("Unavailable");
  expect(screen.getByText(/Actual loan balance is unavailable on that date/)).toBeInTheDocument();
});
it("saves a change with the loan's expected period set and surfaces a stale refusal", async () => {
  jest.mocked(registryRequest).mockRejectedValueOnce(new Error("This loan's allocations changed. Refresh; your draft is preserved."));
  renderPanel("2026-07-31");
  fireEvent.click(screen.getAllByRole("button", { name: /^Change allocation for Mortgage from/ })[1]);
  fireEvent.change(screen.getByLabelText(/^Share of the loan/), { target: { value: "50" } });
  fireEvent.click(screen.getByRole("button", { name: "Save allocation" }));
  await screen.findByText(/allocations changed/);
  const body = jest.mocked(registryRequest).mock.calls[0][2] as { debtId: string; operation: { allocationBps: number }; expectedFingerprint: string; __path: string };
  expect(body).toMatchObject({ __path: "financing", debtId: "loan", operation: { kind: "set", allocationBps: 5000 } }); expect(body.expectedFingerprint).toContain("2026-07-01");
});
