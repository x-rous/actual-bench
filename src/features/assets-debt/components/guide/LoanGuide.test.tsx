import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { LOAN_GUIDE_SECTIONS, LoanGuide, guideSectionForLoanTab, type LoanGuideSection } from "./LoanGuide";

function Harness({ initial = "start" as LoanGuideSection }) {
  const [section, setSection] = useState<LoanGuideSection>(initial);
  return <LoanGuide section={section} onSection={setSection} onClose={jest.fn()} docsUrl="https://example.test/docs/" />;
}

describe("the Loans guide", () => {
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

  it("explains event choices and which events can repeat", () => {
    render(<Harness initial="events" />);
    const table = screen.getByRole("table", { name: "Event types and what you can set" });
    for (const event of ["Extra payment", "Redraw / Withdraw", "Fee", "Rate change", "Repayment change"]) {
      expect(within(table).getByText(event)).toBeInTheDocument();
    }
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Event", "How it works"]);
    expect(within(table).getByText(/repeat weekly, fortnightly, monthly, quarterly or annually/)).toBeInTheDocument();
    expect(within(table).getByText(/Set a new rate and start date/)).toHaveTextContent("Each change is entered separately");
  });

  it("places the settings reference before the glossary and explains each group", () => {
    render(<Harness initial="settings" />);
    const nav = screen.getByRole("navigation", { name: "Guide sections" });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons.findIndex((b) => b.textContent === "Settings") + 1).toBe(buttons.findIndex((b) => b.textContent === "Glossary"));
    for (const heading of ["Start from a preset", "Interest", "Transactions on the same day as interest", "Repayment", "Precision and rounding", "Due dates and lender statements"]) {
      expect(screen.getByRole("heading", { level: 3, name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText("First interest charge")).toBeInTheDocument();
    expect(screen.getByText("The contract allows negative amortization")).toBeInTheDocument();
    expect(screen.getByText("Lender statements split repayments using")).toBeInTheDocument();
    const interest = screen.getByRole("table", { name: "Interest settings" });
    expect(within(interest).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Field", "What it controls", "Values and behavior"]);
    const accrual = within(interest).getByRole("rowheader", { name: "Interest accrues" }).closest("tr")!;
    expect(within(accrual).getAllByRole("listitem")).toHaveLength(3);
    expect(within(accrual).getByText("Daily, simple (charged later):")).toBeInTheDocument();
    expect(within(within(accrual).getByText("Daily, simple (charged later):").closest("li")!).getByText("Default")).toBeInTheDocument();
    expect(within(within(accrual).getByText("Per payment period:").closest("li")!).queryByText("Default")).not.toBeInTheDocument();
    const rounding = screen.getByRole("table", { name: "Precision and rounding" });
    const working = within(rounding).getByRole("rowheader", { name: "Working rounding" }).closest("tr")!;
    expect(within(within(working).getByText("Half even (banker's):").closest("li")!).getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("How accrual, charging and capitalization fit together")).toBeInTheDocument();
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
