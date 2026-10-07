import { fireEvent, render, screen, within } from "@testing-library/react";
import { ChoosePayment } from "./ChoosePayment";

const options = [
  { id: "far", date: "2024-04-02", amountMinor: 242915, payeeName: "Home Lender", notes: null, pairedTo: "2024-04-01" },
  { id: "near", date: "2024-02-27", amountMinor: 242915, payeeName: "Home Lender", notes: "March", pairedTo: null },
  { id: "now", date: "2024-02-02", amountMinor: 242915, payeeName: "Home Lender", notes: null, pairedTo: "2024-02-01" },
];

/** "This is the payment" (owner decision 2026-10-07). */
describe("choosing the payment for a due date", () => {
  it("lists payments nearest the due date first, says what each is paired with, and names the chosen one", () => {
    const onChoose = jest.fn();
    render(<ChoosePayment dueDate="2024-03-01" options={options} chosenId={null} digits={2} busy={false} onChoose={onChoose} onClear={jest.fn()} onClose={jest.fn()} />);
    const dialog = screen.getByRole("dialog", { name: /Which payment is the repayment due/ });
    const radios = within(dialog).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Not paired (extra)"),
      expect.stringMatching(/Paired with .*Feb.*2024 now/),
      expect.stringMatching(/Paired with .*Apr.*2024 now/),
    ]);
    expect(within(dialog).getByRole("button", { name: "This is the payment" })).toBeDisabled();
    fireEvent.click(radios[0]);
    fireEvent.click(within(dialog).getByRole("button", { name: "This is the payment" }));
    expect(onChoose).toHaveBeenCalledWith("near");
  });

  it("an earlier choice can be forgotten", () => {
    const onClear = jest.fn();
    render(<ChoosePayment dueDate="2024-03-01" options={options} chosenId="near" digits={2} busy={false} onChoose={jest.fn()} onClear={onClear} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Forget my choice" }));
    expect(onClear).toHaveBeenCalled();
  });
});
