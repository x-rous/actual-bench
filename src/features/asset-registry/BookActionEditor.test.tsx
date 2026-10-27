import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BookActionEditor } from "./BookActionEditor";
import { executeAction, prepareAction, UncertainAssetWrite, type ActionContext } from "@/lib/asset-registry/actions";
import { registryRequest } from "./api";
import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { tagTransport, testAsset, testRow } from "@/lib/asset-registry/testing";
import { axeViolations } from "@/features/credit-cards/components/testing/axe";
jest.mock("./api", () => ({ registryRequest: jest.fn() }));
jest.mock("@/lib/asset-registry/actions", () => ({
  ...jest.requireActual("@/lib/asset-registry/actions"),
  executeAction: jest.fn(), prepareAction: jest.fn((_context: unknown, edit: unknown) => ({ edit, accountId: "vehicles", assetTag: "#asset_byd", beforeMinor: 100, deltaMinor: 500, afterMinor: 600 })),
}));
const context = { asset: testAsset(), registry: { assets: [testAsset()], metadata: [] }, transport: Object.assign(tagTransport(), { getPayees: async () => [] }) } as unknown as ActionContext;
beforeEach(() => jest.clearAllMocks());
it("retains known Actual success and retries metadata only; provides labelled accessible confirmation", async () => {
  jest.mocked(executeAction).mockResolvedValue({ transactionId: "known-row", deleted: false, noop: false });
  jest.mocked(registryRequest).mockRejectedValueOnce(new Error("Metadata unavailable")).mockResolvedValue({ assets: [testAsset()], metadata: [] });
  render(<BookActionEditor kind="create" fresh={async () => context} onClose={jest.fn()} onSaved={async () => {}} />);
  const dialog = screen.getByRole("dialog", { name: "Value adjustment" });
  expect(await axeViolations(dialog)).toEqual([]);
  fireEvent.change(screen.getByLabelText("Adjustment amount"), { target: { value: "5.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Review change" }));
  await screen.findByRole("button", { name: "Confirm Actual write" });
  expect(screen.getByRole("dialog", { name: "Value adjustment" })).toBe(dialog);
  expect(screen.getByLabelText("Adjustment amount")).toHaveValue("5.00");
  expect(screen.getByLabelText("Adjustment amount")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm Actual write" }));
  await screen.findByText("Metadata unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Retry metadata only" }));
  await screen.findByText("Actual write verified. Refresh complete.");
  expect(executeAction).toHaveBeenCalledTimes(1); expect(registryRequest).toHaveBeenCalledTimes(2);
});
it("locks uncertain writes and exposes inspection guidance without a retry button", async () => {
  jest.mocked(executeAction).mockRejectedValue(new UncertainAssetWrite());
  render(<BookActionEditor kind="set-value" fresh={async () => context} onClose={jest.fn()} onSaved={async () => {}} />);
  fireEvent.change(screen.getByLabelText("New value"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Review change" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm Actual write" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Confirm Actual write" })).not.toBeInTheDocument());
  expect(screen.getByText(/The editor is locked/)).toBeInTheDocument(); expect(registryRequest).not.toHaveBeenCalled();
});

async function selectValue(label: string, name: string) {
  fireEvent.click(screen.getByLabelText(label));
  const option = screen.getByRole("option", { name });
  fireEvent.pointerDown(option, { pointerType: "mouse" }); fireEvent.pointerUp(option, { pointerType: "mouse" }); fireEvent.click(option, { detail: 1 });
  await waitFor(() => expect(screen.getByLabelText(label)).toHaveTextContent(name));
}
function editorProps(shared = false, protectedRow = false) {
  const row = testRow("existing", 100, { notes: "", ...(protectedRow ? { transferId: "peer" } : {}) });
  const registry = { assets: [testAsset(), ...(shared ? [testAsset("toyota")] : [])], metadata: [{ actualTransactionId: row.id, actualAccountId: "vehicles", assetId: shared ? "byd" : null, classification: "opening-balance", revision: 1 }] };
  const snapshot = { accountId: "vehicles", date: "2026-10-24", source: [row], rows: normalizeActivity([row]).rows, balanceMinor: 100, issues: [], fetchedAt: "read", transferKnown: true };
  return { row, asset: registry.assets[0], registry, snapshot, initialClassification: "opening-balance" as const, fresh: async () => ({ ...context, asset: registry.assets[0], registry, snapshot }), onClose: jest.fn(), onSaved: jest.fn(async () => {}) };
}
it("opens an editable right panel directly and hides assignment for dedicated accounts", () => {
  render(<BookActionEditor kind="edit" {...editorProps()} />);
  expect(screen.getByRole("complementary", { name: "Entry editor" })).toBeInTheDocument();
  expect(screen.getByLabelText("Amount")).toBeEnabled();
  expect(screen.getByLabelText("Type")).toBeEnabled();
  expect(screen.queryByLabelText("Asset assignment")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit financial fields" })).not.toBeInTheDocument();
});
it("saves shared assignment and classification together for protected rows without a financial write", async () => {
  const props = editorProps(true, true);
  jest.mocked(registryRequest).mockResolvedValue(props.registry);
  render(<BookActionEditor kind="edit" {...props} financialLock="Transfers are classify-only; amend them in Actual" />);
  expect(screen.getByLabelText("Amount")).toBeDisabled();
  expect(screen.getByLabelText("Type")).toBeEnabled();
  await selectValue("Asset assignment", "toyota");
  await selectValue("Type", "Revaluation / Appreciation");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Classification and assignment saved.", {}, { timeout: 4000 });
  expect(executeAction).not.toHaveBeenCalled();
  expect(registryRequest).toHaveBeenCalledWith("budget", "PATCH", { changes: [{ actualTransactionId: "existing", actualAccountId: "vehicles", assetId: "toyota", classification: "revaluation", revision: 1 }] });
});
it("prepares new shared transactions for the asset selected in the same panel", async () => {
  const props = editorProps(true);
  render(<BookActionEditor kind="create" {...props} row={undefined} />);
  fireEvent.change(screen.getByLabelText("Adjustment amount"), { target: { value: "5" } });
  await selectValue("Asset assignment", "toyota");
  fireEvent.click(screen.getByRole("button", { name: "Review change" }));
  await screen.findByRole("button", { name: "Confirm Actual write" });
  expect(prepareAction).toHaveBeenCalledWith(expect.objectContaining({ asset: expect.objectContaining({ id: "toyota" }) }), expect.objectContaining({ kind: "create", amountMinor: 500 }));
});

it("refuses a metadata save if the source changed while the panel was open", async () => {
  const props = editorProps(true, true);
  render(<BookActionEditor kind="edit" {...props} fresh={async () => { const current = await props.fresh(); return { ...current, snapshot: { ...current.snapshot, source: [{ ...props.row, amount: 200 }] } }; }} financialLock="Protected transfer" />);
  await selectValue("Asset assignment", "toyota");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(/The transaction changed/);
  expect(registryRequest).not.toHaveBeenCalled();
  expect(executeAction).not.toHaveBeenCalled();
});

it("preserves dirty fields when navigation to another row is cancelled", () => {
  const navigation = { guard: null as ((action: () => void) => void) | null };
  const navigate = jest.fn();
  render(<BookActionEditor kind="edit" {...editorProps()} registerNavigationGuard={(guard) => { navigation.guard = guard; }} />);
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2.00" } });
  act(() => navigation.guard?.(navigate));
  expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Amount")).toHaveValue("2.00");
});
it("offers the payees the workspace already loaded, without waiting for a review", async () => {
  render(<BookActionEditor kind="create" payeeOptions={[{ id: "p1", name: "Dubai Properties" }, { id: "t1", name: "Transfer : Bank", transferAccountId: "bank" }]} fresh={async () => context} onClose={jest.fn()} onSaved={async () => {}} />);
  fireEvent.click(screen.getByLabelText("Payee"));
  expect(await screen.findByText("Dubai Properties")).toBeInTheDocument();
  expect(screen.queryByText("Transfer : Bank")).not.toBeInTheDocument(); // only ordinary payees
});
