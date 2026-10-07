import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as api from "../../lib/debtsApi";
import { ExtraPayments } from "./ExtraPayments";

jest.mock("../../lib/debtsApi", () => ({ recordExtraPayment: jest.fn(async () => ({})), removeExtraPayment: jest.fn(async () => ({})), countExtraPayment: jest.fn(async () => ({})) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const payment = { id: "tx-extra", date: "2026-10-04", amountMinor: 2_000_000, payeeName: "Transfer: HSBC Main Account", notes: null, recorded: false, inSchedule: false, recordedAs: null, changed: false, direction: "in" as const };
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("payments not in the schedule (extra payments)", () => {
  it("counted, not counted and taken out are the only states", () => {
    wrap(<ExtraPayments debtId="d1" digits={2} scheduleDirty={false} onChanged={jest.fn()} payments={[
      { ...payment, id: "a", recorded: true, inSchedule: true },
      { ...payment, id: "b", dismissed: true },
      { ...payment, id: "c", direction: "out" as const },
    ]} />);
    const rows = within(screen.getByRole("region", { name: "Payments not in the schedule" })).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Extra payment");
    expect(rows[1]).toHaveTextContent("Not counted");
    expect(rows[2]).toHaveTextContent("Taken out");
    expect(screen.queryByRole("button", { name: /Record now|Update Terms & Schedule|Add it again/ })).toBeNull();
  });

  it("one not recorded yet counts already, and says when Terms & Schedule gets it", () => {
    const { rerender } = wrap(<ExtraPayments debtId="d1" payments={[payment]} digits={2} scheduleDirty={false} onChanged={jest.fn()} />);
    expect(screen.getByText("Extra payment")).toBeInTheDocument();
    expect(screen.getByText("Terms & Schedule gets it on the next refresh.")).toBeInTheDocument();
    rerender(<QueryClientProvider client={new QueryClient()}><ExtraPayments debtId="d1" payments={[payment]} digits={2} scheduleDirty onChanged={jest.fn()} /></QueryClientProvider>);
    expect(screen.getByText("Terms & Schedule gets it once you save your changes there.")).toBeInTheDocument();
    rerender(<QueryClientProvider client={new QueryClient()}><ExtraPayments debtId="d1" payments={[{ ...payment, recorded: true, changed: true, recordedAs: { date: "2026-11-04", amountMinor: 2_000_000 } }]} digits={2} scheduleDirty onChanged={jest.fn()} /></QueryClientProvider>);
    expect(screen.getByText("Changed in Actual. Terms & Schedule gets it once you save your changes there.")).toBeInTheDocument();
  });

  it("a counted payment can be marked not an extra payment, and counted again", async () => {
    const { rerender } = wrap(<ExtraPayments debtId="d1" payments={[{ ...payment, recorded: true, inSchedule: true }]} digits={2} scheduleDirty={false} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Not an extra payment" }));
    const dialog = await screen.findByRole("dialog", { name: "Not an extra payment?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Not an extra payment" }));
    await waitFor(() => expect(api.removeExtraPayment).toHaveBeenCalledWith("d1", "tx-extra", "2026-10-04"));
    rerender(<QueryClientProvider client={new QueryClient()}><ExtraPayments debtId="d1" payments={[{ ...payment, dismissed: true }]} digits={2} scheduleDirty={false} onChanged={jest.fn()} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Count it" }));
    await waitFor(() => expect(api.countExtraPayment).toHaveBeenCalledWith("d1", "tx-extra"));
  });

  it("taken out of Terms & Schedule by hand: not counted, and Count it puts it back", async () => {
    wrap(<ExtraPayments debtId="d1" payments={[{ ...payment, recorded: true, inSchedule: false }]} digits={2} scheduleDirty={false} onChanged={jest.fn()} />);
    expect(screen.getByText("Not counted: taken out of Terms & Schedule")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Count it" }));
    await waitFor(() => expect(api.recordExtraPayment).toHaveBeenCalledWith("d1", { actualTransactionId: "tx-extra", date: "2026-10-04", amountMinor: 2_000_000 }));
  });

  it("shows nothing when every payment is a scheduled repayment", () => {
    const { container } = wrap(<ExtraPayments debtId="d1" payments={[]} digits={2} scheduleDirty={false} onChanged={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
