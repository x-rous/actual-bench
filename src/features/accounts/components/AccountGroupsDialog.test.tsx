import { fireEvent, render, screen, within } from "@testing-library/react";
import { useStagedStore } from "../../../store/staged";
import { AccountGroupsDialog } from "./AccountGroupsDialog";

const store = () => useStagedStore.getState();

beforeEach(() => {
  store().discardAll();
  store().loadAccounts([
    { id: "a1", name: "Checking", offBudget: false, closed: false, groupId: "g1" },
    { id: "a2", name: "Cash", offBudget: false, closed: false, groupId: null },
  ]);
  store().loadAccountGroups([
    { id: "g1", name: "Everyday" },
    { id: "g2", name: "Savings" },
  ]);
});
afterEach(() => store().discardAll());

describe("AccountGroupsDialog", () => {
  it("lists groups with their member counts", () => {
    render(<AccountGroupsDialog open onOpenChange={() => undefined} />);
    expect(screen.getByText("Everyday")).toBeInTheDocument();
    expect(screen.getByText("1 account")).toBeInTheDocument();
    expect(screen.getByText("0 accounts")).toBeInTheDocument();
  });

  it("stages a new group from the name field and clears the field", () => {
    render(<AccountGroupsDialog open onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Brokerage" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(Object.values(store().accountGroups).some((g) => g.isNew && g.entity.name === "Brokerage")).toBe(true);
    expect(screen.getByLabelText("New group name")).toHaveValue("");
  });

  it("shows a duplicate-name error and disables Add", () => {
    render(<AccountGroupsDialog open onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "savings" } });
    expect(screen.getByRole("alert")).toHaveTextContent("already exists");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("explains that accounts are kept before deleting, then stages the delete", () => {
    render(<AccountGroupsDialog open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete group Everyday" }));
    expect(screen.getByText(/1 account will be kept and become ungrouped/)).toBeInTheDocument();
    expect(store().accountGroups["g1"]?.isDeleted).toBe(false); // not until confirmed

    fireEvent.click(within(screen.getByText(/will be kept/).parentElement!).getByRole("button", { name: "Delete" }));
    expect(store().accountGroups["g1"]?.isDeleted).toBe(true);
    expect(store().accounts["a1"]?.entity.groupId).toBeNull();
  });

  it("renames a group inline", () => {
    render(<AccountGroupsDialog open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename group Savings" }));
    const input = screen.getByLabelText("Rename group Savings");
    fireEvent.change(input, { target: { value: "Goals" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(store().accountGroups["g2"]?.entity.name).toBe("Goals");
  });

  it("creates and assigns when opened from an account, then closes", () => {
    const onOpenChange = jest.fn();
    render(<AccountGroupsDialog open onOpenChange={onOpenChange} assignAccountIds={["a2"]} />);
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Pocket" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and assign" }));

    const created = Object.values(store().accountGroups).find((g) => g.isNew)!;
    expect(store().accounts["a2"]?.entity.groupId).toBe(created.entity.id);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
