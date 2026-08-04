import { render } from "@testing-library/react";
import { SpendingBarView } from "./SpendingBarView";

describe("SpendingBarView", () => {
  it("renders nothing when there is no bar", () => {
    const { container } = render(
      <SpendingBarView bar={{ tier: "none", fill: 0, overflow: 0 }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a decorative track with the fill width", () => {
    const { container } = render(
      <SpendingBarView bar={{ tier: "under", fill: 0.5, overflow: 0 }} />,
    );
    const track = container.firstChild as HTMLElement;
    expect(track).not.toBeNull();
    expect(track).toHaveAttribute("aria-hidden", "true");
    const fill = track.firstChild as HTMLElement;
    expect(fill.style.width).toBe("50%");
  });

  it("adds a red overflow segment when over budget", () => {
    const { container } = render(
      <SpendingBarView bar={{ tier: "over", fill: 1, overflow: 0.25 }} />,
    );
    const track = container.firstChild as HTMLElement;
    // Base fill + overflow segment.
    expect(track.childElementCount).toBe(2);
    const overflow = track.children[1] as HTMLElement;
    expect(overflow.style.width).toBe("25%");
    expect(overflow.className).toMatch(/bg-red-500/);
  });
});
