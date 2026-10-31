import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { chooseSelectOption } from "@/components/ui/select.testing";
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
  expect(screen.getByText("Equity").nextElementSibling).toHaveTextContent("4,000.00");
  june.unmount();
  renderPanel("2026-07-31");
  expect(screen.getByText("Equity").nextElementSibling).toHaveTextContent("4,520.00");
  const table = screen.getByLabelText("Asset loan allocations");
  expect(within(table).getByText("Unallocated 40.00%")).toBeInTheDocument(); // the remainder is in the same table
});
it("makes equity unavailable instead of substituting data when the dated Actual balance is missing", () => {
  renderPanel("2026-07-31", debts(100000, null));
  expect(screen.getByText("Equity").nextElementSibling).toHaveTextContent("Unavailable");
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

it("starts a new allocation from the day the loan opened (not before the asset's first entry), with the free share and a preview", async () => {
  const other = [{ id: "second", name: "Equity loan", status: "active", liabilityAccountId: "liab2", blocked: null, signConvention: "negative-is-debt", openingDate: "2026-02-15", openingPrincipalMinor: 9000000, annualRateDecimal: "0.045", contractualTermMonths: 240 }] as unknown as DebtSummary[];
  const balanceAt = jest.fn(async () => 300000);
  render(<FinancingPanel asset={asset} registry={{ ...registry, debtLinks: [] }} loans={other} loansReady accounts={accounts} asOf="2026-10-24" onAsOf={jest.fn()} today="2026-10-24" firstDate="2026-03-01" valueAt={() => 500000} debtsAt={() => []} balanceAt={balanceAt} onSaved={jest.fn(async () => {})} />);
  fireEvent.click(screen.getByRole("button", { name: /Link loan/ }));
  await chooseSelectOption(screen.getByLabelText(/^Loan/), "Equity loan");
  expect(["01/03/2026", "03/01/2026"]).toContain((screen.getByLabelText(/^Effective from/) as HTMLInputElement).value); // 1 March in the display locale: the loan opened 15 Feb, before the asset's first entry on 1 Mar
  expect(screen.getByLabelText(/^Share of the loan/)).toHaveValue("100.00");
  expect(screen.getByText(/Original 90,000.00/)).toBeInTheDocument();
  const preview = screen.getByRole("complementary", { name: "What will happen" });
  await waitFor(() => expect(within(preview).getAllByText("2,000.00").length).toBeGreaterThan(0)); // 5,000.00 value - 3,000.00 debt = equity 2,000.00
  expect(within(preview).getByText(/Nothing changes in Actual or in the loan/)).toBeInTheDocument();
});
it("shows the loan-to-value and offers End on an open allocation", () => {
  renderPanel("2026-07-31");
  expect(screen.getByText("Loan-to-value").nextElementSibling).toHaveTextContent("%");
  expect(screen.getByRole("button", { name: /^End allocation for Mortgage/ })).toBeInTheDocument();
});
it("shows an empty state, not five empty tiles, while no loan is linked", () => {
  render(<FinancingPanel asset={asset} registry={{ ...registry, debtLinks: [] }} loans={loans} loansReady accounts={accounts} asOf="2026-07-31" onAsOf={jest.fn()} today="2026-10-24" valueAt={() => 500000} debtsAt={debts(100000, 80000)} onSaved={jest.fn(async () => {})} />);
  expect(screen.getByText("No loan linked")).toBeInTheDocument();
  expect(screen.getByText(/Link a loan from Loans to see this asset/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Asset financing summary")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Link loan" }));
  expect(screen.getByLabelText(/^Share of the loan/)).toBeInTheDocument();
});
it("shows the debt repaid on your share since the first link, and the regular payment scaled to your share", () => {
  const priced = [{ ...loans[0], repaymentFrequency: "monthly", annualRateDecimal: "0.045", contractualTermMonths: 300 }] as unknown as DebtSummary[];
  render(<FinancingPanel asset={asset} registry={registry} loans={priced} loansReady accounts={accounts} asOf="2026-07-31" onAsOf={jest.fn()} today="2026-10-24" valueAt={() => 500000} debtsAt={debts(100000, 80000)} repayments={{ loan: 10000 }} onSaved={jest.fn(async () => {})} />);
  const tile = (name: string) => within(screen.getByLabelText("Asset financing summary")).getByText(name).parentElement!;
  expect(tile("Equity built")).toHaveTextContent("120.00"); // the loan fell from 1,000.00 to 800.00; 60% of that is yours today. The cut from 100% to 60% is not a repayment
  expect(tile("Monthly payment")).toHaveTextContent("60.00"); expect(tile("Monthly payment")).toHaveTextContent("4.5% a year · 25 years");
});
it("offers the free share of the loan you pick, not of the one picked before it", async () => {
  const two = [{ ...loans[0], id: "first", name: "First loan", openingDate: "2026-01-01" }, { ...loans[0], id: "second", name: "Second loan", openingDate: "2026-01-01" }] as unknown as DebtSummary[];
  const held = { assets: [asset, testAsset("other")], metadata: [], debtLinks: [{ assetId: "other", debtId: "first", allocationBps: 7000, effectiveFrom: "2026-01-01", effectiveTo: null, note: null }] };
  render(<FinancingPanel asset={asset} registry={held} loans={two} loansReady accounts={accounts} asOf="2026-10-24" onAsOf={jest.fn()} today="2026-10-24" firstDate="2026-01-01" valueAt={() => 500000} debtsAt={() => []} balanceAt={async () => 100000} onSaved={jest.fn(async () => {})} />);
  fireEvent.click(screen.getByRole("button", { name: /Link loan/ }));
  await chooseSelectOption(screen.getByLabelText(/^Loan/), "First loan");
  expect(screen.getByLabelText(/^Share of the loan/)).toHaveValue("30.00"); // another asset holds 70% of it
  await chooseSelectOption(screen.getByLabelText(/^Loan/), "Second loan");
  expect(screen.getByLabelText(/^Share of the loan/)).toHaveValue("100.00"); // nobody holds the second
});
