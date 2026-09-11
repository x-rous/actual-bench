/**
 * F-081: the toolbar could only step the window by a month or a year, so a
 * month two years back took a lot of clicking. The range label is now the
 * trigger for a jump.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { MonthJumpPopover } from "./MonthJumpPopover";

function open(props: Partial<Parameters<typeof MonthJumpPopover>[0]> = {}) {
  const onWindowChange = jest.fn();
  render(
    <MonthJumpPopover
      windowStart="2026-01"
      rangeLabel="Jan – Dec 2026"
      onWindowChange={onWindowChange}
      {...props}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /Jump to a month/i }));
  return { onWindowChange };
}

describe("MonthJumpPopover", () => {
  it("starts the window at the chosen month", () => {
    const { onWindowChange } = open();
    fireEvent.click(screen.getByRole("button", { name: "Start the window at Mar 2026" }));
    expect(onWindowChange).toHaveBeenCalledWith("2026-03");
  });

  it("reaches a prior year without stepping month by month", () => {
    const { onWindowChange } = open();
    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    fireEvent.click(screen.getByRole("button", { name: "Start the window at Sep 2024" }));
    expect(onWindowChange).toHaveBeenCalledWith("2024-09");
  });

  it("marks the month the window currently starts at", () => {
    open({ windowStart: "2026-05" });
    expect(
      screen.getByRole("button", { name: "Start the window at May 2026" })
    ).toHaveAttribute("aria-current", "true");
  });

  it("still offers a month the budget file has no data for", () => {
    // Missing past months render as read-only rather than vanishing, so
    // refusing to navigate there would make a gap impossible to inspect.
    const { onWindowChange } = open({ availableMonths: ["2026-01", "2026-02"] });
    const missing = screen.getByRole("button", { name: "Start the window at Aug 2026" });
    expect(missing).toHaveAttribute("title", "Aug 2026 has no budget data");
    fireEvent.click(missing);
    expect(onWindowChange).toHaveBeenCalledWith("2026-08");
  });
});
