import { render, screen } from "@testing-library/react";
import { LoadingState } from "./LoadingState";

describe("the loading state", () => {
  it("announces what is being read, with the stage when there is one", () => {
    const { rerender } = render(<LoadingState title="Reading your accounts…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading your accounts…");
    rerender(<LoadingState title="Reading your accounts…" detail="Reading transactions…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading transactions…");
  });
});
