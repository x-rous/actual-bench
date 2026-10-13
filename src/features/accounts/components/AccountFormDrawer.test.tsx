import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountFormDrawer } from "./AccountFormDrawer";

async function chooseClass(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Account Class" }));
  const option = await screen.findByRole("option", { name });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.pointerUp(option, { pointerType: "mouse" });
  fireEvent.click(option);
}

describe("new account class selection", () => {
  it("submits the class with the draft and disables off-budget-only choices on-budget", async () => {
    const onSubmit = jest.fn();
    render(<AccountFormDrawer open onOpenChange={jest.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Account Name"), { target: { value: "Checking" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Account Class" }));
    expect(await screen.findByText("Off-budget accounts only")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Retirement" })).toHaveAttribute("aria-disabled", "true");
    const bank = screen.getByRole("option", { name: "Bank" });
    fireEvent.pointerDown(bank, { pointerType: "mouse" });
    fireEvent.pointerUp(bank, { pointerType: "mouse" });
    fireEvent.click(bank);
    fireEvent.click(screen.getByRole("button", { name: "Add Account" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Checking", offBudget: false, accountClass: "bank" })));
  });

  it("allows Retirement off-budget and prevents an incompatible budget switch", async () => {
    const onSubmit = jest.fn();
    render(<AccountFormDrawer open onOpenChange={jest.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Account Name"), { target: { value: "Pension" } });
    fireEvent.click(screen.getByRole("switch", { name: "Off Budget" }));
    await chooseClass("Retirement");
    expect(screen.getByRole("switch", { name: "On Budget" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add Account" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ offBudget: true, accountClass: "retirement" })));
  });

  it("resets the draft class when the drawer is reopened", async () => {
    const props = { onOpenChange: jest.fn(), onSubmit: jest.fn() };
    const { rerender } = render(<AccountFormDrawer open {...props} />);
    await chooseClass("Bank");
    rerender(<AccountFormDrawer open={false} {...props} />);
    rerender(<AccountFormDrawer open {...props} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Account Class" })).toHaveTextContent("Unclassified"));
  });
});
