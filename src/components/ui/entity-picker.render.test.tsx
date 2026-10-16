import { fireEvent, render, screen } from "@testing-library/react";
import { AccountPicker } from "./entity-picker";

const ACCOUNTS = [
  { id: "a1", name: "Checking", offBudget: false, closed: false },
  { id: "a2", name: "Visa", offBudget: false, closed: false, groupId: "g-cards" },
  { id: "a3", name: "Old card", offBudget: false, closed: true, groupId: "g-cards" },
  { id: "a4", name: "House", offBudget: true, closed: false },
];
const GROUPS = [{ id: "g-cards", name: "Cards" }];

function openPicker(onChange = jest.fn()) {
  render(
    <AccountPicker
      accounts={ACCOUNTS}
      groups={GROUPS}
      value=""
      onChange={onChange}
      ariaLabel="Filter by account"
      placeholder="All accounts"
      allowNone
      noneLabel="All accounts"
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Filter by account" }));
  return screen.getByLabelText("Search options");
}

describe("AccountPicker", () => {
  // jsdom has no layout, so it has no scrollIntoView for the highlight to call.
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  it("lists accounts under their budget side and group, with closed ones marked", () => {
    openPicker();
    expect(screen.getByText("On budget")).toBeInTheDocument();
    expect(screen.getByText("Off budget")).toBeInTheDocument();
    expect(screen.getByText("Cards")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Old card\s*closed/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All accounts" })).toBeInTheDocument();
  });

  it("finds a group's accounts by the group's name, and picks with the keyboard", () => {
    const onChange = jest.fn();
    const search = openPicker(onChange);
    fireEvent.change(search, { target: { value: "cards" } });
    expect(screen.queryByRole("option", { name: "Checking" })).toBeNull();
    expect(screen.queryByText("Off budget")).toBeNull();
    expect(screen.getByRole("option", { name: "Visa" })).toBeInTheDocument();
    // The "All accounts" row is first; Down moves to Visa.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("a2");
  });
});
