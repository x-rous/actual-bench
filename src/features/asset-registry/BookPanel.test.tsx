import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BookPanel } from "./BookPanel";
import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { tagTransport, testAsset, testRow } from "@/lib/asset-registry/testing";
import { registryRequest } from "./api";
import type { ActionContext } from "@/lib/asset-registry/actions";
import type { BookSnapshot } from "@/lib/asset-registry/ledger";
jest.mock("./api", () => ({ registryRequest: jest.fn() }));
jest.mock("./BookActionEditor", () => ({ BookActionEditor: ({ kind, row, onUncertain, onClose }: { kind: string; row?: { id: string }; onUncertain: () => void; onClose: () => void }) => <><output aria-label="Editor operation">{kind}:{row?.id ?? "new"}</output><button onClick={() => { onUncertain(); onClose(); }}>Simulate uncertain write and close</button></> }));
it("keeps financial actions locked after an uncertain editor closes until explicit refresh", () => {
  const source = [testRow("opening", 100)];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "first-read", transferKnown: true };
  const props = { asset: testAsset(), registry: { assets: [testAsset()], metadata: [] }, snapshot, fresh: jest.fn(), onSaved: jest.fn() };
  const view = render(<BookPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  fireEvent.click(screen.getByRole("button", { name: "Simulate uncertain write and close" }));
  expect(screen.getByRole("button", { name: "Add Transaction" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Update value" })).toBeDisabled();
  expect(screen.getByText(/previous Actual write has an uncertain outcome/)).toBeInTheDocument();
  view.rerender(<BookPanel {...props} snapshot={{ ...snapshot, fetchedAt: "explicit-refresh" }} />);
  expect(screen.getByRole("button", { name: "Add Transaction" })).toBeEnabled();
});

it("classifies protected transfers without changing their assignment", async () => {
  const source = [testRow("opening", 100, { notes: "#asset_byd", transferId: "peer" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "read", transferKnown: true };
  const registry = { assets: [testAsset(), testAsset("toyota")], metadata: [{ actualTransactionId: "opening", actualAccountId: "vehicles", assetId: "byd", classification: "opening-balance", revision: 1 }] };
  const fresh = jest.fn(async () => ({ registry, snapshot, transport: tagTransport() }) as unknown as ActionContext);
  const onSaved = jest.fn(async () => {});
  jest.mocked(registryRequest).mockResolvedValue(registry);
  render(<BookPanel asset={testAsset()} registry={registry} snapshot={snapshot} fresh={fresh} onSaved={onSaved} />);
  expect(screen.getByRole("button", { name: "Edit transaction 2026-01-01 1.00" })).toBeEnabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select - 2026-01-01" }));
  fireEvent.click(screen.getByRole("button", { name: "Classify…" }));
  fireEvent.click(screen.getByRole("radio", { name: "Revaluation / Appreciation" }));
  fireEvent.click(screen.getByRole("button", { name: "Set type" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(registryRequest).toHaveBeenLastCalledWith("budget", "PATCH", { changes: [{ actualTransactionId: "opening", actualAccountId: "vehicles", assetId: "byd", classification: "revaluation", revision: 1 }] });
});

it.each([100, -100])("opens a sign-filtered type popup for amount %s", async (amount) => {
  const source = [testRow("row", amount)];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: amount, issues: [], fetchedAt: "read", transferKnown: true };
  const registry = { assets: [testAsset()], metadata: [] };
  jest.mocked(registryRequest).mockClear().mockResolvedValue(registry);
  render(<BookPanel asset={testAsset()} registry={registry} snapshot={snapshot} fresh={async () => ({ registry, snapshot, transport: tagTransport() }) as unknown as ActionContext} onSaved={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Classify - on 2026-01-01" }));
  expect(screen.queryByRole("dialog", { name: "Classify Account Transactions" })).not.toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "Depreciation" }) !== null).toBe(amount < 0);
  expect(screen.queryByRole("radio", { name: "Acquisition / Purchase" }) !== null).toBe(amount > 0);
  fireEvent.click(screen.getByRole("radio", { name: "Revaluation / Appreciation" }));
  fireEvent.click(screen.getByRole("button", { name: "Set type" }));
  await waitFor(() => expect(registryRequest).toHaveBeenCalledWith("budget", "PATCH", { changes: [expect.objectContaining({ classification: "revaluation", assetId: null })] }));
});

it("opens the editor only from the row's edit icon or Add Transaction, never from clicking the row", () => {
  const source = [testRow("opening", 100)];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "read", transferKnown: true };
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset()], metadata: [] }} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  fireEvent.click(screen.getByRole("row", { name: "- · 2026-01-01 · 1.00" }));
  expect(screen.queryByLabelText("Editor operation")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit transaction 2026-01-01 1.00" }));
  expect(screen.getByLabelText("Editor operation")).toHaveTextContent("edit:opening");
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  expect(screen.getByLabelText("Editor operation")).toHaveTextContent("create:new");
  expect(screen.queryByRole("button", { name: /Assign whole/ })).not.toBeInTheDocument();
});
it("shows only the period and types chosen from a chart event, with a visible filter chip and a Clear action", () => {
  const source = [testRow("capex", 100, { date: "2026-03-02" }), testRow("dep", -10, { date: "2026-03-31" }), testRow("old", 5, { date: "2025-01-01" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 95, issues: [], fetchedAt: "read", transferKnown: true };
  const registry = { assets: [testAsset()], metadata: [{ actualTransactionId: "capex", actualAccountId: "vehicles", assetId: "byd", classification: "capital-expenditure", revision: 1 }, { actualTransactionId: "dep", actualAccountId: "vehicles", assetId: "byd", classification: "depreciation", revision: 1 }] };
  const onClearFocus = jest.fn();
  render(<BookPanel asset={testAsset()} registry={registry} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} focus={{ from: "2026-03-01", to: "2026-03-31", types: ["capital-expenditure"], label: "Capital Expenditure · Mar 2026" }} onClearFocus={onClearFocus} />);
  expect(screen.getByText(/From the chart: Capital Expenditure · Mar 2026/)).toBeInTheDocument();
  expect(screen.getAllByRole("row").filter((r) => /2026/.test(r.getAttribute("aria-label") ?? ""))).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Clear filter Capital Expenditure · Mar 2026" }));
  expect(onClearFocus).toHaveBeenCalled();
});
it("has no KPI strip; its status line gives the recorded value, and the net of what is shown once the list is narrowed", () => {
  const source = [testRow("a", 100, { date: "2026-03-02" }), testRow("b", -30, { date: "2026-03-31" }), testRow("c", 5, { date: "2026-04-01" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 75, issues: [], fetchedAt: "read", transferKnown: true };
  const registry = { assets: [testAsset()], metadata: [{ actualTransactionId: "a", actualAccountId: "vehicles", assetId: "byd", classification: "revaluation", revision: 1 }] };
  render(<BookPanel asset={testAsset()} registry={registry} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.queryByLabelText("Account transactions summary")).not.toBeInTheDocument();
  expect(screen.getByText(/3 transactions/)).toHaveTextContent("0.75 recorded value");
  fireEvent.change(screen.getByLabelText("Search account transactions"), { target: { value: "zzz" } });
  fireEvent.click(screen.getByRole("button", { name: /Unclassified/ }));
  expect(screen.getByText(/transactions? ·/)).toHaveTextContent(/net/);
});
it("offers the sale or write-off beside Update value, as one button", () => {
  const source = [testRow("opening", 100)];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "read", transferKnown: true };
  const onCapitalAction = jest.fn();
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset()], metadata: [] }} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} onCapitalAction={onCapitalAction} />);
  expect(screen.queryByRole("button", { name: "Record" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Record a sale or write-off" }));
  expect(onCapitalAction).toHaveBeenCalledWith("dispose");
});
it("makes All mean this asset's rows plus unassigned ones, and shows other assets only on request in a shared account", () => {
  const source = [testRow("mine", 100, { date: "2026-03-01", notes: "#asset_byd" }), testRow("free", 5, { date: "2026-03-02" }), testRow("theirs", 50, { date: "2026-03-03", notes: "#asset_toyota" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 155, issues: [], fetchedAt: "read", transferKnown: true };
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset(), testAsset("toyota")], metadata: [] }} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  const rowsShown = () => screen.getAllByRole("row").filter((r) => /2026/.test(r.getAttribute("aria-label") ?? "")).length;
  expect(rowsShown()).toBe(2); // mine + unassigned
  expect(screen.queryByRole("button", { name: /Whole account/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show other assets' transactions" }));
  expect(rowsShown()).toBe(3);
});
it("puts the cleared marker right after the amount", () => {
  const source = [testRow("a", 100)];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "read", transferKnown: true };
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset()], metadata: [] }} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
  expect(headers.indexOf("Cleared")).toBe(headers.indexOf("Amount") + 1);
  expect(headers.indexOf("Running value")).toBeGreaterThan(headers.indexOf("Cleared"));
});
