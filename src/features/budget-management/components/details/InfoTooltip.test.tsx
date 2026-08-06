import { fireEvent, render, screen } from "@testing-library/react";
import { InfoTooltip } from "./InfoTooltip";

describe("InfoTooltip", () => {
  it("renders the label as a focusable, discoverable trigger", () => {
    render(
      <InfoTooltip content="Expenses only, over closed months.">
        Budget variance
      </InfoTooltip>,
    );
    const trigger = screen.getByRole("button", { name: /Budget variance/ });
    expect(trigger).toBeInTheDocument();
    // The dotted underline signals the label carries an explanation.
    expect(trigger.className).toMatch(/decoration-dotted/);
  });

  it("reveals the explanation on keyboard focus", async () => {
    render(
      <InfoTooltip content="Expenses only, over closed months.">
        Budget variance
      </InfoTooltip>,
    );
    fireEvent.focus(screen.getByRole("button", { name: /Budget variance/ }));
    expect(
      await screen.findByText("Expenses only, over closed months."),
    ).toBeInTheDocument();
  });
});
