import { fireEvent, render, screen } from "@testing-library/react";
import { InvertedSignsNotice } from "./InvertedSignsNotice";

const diagnosis = { wouldMatch: 47, statementRows: 52 };

describe("InvertedSignsNotice", () => {
  it("says how many rows the flip would account for", () => {
    render(<InvertedSignsNotice diagnosis={diagnosis} onRerun={() => {}} />);

    expect(screen.getByText(/Nothing matched, and the amounts look inverted/)).toBeInTheDocument();
    expect(screen.getByText(/47 of 52 rows would match/)).toBeInTheDocument();
  });

  it("re-runs on request", () => {
    const onRerun = jest.fn();
    render(<InvertedSignsNotice diagnosis={diagnosis} onRerun={onRerun} />);

    fireEvent.click(screen.getByRole("button", { name: /Re-run inverted/ }));
    expect(onRerun).toHaveBeenCalledTimes(1);
  });

  /**
   * An applied session cannot be re-matched, and a button that silently does
   * nothing is worse than one that says why it will not.
   */
  it("refuses with a reason when re-matching is blocked", () => {
    render(
      <InvertedSignsNotice
        diagnosis={diagnosis}
        onRerun={() => {}}
        blockedReason="This session has already been applied"
      />
    );

    // Announced with the button rather than hung on a `title`: a disabled
    // button is not focusable, so a tooltip on one reaches nobody.
    const button = screen.getByRole("button", { name: /Re-run inverted/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("This session has already been applied");
  });

  it("refuses while a match is already running", () => {
    render(<InvertedSignsNotice diagnosis={diagnosis} onRerun={() => {}} isMatching />);
    expect(screen.getByRole("button", { name: /Re-run inverted/ })).toBeDisabled();
  });
});
