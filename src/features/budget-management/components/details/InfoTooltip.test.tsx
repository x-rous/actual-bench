import { fireEvent, render, screen } from "@testing-library/react";
import { InfoTooltip } from "./InfoTooltip";

describe("InfoTooltip", () => {
  it("renders the label as a focusable, discoverable trigger", () => {
    render(
      <InfoTooltip content="Expenses only, over closed months.">
        Budget variance
      </InfoTooltip>,
    );
    // A tooltip nobody can reach is not a tooltip. The query itself is the
    // assertion: the label has to be an actual control with an accessible
    // name, not a styled span that only responds to a mouse. (The dotted
    // underline that used to be asserted here is a class name, not behaviour;
    // the keyboard path below is what proves the affordance works.)
    expect(screen.getByRole("button", { name: /Budget variance/ })).toBeInTheDocument();
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
