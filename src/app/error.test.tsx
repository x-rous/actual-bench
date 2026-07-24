import { fireEvent, render, screen } from "@testing-library/react";
import AppError from "./error";

describe("App error boundary", () => {
  // The boundary logs the raw error to the console; silence it in tests.
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows a generic message without leaking the error text", () => {
    render(
      <AppError
        error={new Error("secret-server-password-leak")}
        reset={() => {}}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(
      screen.queryByText(/secret-server-password-leak/),
    ).not.toBeInTheDocument();
  });

  it("calls reset() when 'Try again' is clicked", () => {
    const reset = jest.fn();
    render(<AppError error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("renders the digest reference when present", () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    render(<AppError error={error} reset={() => {}} />);

    expect(screen.getByText(/Reference: abc123/)).toBeInTheDocument();
  });
});
