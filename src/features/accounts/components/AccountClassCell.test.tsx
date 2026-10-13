import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EffectiveAccountClass } from "@/lib/account-class";
import { AccountClassCell } from "./AccountClassCell";

function renderCell(effective: EffectiveAccountClass, over: Partial<React.ComponentProps<typeof AccountClassCell>> = {}) {
  const onChange = jest.fn();
  render(
    <AccountClassCell accountId="a1" accountName="Checking" offBudget={false} effective={effective} disabled={false} onChange={onChange} {...over} />
  );
  return { onChange };
}

describe("AccountClassCell", () => {
  it("shows the account's own class as an editable control", () => {
    renderCell({ accountClass: "bank", source: "account" });
    expect(screen.getByRole("combobox", { name: "Account class of Checking" })).toHaveTextContent("Bank");
  });

  it("shows Unclassified when there is no class", () => {
    renderCell({ accountClass: null, source: "none" });
    expect(screen.getByRole("combobox", { name: "Account class of Checking" })).toHaveTextContent("Unclassified");
  });

  it("shows an inherited class read-only, with the group it comes from", () => {
    renderCell({ accountClass: "credit-card", source: "group" }, { groupName: "Cards" });
    expect(screen.getByText("Credit Card")).toBeInTheDocument();
    expect(screen.getByText("Inherited")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByTitle(/Inherited from the group "Cards"/)).toBeInTheDocument();
  });

  it("reports the chosen class", async () => {
    const { onChange } = renderCell({ accountClass: null, source: "none" }, { offBudget: true });
    fireEvent.click(screen.getByRole("combobox", { name: "Account class of Checking" }));
    const option = await screen.findByRole("option", { name: "Loan" });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.pointerUp(option, { pointerType: "mouse" });
    fireEvent.mouseUp(option);
    fireEvent.click(option);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("a1", "loan"));
    fireEvent.click(screen.getByRole("combobox", { name: "Account class of Checking" }));
    const retirement = await screen.findByRole("option", { name: "Retirement" });
    fireEvent.pointerDown(retirement, { pointerType: "mouse" });
    fireEvent.pointerUp(retirement, { pointerType: "mouse" });
    fireEvent.click(retirement);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("a1", "retirement"));
  });

  it("clears the class with Unclassified", async () => {
    const { onChange } = renderCell({ accountClass: "bank", source: "account" });
    fireEvent.click(screen.getByRole("combobox", { name: "Account class of Checking" }));
    const option = await screen.findByRole("option", { name: "Unclassified" });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.pointerUp(option, { pointerType: "mouse" });
    fireEvent.mouseUp(option);
    fireEvent.click(option);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("a1", null));
  });

  it("keeps restricted classes visible but prevents pointer and keyboard selection on-budget", async () => {
    const { onChange } = renderCell({ accountClass: null, source: "none" });
    const trigger = screen.getByRole("combobox", { name: "Account class of Checking" });
    fireEvent.click(trigger);
    expect(await screen.findByText("Off-budget accounts only")).toBeInTheDocument();
    expect(screen.getAllByText("Off-budget accounts only")).toHaveLength(1);
    for (const name of ["Vehicle", "Property", "Investment", "Retirement", "Loan"]) {
      const option = await screen.findByRole("option", { name: name });
      expect(option).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(option);
    }
    for (const name of ["Cash", "Bank", "Other Asset", "Credit Card", "Other Liability"]) {
      expect(screen.getByRole("option", { name })).not.toHaveAttribute("aria-disabled", "true");
    }
    fireEvent.keyDown(trigger, { key: "l" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalledWith("a1", "loan");
    expect(screen.queryByRole("option", { name: "Receivable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Payable" })).not.toBeInTheDocument();
  });

  it("is disabled while it cannot be saved", () => {
    renderCell({ accountClass: "bank", source: "account" }, { disabled: true });
    expect(screen.getByRole("combobox", { name: "Account class of Checking" })).toBeDisabled();
  });
});
