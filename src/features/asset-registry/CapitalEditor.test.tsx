import { fireEvent, render, screen } from "@testing-library/react";
import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { testAsset, testRow } from "@/lib/asset-registry/testing";
import { executeCapital, type CapitalContext } from "@/lib/asset-registry/capitalActions";
import { UncertainAssetWrite } from "@/lib/asset-registry/actions";
import { CapitalEditor } from "./CapitalEditor";
import { registryRequest } from "./api";
jest.mock("./api", () => ({ registryRequest: jest.fn() }));
// The generic picker has its own tests; here it just hands back the chosen expense.
const mockRow = { id: "expense", accountId: "bank", accountName: "Bank", date: "2026-01-01", amountMinor: -2000000, payeeId: null, payeeName: "Roofing Co", categoryId: "renovation", categoryName: "Renovation", notes: null, transferId: null };
const mockDeposit = { ...mockRow, id: "deposit", amountMinor: 9000000, payeeName: "Buyer", categoryId: null, categoryName: null };
jest.mock("@/components/transactions/TransactionPickerDialog", () => ({ TransactionPickerDialog: ({ onConfirm, onClose, title }: { onConfirm: (rows: unknown[]) => Promise<void> | void; onClose: () => void; title: string }) => <button onClick={async () => { await onConfirm([title.includes("payment you received") ? mockDeposit : mockRow]); onClose(); }}>{`Mock pick: ${title}`}</button> }));
jest.mock("@/lib/asset-registry/capitalActions", () => ({ ...jest.requireActual("@/lib/asset-registry/capitalActions"), executeCapital: jest.fn() }));
function context(): CapitalContext {
  const opening = testRow("opening", 10000000, { date: "2025-01-01" });
  const expense = testRow("expense", -2000000, { accountId: "bank", categoryId: "renovation", date: "2026-01-01" });
  const deposit = testRow("deposit", 9000000, { accountId: "bank", date: "2026-01-01", notes: null });
  const asset = testAsset("asset", { assetTag: null });
  return { asset, registry: { assets: [asset], metadata: [{ actualTransactionId: "opening", actualAccountId: "vehicles", assetId: null, classification: "opening-balance", revision: 1 }] }, snapshot: { accountId: "vehicles", date: "2026-10-24", source: [opening], rows: normalizeActivity([opening]).rows, balanceMinor: opening.amount, issues: [], transferKnown: true, fetchedAt: "read" }, external: { rows: normalizeActivity([expense, deposit]).rows, issues: [], accounts: [{ id: "bank", name: "Bank", offBudget: false, closed: false }], fetchedAt: "read" }, transport: { getSyncCapabilities: () => ({ capabilities: { createTransaction: true, createTransactionWithImportedId: true } }), convertToTransfer: jest.fn() } as unknown as CapitalContext["transport"] };
}
beforeEach(() => jest.clearAllMocks());
async function review() {
  fireEvent.click(screen.getByRole("button", { name: "Choose the expense…" }));
  fireEvent.click(screen.getByRole("button", { name: /^Mock pick/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Review" }));
  return screen.findByRole("button", { name: "Convert to transfer" });
}
it("retains confirmed financial success and retries only metadata after a metadata save failure", async () => {
  const ctx = context(); const pending = jest.fn();
  jest.mocked(executeCapital).mockResolvedValue({ transactionId: "created", noop: false, deleted: false });
  jest.mocked(registryRequest).mockRejectedValueOnce(new Error("Metadata unavailable")).mockResolvedValue(ctx.registry);
  render(<CapitalEditor kind="payment" context={ctx} categories={[]} fresh={async (date) => ({ ...ctx, snapshot: { ...ctx.snapshot, date } })} onSaved={jest.fn(async () => {})} onClose={jest.fn()} onUncertain={jest.fn()} onPendingMetadata={pending} />);
  fireEvent.click(await review()); await screen.findByText("Metadata unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText(/Retry the pending metadata before closing/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry metadata only" }));
  await screen.findByText("Payment recorded and Actual values refreshed.");
  expect(executeCapital).toHaveBeenCalledTimes(1); expect(registryRequest).toHaveBeenCalledTimes(2); expect(pending).toHaveBeenCalled();
});
it("locks an uncertain conversion without offering a blind retry", async () => {
  const ctx = context(); const unknown = jest.fn();
  jest.mocked(executeCapital).mockRejectedValue(new UncertainAssetWrite());
  render(<CapitalEditor kind="payment" context={ctx} categories={[]} fresh={async (date) => ({ ...ctx, snapshot: { ...ctx.snapshot, date } })} onSaved={jest.fn(async () => {})} onClose={jest.fn()} onUncertain={unknown} onPendingMetadata={jest.fn()} />);
  fireEvent.click(await review()); await screen.findByText(/This editor will not repeat the write/);
  expect(unknown).toHaveBeenCalledTimes(1); expect(screen.queryByRole("button", { name: "Retry metadata only" })).not.toBeInTheDocument();
});
it("records a sale in a dialog with grouped questions, and says how it will be modelled in Actual before confirming", async () => {
  const ctx = context();
  jest.mocked(executeCapital).mockResolvedValue({ transactionId: "adjustment", noop: false, deleted: false });
  jest.mocked(registryRequest).mockResolvedValue(ctx.registry);
  render(<CapitalEditor kind="dispose" context={ctx} categories={[]} fresh={async (date) => ({ ...ctx, snapshot: { ...ctx.snapshot, date } })} onSaved={jest.fn(async () => {})} onClose={jest.fn()} onUncertain={jest.fn()} onPendingMetadata={jest.fn()} />);
  expect(screen.getByRole("dialog", { name: "Record a sale or write-off" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "The sale" })).toBeInTheDocument(); expect(screen.getByRole("group", { name: "How much leaves the asset" })).toBeInTheDocument();
  expect(screen.getByLabelText(/^Value removed from the asset/)).toHaveValue("100000.00"); // the whole recorded value, ready to edit
  expect(screen.getByLabelText(/^Note/)).toBeVisible(); // notes are never collapsed
  fireEvent.click(screen.getByRole("button", { name: "Choose the deposit…" }));
  fireEvent.click(screen.getByRole("button", { name: /^Mock pick/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Review" }));
  const how = await screen.findByRole("region", { name: "How this will be recorded" });
  expect(how).toHaveTextContent(/Your deposit .*Buyer.* stays exactly as it is/);
  expect(how).toHaveTextContent(/One new entry of -100,000.00 is added to the asset's own account.*noncash.*#disposal.*not a transaction in your bank/);
  expect(how).toHaveTextContent(/Gain or loss on the sale/);
  fireEvent.click(screen.getByRole("button", { name: "Confirm Actual write" }));
  await screen.findByText("Treatment saved and Actual values refreshed.");
  expect(executeCapital).toHaveBeenCalledTimes(1);
});
it("keeps a write-off simple: no payment questions, and says no money moves", async () => {
  const ctx = context();
  render(<CapitalEditor kind="dispose" context={ctx} categories={[]} fresh={async (date) => ({ ...ctx, snapshot: { ...ctx.snapshot, date } })} onSaved={jest.fn(async () => {})} onClose={jest.fn()} onUncertain={jest.fn()} onPendingMetadata={jest.fn()} />);
  fireEvent.click(screen.getByRole("radio", { name: /I got no money/ }));
  expect(screen.queryByRole("group", { name: "The sale" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(await screen.findByText(/No money moves, and nothing in your budget changes/)).toBeInTheDocument();
});
