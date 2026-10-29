import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { sim, project } from "../../lib/simulatorTestKit";
import type { TrackedHistory } from "../../lib/trackedSchedule";
import { HowCalculatedDrawer } from "./HowCalculatedDrawer";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const loan = sim({ termMonths: 36, principalMinor: 3_000_000, assumptions: [{ key: "x", kind: "extra-repayment", effectiveFrom: "2024-03-01", recurrence: null, amountMinor: 100_000, feeTreatment: null, offsetAccountId: null, note: "private note" }] });
const projection = project(loan);

const trackedEarly = {
  startDate: "2024-02-01", today: "2024-03-20", installmentsBefore: 0, missingDueDates: [], ledgerEvents: [{ kind: "extra-principal", date: "2024-03-01", amountMinor: 100_000, rowId: "r1", payee: "Private Payee", notes: "private note" }],
  anchor: { date: "2024-03-05", principalMinor: 2_800_000, scheduledPaymentMinor: 93_000, restartDate: "2024-03-15", accruedInterestMinor: 4_100 },
} as unknown as TrackedHistory;

function open(props: Partial<React.ComponentProps<typeof HowCalculatedDrawer>> = {}) {
  return render(<HowCalculatedDrawer open onClose={jest.fn()} sim={loan} projection={projection} revision={3} unsaved={false} {...props} />);
}

describe("How this loan is calculated", () => {
  it("states the results, the events it was given, the due dates and the lender statement setting", () => {
    open();
    const dialog = screen.getByRole("dialog", { name: "How this loan is calculated" });
    expect(within(dialog).getByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(within(dialog).getByText("Number of repayments").nextSibling).toHaveTextContent(/^3[56], from 2024-02-01 to /);
    expect(within(dialog).getByText("Events").nextSibling).toHaveTextContent("1 extra payment");
    expect(within(dialog).getByText("Due dates").nextSibling).toHaveTextContent("Stay on their dates");
    expect(within(dialog).getByText("Lender statements").nextSibling).toHaveTextContent("Interest up to each payment's actual date");
    expect(within(dialog).getByText("Term").nextSibling).toHaveTextContent("3 years");
  });

  it("says where a tracked loan's history ends and the projection restarts, and why", () => {
    open({ tracked: trackedEarly });
    const dialog = screen.getByRole("dialog", { name: "How this loan is calculated" });
    expect(within(dialog).getByRole("heading", { name: "Tracked in Actual" })).toBeInTheDocument();
    expect(within(dialog).getByText("History").nextSibling).toHaveTextContent("2024-03-05");
    expect(within(dialog).getByText("Projection starts").nextSibling).toHaveTextContent(/2024-03-15.*paid early.*of interest accrued/);
  });

  it("explains a loan that cannot be calculated yet in plain words", () => {
    const blocked = { ok: false, blocked: [{ code: "irregular-event", classification: "blocked", date: "2024-03-10", message: "A extra-repayment on 2024-03-10 falls between payment dates; use bench-daily." }], versions: {} } as never;
    open({ projection: blocked });
    const dialog = screen.getByRole("dialog", { name: "How this loan is calculated" });
    expect(within(dialog).getByRole("heading", { name: "Not calculated yet" })).toBeInTheDocument();
    const section = within(dialog).getByRole("heading", { name: "Not calculated yet" }).parentElement!;
    expect(within(section).getByText(/falls between repayment dates/)).toBeInTheDocument();
    expect(section).not.toHaveTextContent(/bench-daily/);
    // The raw engine reason is kept in the diagnostics, for whoever looks into the report.
    expect(screen.getByText(/use bench-daily/, { selector: "pre" })).toBeInTheDocument();
  });

  it("copies diagnostics with the settings, results and engine versions, and nothing personal", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    open({ tracked: trackedEarly });
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("Actual Bench loan calculation diagnostics");
    const json = JSON.parse(text.slice(text.indexOf("```json") + 7, text.lastIndexOf("```")));
    expect(json.generatedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(json.revision).toEqual({ saved: 3, unsavedChanges: false });
    expect(json.calculationMethod).toMatchObject({ accrual: expect.any(String), dayCount: expect.any(String) });
    expect(json.results).toMatchObject({ regularRepaymentMinor: expect.any(Number), payoffDate: expect.any(String) });
    expect(json.tracking.projectionRestart).toMatchObject({ lastRealEvent: "2024-03-05", restartDate: "2024-03-15", accruedInterestMinor: 4_100 });
    expect(json.events).toEqual([expect.objectContaining({ kind: "extra-repayment", from: "2024-03-01", amountMinor: 100_000 })]);
    // No notes, payees, ids or currency.
    expect(text).not.toMatch(/private note|Private Payee|AUD|"key"|"id"/i);
    expect(toast.success).toHaveBeenCalled();
  });

  it("falls back to telling the person to select the text when the clipboard is unavailable", async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error("denied")) } });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("select the text")));
  });
});
