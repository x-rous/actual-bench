import { render, screen } from "@testing-library/react";
import { DetailsSkeleton } from "./DetailsPrimitives";

describe("DetailsSkeleton", () => {
  it("announces loading to assistive tech instead of showing bare text", () => {
    render(<DetailsSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/Loading budget details/i);
  });
});
