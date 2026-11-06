import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { FINANCIAL_INSIGHTS_GUIDE_SECTIONS, FinancialInsightsGuide, guideSectionForTab, type FinancialInsightsGuideSection } from "./FinancialInsightsGuide";

function Guide({ start = "start" as FinancialInsightsGuideSection, onClose = jest.fn() }) {
  const [section, setSection] = useState(start);
  return <FinancialInsightsGuide section={section} onSection={setSection} onClose={onClose} docsUrl="https://example.test/docs/" />;
}

describe("the Financial Insights guide", () => {
  it("has a section for every part of the page, each with its own heading and something to read", () => {
    expect(FINANCIAL_INSIGHTS_GUIDE_SECTIONS.map(([id]) => id)).toEqual(["start", "different", "ready", "counted", "summary", "money", "income", "spending", "budget", "investments", "property", "loans", "statements", "buffer", "drill", "glossary"]);
    for (const [id, label] of FINANCIAL_INSIGHTS_GUIDE_SECTIONS) {
      const { unmount } = render(<Guide start={id} />);
      expect(screen.getByRole("heading", { name: label, level: 2 })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-current", "page");
      // Each section has a visual or a structured list of examples.
      expect(document.querySelectorAll("figure, [aria-label^='Sketch'], table, ol, dl").length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("moves between sections from the list and from the links inside the text", () => {
    render(<Guide />);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Guide sections" })).getByRole("button", { name: "Spending" }));
    expect(screen.getByRole("heading", { name: "Spending", level: 2 })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Guide sections" })).getByRole("button", { name: "Start here" }));
    // The same words are in the list and in the text of the first section: the text one is the second.
    fireEvent.click(screen.getAllByRole("button", { name: "Property & assets" })[1]);
    expect(screen.getByRole("heading", { name: "Property & assets", level: 2 })).toBeInTheDocument();
  });

  it("explains why the page is not a report of transactions, and does not claim to change Actual", () => {
    render(<Guide start="different" />);
    expect(screen.getByText(/why did my wealth and cash change, and am I safe/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Side by side/ })).toBeInTheDocument();
    expect(screen.getByText(/Unexplained/, { selector: "b" })).toBeInTheDocument();
    expect(screen.getByLabelText("What Financial Insights adds to the transactions in Actual")).toBeInTheDocument();
  });

  it("describes the five tiles of a tab with the figures as the page draws them", () => {
    render(<Guide start="money" />);
    for (const label of ["Received", "Spent", "Kept from income", "Savings rate", "Change in cash"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getAllByText("vs previous").length).toBeGreaterThan(0);
  });

  it("distinguishes budget placement and portfolio transfers from investment activity", () => {
    render(<Guide start="counted" />);
    const examples = screen.getByRole("region", { name: "Explore more examples" });
    expect(within(examples).getByText("Cash & bank")).toBeInTheDocument();
    fireEvent.click(within(examples).getByText("Investments"));
    expect(screen.getByText(/neither side has a category/i)).toBeInTheDocument();
    expect(screen.getByText(/Other per account/)).toBeInTheDocument();
    expect(screen.getByText(/Investment activity: a recorded non-transfer change/)).toBeInTheDocument();
    expect(screen.getByText(/Why My budget can differ/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Advanced: How Financial Insights classifies transactions"));
    expect(screen.getByText("On-budget, no category")).toBeVisible();
  });

  it("covers the cash buffer, its goal and its scenarios, and says the loan interest is not counted twice", () => {
    render(<Guide start="buffer" />);
    expect(screen.getByText("Is the loan interest counted twice?")).toBeInTheDocument();
    expect(screen.getByText(/Simulated: Lean months/)).toBeInTheDocument();
    expect(screen.getByText(/The median of each category ignores a month/)).toBeInTheDocument();
  });

  it("links to the documentation, and closes", () => {
    const onClose = jest.fn();
    render(<Guide onClose={onClose} />);
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "https://example.test/docs/")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("opens at the section for the tab you are on", () => {
    expect(guideSectionForTab("summary")).toBe("summary");
    expect(guideSectionForTab("money")).toBe("money");
    expect(guideSectionForTab("wealth")).toBe("investments");
    expect(guideSectionForTab("property")).toBe("property");
    expect(guideSectionForTab("loans")).toBe("loans");
    expect(guideSectionForTab("budget")).toBe("budget");
    expect(guideSectionForTab("statements")).toBe("statements");
    expect(guideSectionForTab("something else")).toBe("start");
  });

});
