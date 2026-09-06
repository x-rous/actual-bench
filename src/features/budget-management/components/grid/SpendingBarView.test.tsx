import { render } from "@testing-library/react";
import { SpendingBarView } from "./SpendingBarView";

/**
 * The bar's arithmetic — tier, fill, overflow, zero budgets, non-finite input —
 * belongs to `computeSpendingBar` and is covered in lib/spendingBar.test.ts.
 * What matters here is the one thing that file cannot assert: the bar is purely
 * decorative, so it must stay out of the accessibility tree. The spoken status
 * lives on the cell, and a screen reader that also announced the bar would read
 * the same figure twice.
 */
describe("SpendingBarView", () => {
  it("is decorative: hidden from assistive tech, with no text of its own", () => {
    const { container } = render(
      <SpendingBarView bar={{ tier: "over", fill: 1, overflow: 0.25 }} />,
    );
    const track = container.firstChild as HTMLElement;
    expect(track).toHaveAttribute("aria-hidden", "true");
    expect(track).toHaveTextContent("");
  });
});
