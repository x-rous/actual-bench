import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmDialog, type ConfirmState } from "./confirm-dialog";

/**
 * The gate in front of every destructive action in the app — deleting rules,
 * accounts, backup policies, automations — and it had no test of its own. Its
 * whole job is to be the last thing between a click and a deletion, so the
 * properties worth stating are: it explains what is about to happen, it does
 * nothing unless the destructive button is used, and cancelling is safe.
 */

function open(overrides: Partial<ConfirmState> = {}) {
  const onConfirm = jest.fn();
  const onOpenChange = jest.fn();
  const state: ConfirmState = {
    title: "Delete rule?",
    message: "This removes the rule from the budget.",
    onConfirm,
    ...overrides,
  };
  render(<ConfirmDialog open onOpenChange={onOpenChange} state={state} />);
  return { onConfirm, onOpenChange };
}

describe("ConfirmDialog", () => {
  it("names the action and explains its consequence", () => {
    open();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Delete rule?");
    expect(screen.getByText("This removes the rule from the budget.")).toBeInTheDocument();
  });

  it("runs the action only when the destructive button is used", () => {
    const { onConfirm, onOpenChange } = open();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does nothing at all on Cancel", () => {
    const { onConfirm, onOpenChange } = open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers no close affordance other than the two explicit choices", () => {
    // `showCloseButton={false}` is deliberate: a stray X makes dismissing the
    // dialog feel like an answer when it is not one. Asserted on the named
    // controls — the dialog also renders unnamed focus sentinels, which are not
    // affordances and must not be counted as ones.
    open();
    const named = screen
      .getAllByRole("button")
      .map((b) => b.textContent?.trim())
      .filter(Boolean);
    expect(named).toEqual(["Cancel", "Delete"]);
    expect(screen.queryByRole("button", { name: /close|dismiss/i })).not.toBeInTheDocument();
  });

  it("uses the caller's verb, so the button says what it will do", () => {
    open({ destructiveLabel: "Discard changes" });
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("defaults its action label to Delete, so a caller cannot omit the verb", () => {
    // Fail loud: the default has to be the cautious reading. A dialog that
    // defaulted to "OK" would let a genuinely destructive action ship looking
    // like an acknowledgement.
    open();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("styles the action differently for a non-destructive confirmation", () => {
    // A red button on a harmless action teaches people to ignore red buttons.
    // Compared against the destructive rendering rather than matched against a
    // class name, so this survives a change of design tokens.
    const { container: destructive } = render(
      <ConfirmDialog open onOpenChange={jest.fn()} state={{ title: "t", message: "m", onConfirm: jest.fn(), destructiveLabel: "Go" }} />,
    );
    const destructiveClass = destructive.ownerDocument.body.querySelector<HTMLElement>(
      "[role=dialog] button:last-of-type",
    )?.className;

    open({ destructive: false, destructiveLabel: "Continue" });
    const plain = screen.getByRole("button", { name: "Continue" }).className;

    expect(plain).not.toBe(destructiveClass);
  });

  it("renders nothing to confirm while it has no state to describe", () => {
    // The dialog outlives its state during the closing animation; reading
    // `state.onConfirm` there used to throw.
    const onOpenChange = jest.fn();
    render(<ConfirmDialog open={false} onOpenChange={onOpenChange} state={null} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("survives a confirm click with no state behind it", () => {
    const onOpenChange = jest.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} state={null} />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Delete" }))).not.toThrow();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
