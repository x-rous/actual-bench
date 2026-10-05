import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as api from "../../lib/debtsApi";
import { ExtraPayments } from "./ExtraPayments";

jest.mock("../../lib/debtsApi", () => ({ recordExtraPayment: jest.fn(async () => ({})), removeExtraPayment: jest.fn(async () => ({})) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const payment = { id: "tx-extra", date: "2026-10-04", amountMinor: 2_000_000, payeeName: "Transfer: HSBC Main Account", notes: null, recorded: false, inSchedule: false, recordedAs: null, changed: false };
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("payments not in the schedule (extra payments)", () => {
  it("records one as an extra payment after a confirmation that says what happens", async () => {
    const onChanged = jest.fn();
    wrap(<ExtraPayments debtId="d1" payments={[payment]} digits={2} scheduleDirty={false} onChanged={onChanged} />);
    const panel = screen.getByRole("region", { name: "Payments not in the schedule" });
    expect(panel).toHaveTextContent("20,000.00");
    fireEvent.click(within(panel).getByRole("button", { name: "Record as extra payment" }));
    const dialog = await screen.findByRole("dialog", { name: "Record as an extra payment?" });
    expect(dialog).toHaveTextContent(/one-off extra payment of 20,000.00/);
    expect(dialog).toHaveTextContent(/Nothing in Actual changes/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Record extra payment" }));
    await waitFor(() => expect(api.recordExtraPayment).toHaveBeenCalledWith("d1", { actualTransactionId: "tx-extra", date: "2026-10-04", amountMinor: 2_000_000 }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("waits for unsaved Terms & Schedule changes, and shows recorded payments with Remove", () => {
    const { rerender } = wrap(<ExtraPayments debtId="d1" payments={[payment]} digits={2} scheduleDirty onChanged={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Record as extra payment" })).toBeDisabled();
    rerender(<QueryClientProvider client={new QueryClient()}><ExtraPayments debtId="d1" payments={[{ ...payment, recorded: true, inSchedule: true }]} digits={2} scheduleDirty={false} onChanged={jest.fn()} /></QueryClientProvider>);
    expect(screen.getByText("✓ Extra payment in Terms & Schedule")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
  });

  it("a recorded payment changed in Actual offers to update Terms & Schedule", async () => {
    wrap(<ExtraPayments debtId="d1" payments={[{ ...payment, recorded: true, inSchedule: false, changed: true, recordedAs: { date: "2026-11-04", amountMinor: 2_000_000 } }]} digits={2} scheduleDirty={false} onChanged={jest.fn()} />);
    expect(screen.getByText(/Changed in Actual\. Terms & Schedule still has 20,000\.00 on/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update Terms & Schedule" }));
    const dialog = await screen.findByRole("dialog", { name: "Update the extra payment?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update Terms & Schedule" }));
    await waitFor(() => expect(api.recordExtraPayment).toHaveBeenCalledWith("d1", { actualTransactionId: "tx-extra", date: "2026-10-04", amountMinor: 2_000_000 }));
  });

  it("shows nothing when every payment is a scheduled repayment", () => {
    const { container } = wrap(<ExtraPayments debtId="d1" payments={[]} digits={2} scheduleDirty={false} onChanged={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
