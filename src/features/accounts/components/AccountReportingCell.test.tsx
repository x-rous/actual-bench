import { fireEvent, render, screen } from "@testing-library/react";
import { chooseSelectOption } from "@/components/ui/select.testing";
import { AccountReportingCell } from "./AccountReportingCell";

const flags = { excluded: false, accessible: false, offbudgetIncome: false };
const base = { accountId: "a1", accountName: "Brokerage", offBudget: true, saved: undefined, flags, unsaved: false, disabled: false, onChangeTreatment: jest.fn(), onChangeFlag: jest.fn() };

describe("account reporting cell", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows a fixed label as text, with no control", () => {
    render(<AccountReportingCell {...base} accountClass="property" />);
    expect(screen.getByText("Fixed asset")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("asks for nothing: Investment shows its label, never a warning or a required choice", () => {
    render(<AccountReportingCell {...base} accountClass="investment" />);
    expect(screen.getByText("Investment")).toBeInTheDocument();
    expect(screen.queryByText(/Choose/)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("waits for the save of a new account and for a class", () => {
    const { rerender } = render(<AccountReportingCell {...base} accountClass="investment" unsaved />);
    expect(screen.getByText("Save the account to choose")).toBeInTheDocument();
    rerender(<AccountReportingCell {...base} accountClass={null} offBudget={false} />);
    expect(screen.getByText("Choose a class first")).toBeInTheDocument();
  });

  it("shows a Bank account as cash and lets it be marked a fixed / restricted deposit", async () => {
    const onChangeTreatment = jest.fn();
    const { rerender } = render(<AccountReportingCell {...base} accountClass="bank" onChangeTreatment={onChangeTreatment} />);
    const select = screen.getByRole("combobox", { name: "Financial Reporting of Brokerage" });
    expect(select).toHaveTextContent("Cash & cash equivalents");
    await chooseSelectOption(select, "Fixed / restricted deposit");
    expect(onChangeTreatment).toHaveBeenCalledWith("a1", "fixed-deposit");

    rerender(<AccountReportingCell {...base} accountClass="bank" saved="fixed-deposit" onChangeTreatment={onChangeTreatment} />);
    await chooseSelectOption(screen.getByRole("combobox", { name: "Financial Reporting of Brokerage" }), "Cash & cash equivalents");
    expect(onChangeTreatment).toHaveBeenLastCalledWith("a1", null);
  });

  it("keeps the include setting reachable for a saved exclusion on an account that is on budget now", () => {
    const onChangeFlag = jest.fn();
    render(<AccountReportingCell {...base} accountClass="bank" offBudget={false} flags={{ ...flags, excluded: true }} onChangeFlag={onChangeFlag} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings of Brokerage" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Include in Financial Insights/ }));
    expect(onChangeFlag).toHaveBeenCalledWith("a1", "excluded", false);
  });

  it("makes an Other Asset a holding, accessible money or a fixed asset, and never the last two together", async () => {
    const onChangeTreatment = jest.fn();
    const onChangeFlag = jest.fn();
    const { rerender } = render(<AccountReportingCell {...base} accountClass="other-asset" onChangeTreatment={onChangeTreatment} onChangeFlag={onChangeFlag} />);
    const select = () => screen.getByRole("combobox", { name: "Financial Reporting of Brokerage" });
    expect(select()).toHaveTextContent("Holding");
    await chooseSelectOption(select(), "Accessible money");
    expect(onChangeFlag).toHaveBeenCalledWith("a1", "accessible", true);
    expect(onChangeTreatment).not.toHaveBeenCalled();

    // From accessible money to a fixed asset: the treatment is saved and the flag is turned off.
    onChangeFlag.mockClear();
    rerender(<AccountReportingCell {...base} accountClass="other-asset" flags={{ ...flags, accessible: true }} onChangeTreatment={onChangeTreatment} onChangeFlag={onChangeFlag} />);
    expect(select()).toHaveTextContent("Accessible money");
    await chooseSelectOption(select(), "Fixed asset");
    expect(onChangeTreatment).toHaveBeenCalledWith("a1", "fixed-asset");
    // A fixed asset wins over the saved flag, so choosing it is one write.
    expect(onChangeFlag).not.toHaveBeenCalled();

    // From a fixed asset back to a holding: the treatment is cleared.
    onChangeTreatment.mockClear(); onChangeFlag.mockClear();
    rerender(<AccountReportingCell {...base} accountClass="other-asset" saved="fixed-asset" onChangeTreatment={onChangeTreatment} onChangeFlag={onChangeFlag} />);
    await chooseSelectOption(select(), "Holding");
    expect(onChangeTreatment).toHaveBeenCalledWith("a1", null);
  });

  it("offers Accessible money, income and Include in Financial Insights only where they can apply", () => {
    const onChangeFlag = jest.fn();
    const { rerender } = render(<AccountReportingCell {...base} accountClass="investment" onChangeFlag={onChangeFlag} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings of Brokerage" }));
    expect(screen.getByRole("checkbox", { name: /Accessible money/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Uncategorized entries are income/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Include in Financial Insights/ }));
    expect(onChangeFlag).toHaveBeenCalledWith("a1", "excluded", true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    rerender(<AccountReportingCell {...base} accountClass="bank" offBudget onChangeFlag={onChangeFlag} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings of Brokerage" }));
    expect(screen.getByRole("checkbox", { name: /Uncategorized entries are income/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Accessible money/ })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    // An on-budget account has nothing to set here: it cannot be left out, and the income setting is for off-budget accounts.
    rerender(<AccountReportingCell {...base} accountClass="bank" offBudget={false} />);
    expect(screen.queryByRole("button", { name: "Settings of Brokerage" })).toBeNull();
  });

  it("shows an account left out by its group as excluded by the group, and cannot change it from the row", () => {
    render(<AccountReportingCell {...base} accountClass="bank" excludedByGroup groupName="Scratch" />);
    expect(screen.getByText("Left out")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings of Brokerage" }));
    const include = screen.getByRole("checkbox", { name: /Include in Financial Insights/ });
    expect(include).toBeDisabled();
    expect(include).not.toBeChecked();
    expect(screen.getByText(/Excluded by group “Scratch”/)).toBeInTheDocument();
  });

  it("does not need a class for an excluded off-budget account", () => {
    render(<AccountReportingCell {...base} accountClass={null} flags={{ ...flags, excluded: true }} />);
    expect(screen.getByText("Class not needed")).toBeInTheDocument();
    expect(screen.getByText("Left out")).toBeInTheDocument();
  });

  it("ignores a saved flag that no longer applies to the class", () => {
    render(<AccountReportingCell {...base} accountClass="loan" flags={{ ...flags, accessible: true }} />);
    expect(screen.queryByText("Accessible")).toBeNull();
  });
});
