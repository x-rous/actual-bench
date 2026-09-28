import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_PDF_PARSER_GUIDANCE } from "@/lib/reconciliation/statement/pdf";
import { PdfDetectionControls } from "./PdfDetectionControls";

function renderControls(onChange = jest.fn(), attentionIds: string[] = []) {
  render(
    <PdfDetectionControls
      guidance={DEFAULT_PDF_PARSER_GUIDANCE}
      accountType="credit-card"
      detectedDirection="unmarked amounts need a rule"
      attentionIds={attentionIds}
      focusRequest={null}
      open
      disabled={false}
      onOpenChange={() => {}}
      onChange={onChange}
    />
  );
  return onChange;
}

describe("page rules in Statement interpretation", () => {
  it("sets how many pages to ignore at each end", () => {
    const onChange = renderControls();

    fireEvent.change(screen.getByLabelText("Ignore the first N pages"), { target: { value: "2" } });
    expect(onChange).toHaveBeenLastCalledWith({ pageRules: { ignoreFirst: 2, ignoreLast: 0 } });

    fireEvent.change(screen.getByLabelText("Ignore the last N pages"), { target: { value: "1" } });
    expect(onChange).toHaveBeenLastCalledWith({ pageRules: { ignoreFirst: 0, ignoreLast: 1 } });
  });

  it("keeps the value a whole number from 0 to 20", () => {
    const onChange = renderControls();
    const first = screen.getByLabelText("Ignore the first N pages");

    fireEvent.change(first, { target: { value: "99" } });
    expect(onChange).toHaveBeenLastCalledWith({ pageRules: { ignoreFirst: 20, ignoreLast: 0 } });
    fireEvent.change(first, { target: { value: "-3" } });
    expect(onChange).toHaveBeenLastCalledWith({ pageRules: { ignoreFirst: 0, ignoreLast: 0 } });
  });

  it("explains that the pages are still read, behind the field's info hint", () => {
    renderControls();
    expect(screen.getByRole("button", { name: "More about ignore first / last n pages" })).toBeInTheDocument();
  });
});

describe("amount direction", () => {
  it("says what automatic detection found", () => {
    renderControls();
    expect(screen.getByLabelText("Amount direction")).toHaveTextContent("Auto-detect (unmarked amounts need a rule)");
  });

  it("marks the settings rows are waiting on, and the section, without saying it twice", () => {
    renderControls(jest.fn(), ["pdf-unsigned-direction", "pdf-statement-period-start"]);

    expect(screen.getByLabelText("Amount direction")).toHaveClass("border-amber-500");
    expect(screen.getByLabelText("Statement period start")).toHaveClass("border-amber-500");
    expect(screen.getByLabelText("Statement currency")).not.toHaveClass("border-amber-500");
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    // The messages themselves live in "What needs attention", not here.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("highlights nothing when nothing is waiting", () => {
    renderControls();
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.getByLabelText("Amount direction")).not.toHaveClass("border-amber-500");
  });
});

describe("explaining each setting", () => {
  it("gives every setting an (i) that says what it changes", () => {
    renderControls();
    for (const name of ["account type", "statement currency", "use as import date", "printed sign means", "amount direction", "date format", "number format", "statement period", "ignore first / last n pages"]) {
      expect(screen.getByRole("button", { name: `More about ${name}` })).toBeInTheDocument();
    }
  });

  it("links to the guide on how statements are read", () => {
    renderControls();
    const link = screen.getByRole("link", { name: /How statements are read/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("bank-reconciliation/#how-the-statement-is-read"));
    expect(link).toHaveAttribute("target", "_blank");
  });
});
