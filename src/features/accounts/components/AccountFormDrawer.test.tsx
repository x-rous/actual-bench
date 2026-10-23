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

async function chooseGroup(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Account Group" }));
  const option = await screen.findByRole("option", { name });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.pointerUp(option, { pointerType: "mouse" });
  fireEvent.click(option);
}

describe("new account group selection", () => {
  const groups = [{ id: "checking", name: "Checking" }, { id: "pensions", name: "Pensions" }];
  const groupClasses = new Map([["checking", "bank"], ["pensions", "retirement"]] as const);

  it("submits the selected group and inherits its class without staging an override", async () => {
    const onSubmit = jest.fn();
    render(<AccountFormDrawer open onOpenChange={jest.fn()} onSubmit={onSubmit} groups={groups} groupClasses={groupClasses} />);
    fireEvent.change(screen.getByLabelText("Account Name"), { target: { value: "Daily account" } });
    await chooseGroup("Checking");
    expect(screen.getByRole("combobox", { name: "Account Class" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Account Class" })).toHaveTextContent("Bank");
    fireEvent.click(screen.getByRole("button", { name: "Add Account" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ groupId: "checking", accountClass: null })));
  });

  it("prevents on-budget assignment to an off-budget-only group", async () => {
    render(<AccountFormDrawer open onOpenChange={jest.fn()} onSubmit={jest.fn()} groups={groups} groupClasses={groupClasses} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Account Group" }));
    expect(await screen.findByRole("option", { name: /Pensions/ })).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("switch", { name: "Off Budget" }));
    await chooseGroup("Pensions");
    expect(screen.getByRole("switch", { name: "On Budget" })).toBeDisabled();
  });

  it("resets group selection on reopen and omits the selector when groups are unsupported", async () => {
    const props = { onOpenChange: jest.fn(), onSubmit: jest.fn(), groups };
    const { rerender } = render(<AccountFormDrawer open {...props} />);
    await chooseGroup("Checking");
    rerender(<AccountFormDrawer open={false} {...props} />);
    rerender(<AccountFormDrawer open {...props} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Account Group" })).toHaveTextContent("No group"));
    rerender(<AccountFormDrawer open onOpenChange={props.onOpenChange} onSubmit={props.onSubmit} />);
    expect(screen.queryByRole("combobox", { name: "Account Group" })).not.toBeInTheDocument();
  });
});
