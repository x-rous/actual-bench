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
  const dialog = screen.getByRole("dialog", { name: "Add Transaction" });
  expect(await axeViolations(dialog)).toEqual([]);
  fireEvent.change(screen.getByLabelText("Signed amount"), { target: { value: "5.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Review change" }));
  await screen.findByRole("button", { name: "Confirm Actual write" });
  expect(screen.getByRole("dialog", { name: "Add Transaction" })).toBe(dialog);
  expect(screen.getByLabelText("Signed amount")).toHaveValue("5.00");
  expect(screen.getByLabelText("Signed amount")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm Actual write" }));
  await screen.findByText("Metadata unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Retry metadata only" }));
  await screen.findByText("Actual write verified. Refresh complete.");
  expect(executeAction).toHaveBeenCalledTimes(1); expect(registryRequest).toHaveBeenCalledTimes(2);
});
it("locks uncertain writes and exposes inspection guidance without a retry button", async () => {
  jest.mocked(executeAction).mockRejectedValue(new UncertainAssetWrite());
  render(<BookActionEditor kind="set-value" fresh={async () => context} onClose={jest.fn()} onSaved={async () => {}} />);
  fireEvent.change(screen.getByLabelText("Target owned recorded value"), { target: { value: "5" } });
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
  expect(screen.getByRole("complementary", { name: "Account transaction editor" })).toBeInTheDocument();
  expect(screen.getByLabelText("Signed amount")).toBeEnabled();
  expect(screen.getByLabelText("Bench classification")).toBeEnabled();
  expect(screen.queryByLabelText("Asset assignment")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit financial fields" })).not.toBeInTheDocument();
});
it("saves shared assignment and classification together for protected rows without a financial write", async () => {
  const props = editorProps(true, true);
  jest.mocked(registryRequest).mockResolvedValue(props.registry);
  render(<BookActionEditor kind="edit" {...props} financialLock="Transfers are classify-only; amend them in Actual" />);
  expect(screen.getByLabelText("Signed amount")).toBeDisabled();
  expect(screen.getByLabelText("Bench classification")).toBeEnabled();
  await selectValue("Asset assignment", "toyota");
  await selectValue("Bench classification", "Revaluation / Appreciation");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Classification and assignment saved.", {}, { timeout: 4000 });
  expect(executeAction).not.toHaveBeenCalled();
  expect(registryRequest).toHaveBeenCalledWith("budget", "PATCH", { changes: [{ actualTransactionId: "existing", actualAccountId: "vehicles", assetId: "toyota", classification: "revaluation", revision: 1 }] });
});
it("prepares new shared transactions for the asset selected in the same panel", async () => {
  const props = editorProps(true);
  render(<BookActionEditor kind="create" {...props} row={undefined} />);
  fireEvent.change(screen.getByLabelText("Signed amount"), { target: { value: "5" } });
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
  fireEvent.change(screen.getByLabelText("Signed amount"), { target: { value: "2.00" } });
  act(() => navigation.guard?.(navigate));
  expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Signed amount")).toHaveValue("2.00");
});
