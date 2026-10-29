import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { LOAN_GUIDE_SECTIONS, LoanGuide, guideSectionForLoanTab, type LoanGuideSection } from "./LoanGuide";

function Harness({ initial = "start" as LoanGuideSection }) {
  const [section, setSection] = useState<LoanGuideSection>(initial);
  return <LoanGuide section={section} onSection={setSection} onClose={jest.fn()} docsUrl="https://example.test/docs/" />;
}

describe("the Loans & Debt guide", () => {
  it("opens every section from the side list, each with its own heading and content", () => {
    render(<Harness />);
    const nav = screen.getByRole("navigation", { name: "Guide sections" });
    for (const [, label] of LOAN_GUIDE_SECTIONS) {
      fireEvent.click(within(nav).getByRole("button", { name: label }));
      expect(within(nav).getByRole("button", { name: label })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("heading", { level: 2, name: label })).toBeInTheDocument();
    }
  });

  it("starts by saying an unsaved loan is a calculator and a saved, linked one is tracked", () => {
    render(<Harness />);
    expect(screen.getByText("A calculator, while it is not saved")).toBeInTheDocument();
    expect(screen.getByText("Tracked, once it is saved and linked")).toBeInTheDocument();
    expect(screen.getByText("Saving never writes to Actual")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Link to Actual" }).find((b) => b.closest("nav") === null)!);
    expect(screen.getByRole("heading", { level: 2, name: "Link to Actual" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Full documentation" })).toHaveAttribute("href", "https://example.test/docs/");
  });

  it("draws the pictures, not screenshots: the chart sketch and the split before and after", () => {
    const { unmount } = render(<Harness initial="calculator" />);
    expect(screen.getByRole("img", { name: /loan balance falls to zero/ })).toBeInTheDocument();
    unmount();
    render(<Harness initial="split" />);
    expect(screen.getByText("Before: one whole transfer")).toBeInTheDocument();
    expect(screen.getByText("After: one split, two lines")).toBeInTheDocument();
  });

  it("lets a long description wrap instead of widening the table past the dialog", () => {
    render(<Harness initial="repayments" />);
    const long = screen.getByText(/Something needs a look: two payments could be it/);
    expect(long.closest("td")).not.toHaveClass("whitespace-nowrap");
    // A short label column still stays on one line.
    expect(screen.getByText("Recorded").closest("td")).toHaveClass("whitespace-nowrap");
    expect(screen.getByRole("heading", { level: 2, name: "Repayments" }).parentElement).toHaveClass("min-w-0");
  });

  it("opens on the section for the tab you are on", () => {
    expect(guideSectionForLoanTab("calculation")).toBe("calculator");
    expect(guideSectionForLoanTab("setup")).toBe("link");
    expect(guideSectionForLoanTab("activity")).toBe("repayments");
    expect(guideSectionForLoanTab("ledger")).toBe("ledger");
    expect(guideSectionForLoanTab("assets")).toBe("assets");
    expect(guideSectionForLoanTab(null)).toBe("start");
  });
});
