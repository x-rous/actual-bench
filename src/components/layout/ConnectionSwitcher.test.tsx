import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SavedBudget } from "@/features/connect/savedBudgets";
import type { ConnectionInstance } from "@/store/connection";
import { ConnectionSwitcher } from "./ConnectionSwitcher";

jest.mock("./ConnectionHealthDot", () => ({ ConnectionHealthDot: () => null }));

const household = {
  id: "c-1",
  label: "Household",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  budgetSyncId: "b-1",
  serverPassword: "pw",
} as ConnectionInstance;
const joint = {
  id: "c-2",
  label: "Joint",
  mode: "http-api",
  baseUrl: "https://api.example.com",
  budgetSyncId: "b-2",
  apiKey: "k",
} as ConnectionInstance;
const savedOne: SavedBudget = {
  serverFingerprint: "srv",
  budgetSyncId: "b-3",
  name: "Holiday",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverLabel: "Home",
};

function renderSwitcher(overrides: Partial<Parameters<typeof ConnectionSwitcher>[0]> = {}) {
  const props = {
    active: household,
    instances: [household, joint],
    saved: [savedOne],
    locked: false,
    connectingTo: null,
    onSwitch: jest.fn(),
    onOpenSaved: jest.fn(),
    onUnlock: jest.fn(),
    onAdd: jest.fn(),
    onDisconnect: jest.fn(),
    onDisconnectAll: jest.fn(),
    ...overrides,
  };
  render(<ConnectionSwitcher {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /Household/ }));
  return props;
}

describe("the budget switcher (PR-071b)", () => {
  it("lists connected and saved budgets together by server, with the host and mode on the header, and marks the active one", async () => {
    renderSwitcher({ instances: [household, joint, { ...household, id: "c-4", label: "Holiday home", budgetSyncId: "b-4" }] });

    const menu = await screen.findByRole("menu");
    // Both Direct budgets connected on one server, and the saved one on the
    // same server, share a single header.
    expect(within(menu).getAllByText("actual.example.com")).toHaveLength(1);
    expect(within(menu).getAllByText("Direct")).toHaveLength(1);
    expect(within(menu).getByText("Holiday")).toBeInTheDocument();
    expect(within(menu).getByText("api.example.com")).toBeInTheDocument();
    expect(within(menu).getByText("HTTP API")).toBeInTheDocument();
    // Budget rows are the name alone.
    expect(within(menu).getByText("Holiday home")).toBeInTheDocument();
    // Every connected budget has the green dot, the saved one none; the active one is marked current.
    expect(within(menu).getAllByLabelText("Connected")).toHaveLength(3);
    expect(menu.querySelector("[aria-current=\"true\"]")).toHaveTextContent("Household");
    expect(within(menu).getByText("Disconnect Household")).toBeInTheDocument();
  });

  it("disconnects one budget from its row without switching to it", async () => {
    const props = renderSwitcher();

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect Joint" }));

    expect(props.onDisconnect).toHaveBeenCalledWith("c-2");
    expect(props.onSwitch).not.toHaveBeenCalled();
  });

  it("offers an unlock when saved connections are locked", async () => {
    const props = renderSwitcher({ locked: true });

    fireEvent.click(await screen.findByText("Unlock saved connections..."));
    expect(props.onUnlock).toHaveBeenCalled();
  });

  it("shows a filter once there are many budgets, matching name or server", async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...savedOne,
      budgetSyncId: `b-${index + 10}`,
      name: index === 0 ? "Rental property" : `Budget ${index}`,
    }));
    renderSwitcher({ saved: many });

    fireEvent.change(await screen.findByLabelText("Filter budgets"), { target: { value: "rental" } });

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Rental property")).toBeInTheDocument();
    expect(within(menu).queryByText("Budget 3")).not.toBeInTheDocument();
  });

  it("shows progress in the button while a saved budget connects", () => {
    render(
      <ConnectionSwitcher
        active={household}
        instances={[household]}
        saved={[]}
        locked={false}
        connectingTo="Holiday"
        onSwitch={jest.fn()}
        onOpenSaved={jest.fn()}
        onUnlock={jest.fn()}
        onAdd={jest.fn()}
        onDisconnect={jest.fn()}
        onDisconnectAll={jest.fn()}
      />
    );
    expect(screen.getByText("Connecting to Holiday...")).toBeInTheDocument();
  });
});
