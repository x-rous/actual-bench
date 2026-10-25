import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LinkRulesDialog } from "./LinkRulesDialog";
import { registryRequest } from "./api";
import { testAsset } from "@/lib/asset-registry/testing";
import type { LinkRule } from "@/lib/asset-registry/linkRules";

jest.mock("./api", () => ({ registryRequest: jest.fn() }));
jest.mock("@/components/transactions/useTransactionReference", () => ({ useTransactionReference: () => ({ ready: true, accountOptions: [], categoryOptions: [], payeeOptions: [{ value: "tenant", label: "Tenant" }], names: { payee: () => "Tenant", category: () => "Rent", account: () => "Bank" } }) }));
const rule: LinkRule = { id: "r1", assetId: "byd", name: "Rent unit 4", match: "all", conditions: [{ field: "payee", operator: "equals", value: "tenant" }, { field: "notes", operator: "hasTag", value: "#unit-4" }], classification: "rental-income", updatedAt: "now" };
const base = { asset: testAsset(), assetAccountIds: ["vehicles"], onSaved: jest.fn(async () => {}), onApply: jest.fn(), onClose: jest.fn() };
beforeEach(() => jest.clearAllMocks());

it("lists a rule in words and applies it", () => {
  render(<LinkRulesDialog {...base} registry={{ assets: [testAsset()], metadata: [], linkRules: [rule] }} />);
  expect(screen.getByText(/payee is Tenant and notes has tag #unit-4 → Rental Income/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(base.onApply).toHaveBeenCalledWith(rule);
});
it("builds a condition as field, operation and value, and validates before saving", async () => {
  jest.mocked(registryRequest).mockResolvedValue({ assets: [], metadata: [] });
  render(<LinkRulesDialog {...base} registry={{ assets: [testAsset()], metadata: [], linkRules: [rule] }} />);
  fireEvent.click(screen.getByRole("button", { name: "New rule" }));
  fireEvent.change(screen.getByLabelText("Rule name"), { target: { value: "Fuel" } });
  fireEvent.click(screen.getByRole("button", { name: "Save rule" })); // the payee condition has no value yet
  expect(await screen.findByText(/Enter a value for every condition/)).toBeInTheDocument();
  expect(registryRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Field")); // Payee
  fireEvent.pointerDown(await screen.findByRole("option", { name: "Amount" }), { pointerType: "mouse" });
  fireEvent.click(screen.getByRole("option", { name: "Amount" }), { detail: 1 });
  await waitFor(() => expect(screen.getByLabelText("Field")).toHaveTextContent("Amount"));
  fireEvent.change(screen.getByLabelText("Condition value"), { target: { value: "-350.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
  await waitFor(() => expect(registryRequest).toHaveBeenCalledWith("budget", "PUT", { __path: "rules", assetId: "byd", operation: { kind: "save", rule: { name: "Fuel", match: "all", classification: null, conditions: [{ field: "amount", operator: "equals", value: "-350.00" }] } } }));
});
it("deletes a rule", async () => {
  jest.mocked(registryRequest).mockResolvedValue({ assets: [], metadata: [] });
  render(<LinkRulesDialog {...base} registry={{ assets: [testAsset()], metadata: [], linkRules: [rule] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete rule Rent unit 4" }));
  await waitFor(() => expect(registryRequest).toHaveBeenCalledWith("budget", "PUT", { __path: "rules", assetId: "byd", operation: { kind: "delete", id: "r1" } }));
});
