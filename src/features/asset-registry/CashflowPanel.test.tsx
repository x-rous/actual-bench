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
  render(<CashflowPanel asset={asset} registry={grouped} external={withCategories} categories={categories} today="2026-10-24" fresh={jest.fn()} ensureExternal={jest.fn()} onSaved={jest.fn(async () => {})} />);
  const table = screen.getByLabelText("Asset income and expenses");
  expect(within(table).getByText("Income")).toBeInTheDocument(); expect(within(table).getByText("Expenses")).toBeInTheDocument();
  expect(within(table).getByText("Income subtotal").closest("tr")).toHaveTextContent("40.00"); // 50.00 rent less the 10.00 refund, which nets into its income category
  expect(within(table).getByText("Expenses subtotal").closest("tr")).toHaveTextContent("-7.00");
  expect(within(table).getByText(/Operating result/).closest("tr")).toHaveTextContent("33.00");
});
it("sorts inside each group without error", () => {
  render(<CashflowPanel asset={asset} registry={registry} external={external} today="2026-10-24" fresh={jest.fn()} ensureExternal={jest.fn()} onSaved={jest.fn(async () => {})} />);
  fireEvent.click(screen.getByRole("button", { name: /^Amount/ }));
  expect(screen.getAllByRole("row").length).toBeGreaterThan(4);
});
