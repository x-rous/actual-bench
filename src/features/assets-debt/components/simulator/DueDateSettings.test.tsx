import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { SimulationState } from "../../lib/simulatorModel";
import { sim } from "../../lib/simulatorTestKit";
import { DueDateSettings, parseHolidayText } from "./DueDateSettings";

function Harness({ initial, onChange }: { initial: SimulationState; onChange: (s: SimulationState) => void }) {
  const [state, setState] = useState(initial);
  return <DueDateSettings sim={state} change={(next) => { setState(next); onChange(next); }} />;
}

/** The app's dropdown is a listbox, not a native select. */
async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const item = await screen.findByRole("option", { name: option });
  fireEvent.pointerDown(item, { pointerType: "mouse" });
  fireEvent.pointerUp(item, { pointerType: "mouse" });
  fireEvent.mouseUp(item, { button: 0 });
  fireEvent.click(item);
}

describe("due dates and lender statements", () => {
  it("parses pasted holidays into sorted unique dates and reports lines that are not dates", () => {
    expect(parseHolidayText("2025-01-01\n2024-12-02, 2024-12-02\nEid\n\n")).toEqual({ holidays: ["2024-12-02", "2025-01-01"], invalid: ["Eid"] });
  });

  it("shows weekdays and holidays only once due dates move, and saves what was typed", async () => {
    const onChange = jest.fn();
    render(<Harness initial={sim()} onChange={onChange} />);
    expect(screen.queryByLabelText("Holidays")).toBeNull();
    await choose("A due date on a non-business day", "Moves to the next business day");
    fireEvent.click(await screen.findByLabelText("Sat"));
    fireEvent.change(screen.getByLabelText("Holidays"), { target: { value: "2025-01-01\nnot a date" } });
    expect(screen.getByText(/Not dates, and not saved: not a date/)).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ businessDays: { adjustment: "following", nonBusinessWeekdays: [7], holidays: ["2025-01-01"] } }));
    await choose("Lender statements split repayments using", "Interest up to each due date; early-payment benefit next time");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ lenderStatement: { interestAllocation: "accrued-to-due-date" } })));
    await choose("Lender statements split repayments using", "Interest up to each payment's actual date");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ lenderStatement: null })));
  });
});
