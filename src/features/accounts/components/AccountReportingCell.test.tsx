import { render, screen } from "@testing-library/react";
import { chooseSelectOption } from "@/components/ui/select.testing";
import { AccountReportingCell } from "./AccountReportingCell";

const base = { accountId: "a1", accountName: "Brokerage", saved: undefined, unsaved: false, disabled: false, onChange: jest.fn() };

describe("account reporting cell", () => {
  it("shows a fixed treatment as text, with no control", () => {
    render(<AccountReportingCell {...base} accountClass="property" />);
    expect(screen.getByText("Non-current asset")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("marks a missing choice with text and offers the choices inline", async () => {
    const onChange = jest.fn();
    render(<AccountReportingCell {...base} accountClass="investment" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: /Financial Reporting of Brokerage \(choice needed\)/ });
    expect(trigger).toHaveTextContent("Choose…");
    await chooseSelectOption(trigger, "Non-current investment");
    expect(onChange).toHaveBeenCalledWith("a1", "non-current-investment");
  });

  it("drops the warning once a valid choice is saved, and ignores a stale one", () => {
    const { rerender } = render(<AccountReportingCell {...base} accountClass="investment" saved="current-investment" />);
    expect(screen.getByRole("combobox", { name: "Financial Reporting of Brokerage" })).toHaveTextContent("Current investment");
    rerender(<AccountReportingCell {...base} accountClass="investment" saved="current-asset" />);
    expect(screen.getByRole("combobox", { name: /choice needed/ })).toBeInTheDocument();
  });

  it("waits for the save of a new account and for a class", () => {
    const { rerender } = render(<AccountReportingCell {...base} accountClass="investment" unsaved />);
    expect(screen.getByText("Save the account to choose")).toBeInTheDocument();
    rerender(<AccountReportingCell {...base} accountClass={null} />);
    expect(screen.getByText("Choose a class first")).toBeInTheDocument();
  });

  it("shows a Bank account as cash and lets it be marked a fixed / restricted deposit", async () => {
    const onChange = jest.fn();
    const { rerender } = render(<AccountReportingCell {...base} accountClass="bank" onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Financial Reporting of Brokerage" });
    expect(select).toHaveTextContent("Cash & cash equivalents");
    await chooseSelectOption(select, "Fixed / restricted deposit");
    expect(onChange).toHaveBeenCalledWith("a1", "fixed-deposit");

    rerender(<AccountReportingCell {...base} accountClass="bank" saved="fixed-deposit" onChange={onChange} />);
    expect(screen.getByRole("combobox", { name: "Financial Reporting of Brokerage" })).toHaveTextContent("Fixed / restricted deposit");
    await chooseSelectOption(screen.getByRole("combobox", { name: "Financial Reporting of Brokerage" }), "Cash & cash equivalents");
    expect(onChange).toHaveBeenLastCalledWith("a1", null);
  });

  it("does not warn for a closed account with no activity, which needs no choice", () => {
    render(<AccountReportingCell {...base} accountClass="investment" exempt />);
    expect(screen.queryByRole("combobox", { name: /choice needed/ })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Financial Reporting of Brokerage" })).toBeInTheDocument();
  });

  it("does not call a choice missing before the saved choices have loaded", () => {
    const { rerender } = render(<AccountReportingCell {...base} accountClass="investment" choicesLoaded={false} disabled />);
    expect(screen.queryByRole("combobox", { name: /choice needed/ })).toBeNull();
    rerender(<AccountReportingCell {...base} accountClass="investment" choicesLoaded />);
    expect(screen.getByRole("combobox", { name: /choice needed/ })).toBeInTheDocument();
  });
});
