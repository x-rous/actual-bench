import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { ACCOUNT_CLASS_INFO } from "@/lib/account-class";
import { REPORTING_LABELS, reportingRequirement } from "@/lib/account-class/reporting";
import { ACCOUNTS_GUIDE_SECTIONS, AccountsGuide, type AccountsGuideSection } from "./AccountsGuide";

function Guide({ start = "start" as AccountsGuideSection, onClose = jest.fn() }) {
  const [section, setSection] = useState(start);
  return <AccountsGuide section={section} onSection={setSection} onClose={onClose} docsUrl="https://example.test/accounts/" />;
}

describe("the Accounts guide", () => {
  it("has a section for each part, each with its own heading and something to read", () => {
    expect(ACCOUNTS_GUIDE_SECTIONS.map(([id]) => id)).toEqual(["start", "classes", "reporting", "matters", "ready"]);
    for (const [id, label] of ACCOUNTS_GUIDE_SECTIONS) {
      const { unmount } = render(<Guide start={id} />);
      expect(screen.getByRole("heading", { name: label, level: 2 })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-current", "page");
      expect(document.querySelectorAll("figure, table, ol").length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("lists every class the Class column offers, from the real definitions, and marks the off-budget-only ones", () => {
    render(<Guide start="classes" />);
    const map = screen.getByLabelText("The account classes");
    for (const info of ACCOUNT_CLASS_INFO) expect(within(map).getByText(info.label)).toBeInTheDocument();
    const marked = [...map.querySelectorAll("li")].filter((li) => li.textContent?.includes("off-budget only")).map((li) => li.querySelector("b")?.textContent);
    expect(marked).toEqual(["Vehicle", "Property", "Investment", "Retirement", "Loan"]);
    const onBudget = [...map.querySelectorAll("li")].filter((li) => li.textContent?.includes("on-budget only")).map((li) => li.querySelector("b")?.textContent);
    expect(onBudget).toEqual(["Credit Card"]);
    expect(within(map).queryByText("Excluded")).not.toBeInTheDocument();
  });

  it("shows what Financial Reporting does for every class: the default, the alternative and the choices", () => {
    render(<Guide start="reporting" />);
    const table = screen.getByLabelText("Financial Reporting for each class");
    for (const info of ACCOUNT_CLASS_INFO) {
      const r = reportingRequirement(info.value);
      expect(within(table).getAllByText(info.label).length).toBeGreaterThan(0);
      if (r.kind === "optional") for (const option of r.options) expect(within(table).getAllByText(REPORTING_LABELS[option]).length).toBeGreaterThan(0);
    }
    // Bank shows both: the default, in green, and the alternative.
    const bankCells = [...(within(table).getByText("Bank").parentElement as HTMLElement).children];
    expect(bankCells[1]).toHaveTextContent("Cash & cash equivalents · default");
    expect(bankCells[1].querySelector("span")?.className).toMatch(/green/);
    expect(bankCells[2]).toHaveTextContent("Fixed / restricted deposit");
    // Nothing is required: no row asks the user to choose, and Other Asset shows its default and its alternatives.
    expect(within(table).queryByText("Choose…")).not.toBeInTheDocument();
    const otherCells = [...(within(table).getByText("Other Asset").parentElement as HTMLElement).children];
    expect(otherCells[1]).toHaveTextContent("Holding · default");
    expect(otherCells[2]).toHaveTextContent("Accessible money");
    expect(otherCells[2]).toHaveTextContent("Fixed asset");
  });

  it("names where the classes are used by page or module, not by tab, and says what happens without them", () => {
    render(<Guide start="matters" />);
    const map = screen.getByLabelText("Where classes and Financial Reporting are used");
    for (const name of ["Financial Insights", "Assets", "Credit Cards", "Bank Reconciliation"]) expect(within(map).getByText(name)).toBeInTheDocument();
    expect(within(map).queryByText(/tab$/)).not.toBeInTheDocument();
    expect(within(map).getAllByText("If not set:")).toHaveLength(4);
  });

  it("explains why it matters with one balance read four ways, laid out in aligned columns", () => {
    render(<Guide start="matters" />);
    const figure = screen.getByLabelText("The same balance, read four ways");
    expect(figure).toHaveTextContent("Bank · fixed / restricted deposit");
    expect(figure).toHaveTextContent("does not count toward your cash buffer");
    expect(within(figure).getAllByText(/^−?50,000$/)).toHaveLength(4);
  });

  it("moves between sections from the list and from the links in the text, links to the docs, and closes", () => {
    const onClose = jest.fn();
    render(<Guide onClose={onClose} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Account classes" })[1]);
    expect(screen.getByRole("heading", { name: "Account classes", level: 2 })).toBeInTheDocument();
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "https://example.test/accounts/")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the questions with getting accounts ready, not in a section of their own", () => {
    expect(ACCOUNTS_GUIDE_SECTIONS.map(([, label]) => label)).not.toContain("Questions");
    render(<Guide start="ready" />);
    expect(screen.getByRole("heading", { name: "Common questions" })).toBeInTheDocument();
  });
});
