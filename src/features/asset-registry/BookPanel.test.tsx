import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BookPanel } from "./BookPanel";
import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { tagTransport, testAsset, testRow } from "@/lib/asset-registry/testing";
import { registryRequest } from "./api";
import type { ActionContext } from "@/lib/asset-registry/actions";
import type { BookSnapshot } from "@/lib/asset-registry/ledger";
jest.mock("./api", () => ({ registryRequest: jest.fn() }));
jest.mock("./BookActionEditor", () => ({ BookActionEditor: ({ kind, row, initialClassification, onUncertain, onClose }: { kind: string; row?: { id: string }; initialClassification?: string; onUncertain: () => void; onClose: () => void }) => <><output aria-label="Editor operation">{kind}:{row?.id ?? "new"}</output><output aria-label="Editor type">{initialClassification ?? "none"}</output><button onClick={() => { onUncertain(); onClose(); }}>Simulate uncertain write and close</button></> }));
const addEntry = () => { fireEvent.click(screen.getByRole("button", { name: "Add Entry" })); fireEvent.click(screen.getByRole("menuitem", { name: /Value adjustment/ })); };
it("keeps financial actions locked after an uncertain editor closes until explicit refresh", () => {
  const source = [testRow("opening", 100)];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "first-read", transferKnown: true };
  const props = { asset: testAsset(), registry: { assets: [testAsset()], metadata: [] }, snapshot, fresh: jest.fn(), onSaved: jest.fn() };
  const view = render(<BookPanel {...props} />);
  addEntry();
  fireEvent.click(screen.getByRole("button", { name: "Simulate uncertain write and close" }));
  expect(screen.getByRole("button", { name: "Add Entry" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Update value" })).toBeDisabled();
  expect(screen.getByText(/previous Actual write has an uncertain outcome/)).toBeInTheDocument();
  view.rerender(<BookPanel {...props} snapshot={{ ...snapshot, fetchedAt: "explicit-refresh" }} />);
  expect(screen.getByRole("button", { name: "Add Entry" })).toBeEnabled();
});

it("classifies protected transfers without changing their assignment", async () => {
  const source = [testRow("opening", 100, { notes: "#asset_byd", transferId: "peer" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "read", transferKnown: true };
  const registry = { assets: [testAsset(), testAsset("toyota")], metadata: [{ actualTransactionId: "opening", actualAccountId: "vehicles", assetId: "byd", classification: "opening-balance", revision: 1 }] };
  const fresh = jest.fn(async () => ({ registry, snapshot, transport: tagTransport() }) as unknown as ActionContext);
  const onSaved = jest.fn(async () => {});
  jest.mocked(registryRequest).mockResolvedValue(registry);
  render(<BookPanel asset={testAsset()} registry={registry} snapshot={snapshot} fresh={fresh} onSaved={onSaved} />);
  expect(screen.getByRole("button", { name: "Edit entry 2026-01-01 1.00" })).toBeEnabled();
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
  expect(screen.queryByRole("dialog", { name: "Classify Asset Ledger" })).not.toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "Depreciation" }) !== null).toBe(amount < 0);
  expect(screen.queryByRole("radio", { name: "Acquisition / Purchase" }) !== null).toBe(amount > 0);
  fireEvent.click(screen.getByRole("radio", { name: "Revaluation / Appreciation" }));
  fireEvent.click(screen.getByRole("button", { name: "Set type" }));
  await waitFor(() => expect(registryRequest).toHaveBeenCalledWith("budget", "PATCH", { changes: [expect.objectContaining({ classification: "revaluation", assetId: null })] }));
});

it("opens the editor only from the row's edit icon or Add Entry, never from clicking the row", () => {
  const source = [testRow("opening", 100)];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "read", transferKnown: true };
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset()], metadata: [] }} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  fireEvent.click(screen.getByRole("row", { name: "- · 2026-01-01 · 1.00" }));
  expect(screen.queryByLabelText("Editor operation")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit entry 2026-01-01 1.00" }));
  expect(screen.getByLabelText("Editor operation")).toHaveTextContent("edit:opening");
  addEntry();
  expect(screen.getByLabelText("Editor operation")).toHaveTextContent("create:new");
  expect(screen.queryByRole("button", { name: /Assign whole/ })).not.toBeInTheDocument();
});
it("shows only the period and types chosen from a chart event, with a visible filter chip and a Clear action", () => {
  const source = [testRow("capex", 100, { date: "2026-03-02" }), testRow("dep", -10, { date: "2026-03-31" }), testRow("old", 5, { date: "2025-01-01" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 95, issues: [], fetchedAt: "read", transferKnown: true };
  const registry = { assets: [testAsset()], metadata: [{ actualTransactionId: "capex", actualAccountId: "vehicles", assetId: "byd", classification: "acquisition", revision: 1 }, { actualTransactionId: "dep", actualAccountId: "vehicles", assetId: "byd", classification: "depreciation", revision: 1 }] };
  const onClearFocus = jest.fn();
  render(<BookPanel asset={testAsset()} registry={registry} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} focus={{ from: "2026-03-01", to: "2026-03-31", types: ["acquisition"], label: "Purchases · Mar 2026" }} onClearFocus={onClearFocus} />);
  expect(screen.getByText(/From the chart: Purchases · Mar 2026/)).toBeInTheDocument();
  expect(screen.getAllByRole("row").filter((r) => /2026/.test(r.getAttribute("aria-label") ?? ""))).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Clear filter Purchases · Mar 2026" }));
  expect(onClearFocus).toHaveBeenCalled();
});
it("summarises the entries shown, and follows the search and the date range except for the unclassified count", () => {
  const source = [testRow("a", 100, { date: "2026-03-02" }), testRow("b", -30, { date: "2026-03-31" }), testRow("c", 5, { date: "2026-04-01" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 75, issues: [], fetchedAt: "read", transferKnown: true };
  const registry = { assets: [testAsset()], metadata: [{ actualTransactionId: "a", actualAccountId: "vehicles", assetId: "byd", classification: "revaluation", revision: 1 }] };
  render(<BookPanel asset={testAsset()} registry={registry} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  const strip = screen.getByLabelText("Asset Ledger summary");
  const tile = (name: string) => within(strip).getByText(name).parentElement!;
  expect(tile("Entries shown")).toHaveTextContent("3"); expect(tile("Value change")).toHaveTextContent("+1.05"); // the revaluation, plus the +0.05 a suggestion treats as one
  expect(tile("Last value update")).toHaveTextContent("Mar"); expect(tile("Last value update")).toHaveTextContent("all dates");
  const unclassified = tile("Unclassified").textContent; // looks at every date and ignores the filters
  fireEvent.change(screen.getByLabelText("Search entries"), { target: { value: "zzz" } });
  expect(tile("Entries shown")).toHaveTextContent("0"); expect(tile("Entries shown")).toHaveTextContent("of 3 in this view");
  expect(tile("Unclassified").textContent).toBe(unclassified); // a problem outside the filter cannot hide
  fireEvent.change(screen.getByLabelText("Search entries"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Date filter" }));
  fireEvent.click(screen.getByRole("button", { name: "Last year" }));
  expect(tile("Entries shown")).toHaveTextContent("0"); expect(tile("Unclassified").textContent).toBe(unclassified);
  fireEvent.click(screen.getByRole("button", { name: "This year" }));
  expect(tile("Entries shown")).toHaveTextContent("3");
});
it("offers every financial entry from one Add Entry menu beside Update value", () => {
  const source = [testRow("opening", 100)];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "read", transferKnown: true };
  const onCapitalAction = jest.fn();
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset()], metadata: [] }} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} onCapitalAction={onCapitalAction} />);
  expect(screen.queryByRole("button", { name: "Record a sale or write-off" })).not.toBeInTheDocument();
  for (const [label, kind] of [[/Add a payment/, "payment"], [/Sale or write-off/, "dispose"]] as const) {
    fireEvent.click(screen.getByRole("button", { name: "Add Entry" }));
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
    expect(onCapitalAction).toHaveBeenLastCalledWith(kind);
  }
});
it("suggests a type for an untyped transfer in, and tags only the rows Bench created", () => {
  const source = [testRow("in", 500, { transferId: "peer" }), testRow("mine", 100, { importedId: "asset-action:x" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 600, issues: [], fetchedAt: "read", transferKnown: true };
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset()], metadata: [] }} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getAllByText("suggested").length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole("button", { name: "Classify - on 2026-01-01" })[0]);
  expect(screen.getByText(/kept in Bench only; the transaction in Actual is not changed|Also writes #/)).toBeInTheDocument(); // only a row Bench created offers its Notes tag
});
it("makes All mean this asset's rows plus unassigned ones, and shows other assets only on request in a shared account", () => {
  const source = [testRow("mine", 100, { date: "2026-03-01", notes: "#asset_byd" }), testRow("free", 5, { date: "2026-03-02" }), testRow("theirs", 50, { date: "2026-03-03", notes: "#asset_toyota" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 155, issues: [], fetchedAt: "read", transferKnown: true };
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset(), testAsset("toyota")], metadata: [] }} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  const rowsShown = () => screen.getAllByRole("row").filter((r) => /2026/.test(r.getAttribute("aria-label") ?? "")).length;
  expect(rowsShown()).toBe(2); // mine + unassigned
  expect(screen.queryByRole("button", { name: /Whole account/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show other assets' entries" }));
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
it("filters the ledger by several types, a payee or an amount with the picker's chips", () => {
  const source = [testRow("a", 10000, { date: "2026-03-02", payeeName: "Valuer" }), testRow("b", -3000, { date: "2026-03-31", payeeName: "Garage" }), testRow("c", 500, { date: "2026-04-01", payeeName: "Valuer" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 7500, issues: [], fetchedAt: "read", transferKnown: true };
  const meta = (id: string, classification: string) => ({ actualTransactionId: id, actualAccountId: "vehicles", assetId: "byd", classification, revision: 1 });
  const registry = { assets: [testAsset()], metadata: [meta("a", "revaluation"), meta("b", "depreciation"), meta("c", "other-adjustment")] };
  render(<BookPanel asset={testAsset()} registry={registry} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  const strip = () => within(screen.getByLabelText("Asset Ledger summary")).getByText("Entries shown").parentElement!;
  expect(screen.queryByLabelText("Entry type")).not.toBeInTheDocument(); // a picker chip now
  fireEvent.click(screen.getByRole("button", { name: "Type filter" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Revaluation / Appreciation" })); fireEvent.click(screen.getByRole("checkbox", { name: "Depreciation" }));
  expect(strip()).toHaveTextContent("2"); expect(strip()).toHaveTextContent("of 3 in this view");
  fireEvent.click(screen.getByRole("button", { name: "Clear Type filter" }));
  fireEvent.click(screen.getByRole("button", { name: "Payee filter" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Valuer" }));
  expect(strip()).toHaveTextContent("2");
  fireEvent.click(screen.getByRole("button", { name: "Clear Payee filter" }));
  fireEvent.click(screen.getByRole("button", { name: "Amount filter" }));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "30" } });
  expect(strip()).toHaveTextContent("1"); // the 30.00 payment, whichever its sign
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(strip()).toHaveTextContent("3");
});
it("opens on the unclassified entries when asked for that view", () => {
  const source = [testRow("a", 100, { date: "2026-03-02" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "read", transferKnown: true };
  const onViewChange = jest.fn();
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset()], metadata: [] }} snapshot={snapshot} view="unclassified" onViewChange={onViewChange} fresh={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Type filter: Unclassified" })).toBeInTheDocument(); expect(onViewChange).toHaveBeenCalledWith("asset");
});
it("gives the value change as a percentage of the opening value and capital added", () => {
  const source = [testRow("open", 100000, { date: "2025-01-01" }), testRow("up", 5000, { date: "2026-02-01" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 105000, issues: [], fetchedAt: "read", transferKnown: true };
  const meta = (id: string, classification: string) => ({ actualTransactionId: id, actualAccountId: "vehicles", assetId: "byd", classification, revision: 1 });
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset()], metadata: [meta("open", "opening-balance"), meta("up", "revaluation")] }} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  const tile = within(screen.getByLabelText("Asset Ledger summary")).getByText("Value change").parentElement!;
  expect(tile).toHaveTextContent("+50.00"); expect(tile).toHaveTextContent("+5.00% of opening value and capital added");
  fireEvent.click(screen.getByRole("button", { name: "Date filter" })); fireEvent.click(screen.getByRole("button", { name: "This year" }));
  expect(tile).toHaveTextContent("+5.00%"); // the 1,000.00 the year started with, plus nothing added
});
it("leaves other assets' entries out of the KPIs even when they are shown", () => {
  const source = [testRow("mine", 100000, { date: "2026-03-01", notes: "#asset_byd" }), testRow("theirs", 900000, { date: "2026-03-03", notes: "#asset_toyota" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 1000000, issues: [], fetchedAt: "read", transferKnown: true };
  const meta = (id: string, assetId: string) => ({ actualTransactionId: id, actualAccountId: "vehicles", assetId, classification: "opening-balance", revision: 1 });
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset(), testAsset("toyota")], metadata: [meta("mine", "byd"), meta("theirs", "toyota")] }} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Show other assets' entries" }));
  const strip = within(screen.getByLabelText("Asset Ledger summary"));
  expect(strip.getByText("Entries shown").parentElement).toHaveTextContent("2");
  expect(strip.getByText("Capital added").parentElement).toHaveTextContent("+1,000.00"); // not the 9,000.00 that belongs to the other asset
});
it("opens the unclassified entries from a link with every other filter cleared", () => {
  const source = [testRow("a", 100, { date: "2026-03-02" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "read", transferKnown: true };
  const props = { asset: testAsset(), registry: { assets: [testAsset()], metadata: [] }, snapshot, fresh: jest.fn(), onSaved: jest.fn(), onViewChange: jest.fn() };
  const { rerender } = render(<BookPanel {...props} view="asset" />);
  fireEvent.click(screen.getByRole("button", { name: "Date filter" })); fireEvent.click(screen.getByRole("button", { name: "Last year" }));
  fireEvent.change(screen.getByLabelText("Search entries"), { target: { value: "zzz" } });
  rerender(<BookPanel {...props} view="unclassified" />);
  expect(screen.queryByRole("button", { name: /Date filter:/ })).not.toBeInTheDocument(); expect(screen.getByLabelText("Search entries")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Type filter: Unclassified" })).toBeInTheDocument();
});
it("orders the filter chips Date, Amount, Payee, then Type", () => {
  const source = [testRow("a", 100)];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "read", transferKnown: true };
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset()], metadata: [] }} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getAllByRole("button", { name: /^(Date|Amount|Payee|Type) filter/ }).map((b) => b.getAttribute("aria-label"))).toEqual(["Date filter", "Amount filter", "Payee filter", "Type filter"]);
});
it("opens a suggested entry as unclassified, so saving it never records the suggestion unasked", () => {
  const source = [testRow("a", 100, { date: "2026-03-02", payeeName: "Valuer" })];
  const snapshot: BookSnapshot = { accountId: "vehicles", date: "2026-10-24", source, rows: normalizeActivity(source).rows, balanceMinor: 100, issues: [], fetchedAt: "read", transferKnown: true };
  render(<BookPanel asset={testAsset()} registry={{ assets: [testAsset()], metadata: [] }} snapshot={snapshot} fresh={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getByRole("button", { name: /^Classify Valuer/ })).toHaveTextContent("suggested"); // the table shows a suggestion
  fireEvent.click(screen.getByRole("button", { name: /^Edit entry/ }));
  expect(screen.getByLabelText("Editor type")).toHaveTextContent("none"); // only a saved type is handed to the editor
});
