import { fireEvent, render, screen, within } from "@testing-library/react";
import type { BudgetDiagnostic } from "../types";
import { DiagnosticsTable } from "./DiagnosticsTable";

const finding = (code: string, severity: BudgetDiagnostic["severity"], title: string): BudgetDiagnostic => ({ code, severity, title, message: `${title} message` });
const findings = [finding("B", "info", "An info"), finding("A", "error", "An error"), finding("C", "warning", "A warning")];

/** The titles in the order the rows are shown. */
const shown = () => within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row").map((row) => within(row).getByText(/^An? (info|error|warning)$/).textContent);

describe("the findings table", () => {
  it("starts with the most severe first, and follows the sort when a header is chosen", () => {
    render(<DiagnosticsTable findings={findings} />);
    expect(shown()).toEqual(["An error", "A warning", "An info"]);
    fireEvent.click(screen.getByRole("button", { name: /Severity/ }));
    expect(shown()).toEqual(["An info", "A warning", "An error"]);
    fireEvent.click(screen.getByRole("button", { name: /^Code/ }));
    expect(shown()).toEqual(["An error", "An info", "A warning"]);
  });

  it("shows only the chosen severity", () => {
    render(<DiagnosticsTable findings={findings} />);
    fireEvent.click(screen.getByRole("button", { name: /^Warnings/ }));
    expect(shown()).toEqual(["A warning"]);
  });

  it("says so when nothing is left for the filter", () => {
    render(<DiagnosticsTable findings={[finding("A", "error", "An error")]} />);
    fireEvent.click(screen.getByRole("button", { name: /^Infos/ }));
    expect(screen.getByText("No findings for this filter.")).toBeInTheDocument();
  });
});
