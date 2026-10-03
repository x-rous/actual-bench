import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountGroupCell } from "./AccountGroupCell";

const groups = [
  { id: "g1", name: "Everyday" },
  { id: "g2", name: "Savings" },
];

function renderCell(over: Partial<React.ComponentProps<typeof AccountGroupCell>> = {}) {
  const onAssign = jest.fn();
  const onRequestNewGroup = jest.fn();
  render(
    <AccountGroupCell
      accountId="a1"
      accountName="Checking"
      groupId="g1"
      groups={groups}
      disabled={false}
      onAssign={onAssign}
      onRequestNewGroup={onRequestNewGroup}
      {...over}
    />
  );
  return { onAssign, onRequestNewGroup };
}

async function pick(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: /Change group/ }));
  const option = await screen.findByRole("option", { name });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.pointerUp(option, { pointerType: "mouse" });
  fireEvent.mouseUp(option);
  fireEvent.click(option);
}

describe("AccountGroupCell", () => {
  it("shows the current group name", () => {
    renderCell();
    expect(screen.getByRole("button", { name: /Everyday/ })).toBeInTheDocument();
  });

  it("reads as No group when the group id matches no live group", () => {
    renderCell({ groupId: "deleted" });
    expect(screen.getByRole("button", { name: /No group\. Change group/ })).toBeInTheDocument();
  });

  it("assigns the chosen group", async () => {
    const { onAssign } = renderCell({ groupId: null });
    await pick("Savings");
    await waitFor(() => expect(onAssign).toHaveBeenCalledWith("a1", "g2"));
  });

  it("un-assigns with null", async () => {
    const { onAssign } = renderCell();
    await pick("No group");
    await waitFor(() => expect(onAssign).toHaveBeenCalledWith("a1", null));
  });

  it("asks for the new-group dialog instead of assigning", async () => {
    const { onAssign, onRequestNewGroup } = renderCell();
    await pick("New group…");
    await waitFor(() => expect(onRequestNewGroup).toHaveBeenCalledWith("a1"));
    expect(onAssign).not.toHaveBeenCalled();
  });

  it("is read-only for a row staged for deletion", () => {
    renderCell({ disabled: true });
    expect(screen.queryByRole("button", { name: /Change group/ })).not.toBeInTheDocument();
    expect(screen.getByText("Everyday")).toBeInTheDocument();
  });
});
