import { render, screen } from "@testing-library/react";
import { Delta } from "./Delta";

describe("a figure against the stretch before", () => {
  it("is green when more of a good thing, and red when more of a bad one", () => {
    const { rerender } = render(<Delta now={660} before={600} label="the 10 months before" good="up" />);
    expect(screen.getByText(/10\.0%/).className).toMatch(/green/);
    rerender(<Delta now={660} before={600} label="the 10 months before" good="down" />);
    expect(screen.getByText(/10\.0%/).className).toMatch(/red/);
    expect(screen.getByText(/10\.0%/)).toHaveTextContent("▲ 10.0% vs the 10 months before");
  });

  it("shows a fall with a down arrow, and a rate as points", () => {
    const { rerender } = render(<Delta now={450} before={600} label="the previous month" good="up" />);
    expect(screen.getByText(/25\.0%/)).toHaveTextContent("▼ 25.0% vs the previous month");
    rerender(<Delta points now={29.2} before={26} label="the 10 months before" good="up" />);
    expect(screen.getByText(/3\.2 pts/)).toHaveTextContent("▲ 3.2 pts vs the 10 months before");
  });

  it("says nothing against nothing, and says so when nothing changed", () => {
    const { container, rerender } = render(<Delta now={5} before={0} label="the previous month" good="up" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Delta now={5} before={5} label="the previous month" good="up" />);
    expect(container).toHaveTextContent("No change vs the previous month");
  });
});
