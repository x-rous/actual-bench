import { fireEvent, render, screen, within } from "@testing-library/react";
import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { testAsset, testRow } from "@/lib/asset-registry/testing";
import type { ExternalSnapshot } from "@/lib/asset-registry/cashflows";
import { CashflowPanel } from "./CashflowPanel";

jest.mock("./api", () => ({ registryRequest: jest.fn() }));
const asset = testAsset("flat");
const rows = normalizeActivity([testRow("rent", 5000, { accountId: "bank", payeeName: "Tenant" }), testRow("repair", -700, { accountId: "bank", payeeName: "Plumber" })]).rows;
const external = { rows, issues: [], accounts: [{ id: "bank", name: "Bank", offBudget: false, closed: false }], fetchedAt: "read" } as unknown as ExternalSnapshot;
const registry = { assets: [asset], metadata: [], cashflows: ["rent", "repair"].map((id) => ({ actualTransactionId: id, actualAccountId: "bank", assetId: "flat", classification: null, revision: 1 })) };

const categories = [{ id: "rent", isIncome: true }, { id: "repairs", isIncome: false }];
const withCategories = { ...external, rows: normalizeActivity([testRow("rent", 5000, { accountId: "bank", payeeName: "Tenant", categoryId: "rent" }), testRow("refund", -1000, { accountId: "bank", payeeName: "Tenant", categoryId: "rent" }), testRow("repair", -700, { accountId: "bank", payeeName: "Plumber", categoryId: "repairs" })]).rows } as unknown as ExternalSnapshot;
const grouped = { ...registry, cashflows: ["rent", "refund", "repair"].map((id) => ({ actualTransactionId: id, actualAccountId: "bank", assetId: "flat", classification: null, revision: 1 })) };

it("groups linked transactions into income and expenses by category type, with subtotals and a final result", () => {
  render(<CashflowPanel asset={asset} registry={grouped} external={withCategories} categories={categories} today="2026-10-24" range={{ preset: "all" }} onRangeChange={jest.fn()} fresh={jest.fn()} ensureExternal={jest.fn()} onSaved={jest.fn(async () => {})} />);
  const table = screen.getByLabelText("Asset income and expenses");
  expect(within(table).getByText("Income")).toBeInTheDocument(); expect(within(table).getByText("Expenses")).toBeInTheDocument();
  expect(within(table).getByText("Income").closest("tr")).toHaveTextContent("40.00"); // 50.00 rent less the 10.00 refund, which nets into its income category
  expect(within(table).getByText("Expenses").closest("tr")).toHaveTextContent("-7.00");
  expect(within(table).getByText(/Operating result/).closest("tr")).toHaveTextContent("33.00");
});
it("sorts inside each group without error", () => {
  render(<CashflowPanel asset={asset} registry={registry} external={external} today="2026-10-24" range={{ preset: "all" }} onRangeChange={jest.fn()} fresh={jest.fn()} ensureExternal={jest.fn()} onSaved={jest.fn(async () => {})} />);
  fireEvent.click(screen.getByRole("button", { name: "Amount" }));
  expect(screen.getAllByRole("row").length).toBeGreaterThan(4);
});
it("shows only the rows inside the chosen dates", () => {
  const dated = { ...external, rows: normalizeActivity([testRow("rent", 5000, { accountId: "bank", payeeName: "Tenant", date: "2025-06-01" }), testRow("repair", -700, { accountId: "bank", payeeName: "Plumber", date: "2026-02-01" })]).rows } as unknown as ExternalSnapshot;
  const props = { asset, registry, external: dated, today: "2026-10-24", fresh: jest.fn(), ensureExternal: jest.fn(), onSaved: jest.fn(async () => {}), onRangeChange: jest.fn() };
  const { rerender } = render(<CashflowPanel {...props} range={{ preset: "all" }} />);
  expect(screen.getByText("Tenant")).toBeInTheDocument(); expect(screen.getByText("Plumber")).toBeInTheDocument();
  rerender(<CashflowPanel {...props} range={{ preset: "this-year" }} />);
  expect(screen.queryByText("Tenant")).not.toBeInTheDocument(); expect(screen.getByText("Plumber")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Date filter: This year/ })).toBeInTheDocument();
});
it("narrows the linked rows with the picker's Payee, Category, Account and Amount chips", () => {
  const props = { asset, registry: grouped, external: withCategories, categories, today: "2026-10-24", range: { preset: "all" as const }, onRangeChange: jest.fn(), fresh: jest.fn(), ensureExternal: jest.fn(), onSaved: jest.fn(async () => {}) };
  render(<CashflowPanel {...props} />);
  const table = screen.getByLabelText("Asset income and expenses");
  expect(within(table).getAllByText("Tenant")).toHaveLength(2); expect(within(table).getByText("Plumber")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Payee filter" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Plumber" }));
  expect(within(table).queryByText("Tenant")).not.toBeInTheDocument(); expect(within(table).getByText("Plumber")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(within(table).getAllByText("Tenant")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Category filter" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Account filter" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Amount filter" })).toBeInTheDocument();
});
it("orders the filter chips Date, Amount, Payee, then Category and Account", () => {
  render(<CashflowPanel asset={asset} registry={registry} external={external} today="2026-10-24" range={{ preset: "all" }} onRangeChange={jest.fn()} fresh={jest.fn()} ensureExternal={jest.fn()} onSaved={jest.fn(async () => {})} />);
  expect(screen.getAllByRole("button", { name: /^(Date|Amount|Payee|Category|Account) filter/ }).map((b) => b.getAttribute("aria-label"))).toEqual(["Date filter", "Amount filter", "Payee filter", "Category filter", "Account filter"]);
});
it("unlinks only the selected rows that are still shown", async () => {
  const props = { asset, registry: grouped, external: withCategories, categories, today: "2026-10-24", range: { preset: "all" as const }, onRangeChange: jest.fn(), fresh: jest.fn(), ensureExternal: jest.fn(), onSaved: jest.fn(async () => {}) };
  render(<CashflowPanel {...props} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select visible cashflows" })); // all three
  expect(screen.getByText("3 selected")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Payee filter" })); fireEvent.click(screen.getByRole("checkbox", { name: "Plumber" }));
  expect(screen.getByText("1 selected")).toBeInTheDocument(); // the two Tenant rows are hidden now, so they are not part of the action
});
