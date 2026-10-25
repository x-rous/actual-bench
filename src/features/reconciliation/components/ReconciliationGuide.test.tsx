import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { RECONCILIATION_GUIDE_SECTIONS, ReconciliationGuide, type ReconciliationGuideSection } from "./ReconciliationGuide";

function Harness({ onClose = jest.fn() }: { onClose?: () => void }) {
  const [section, setSection] = useState<ReconciliationGuideSection>("start");
  return <ReconciliationGuide section={section} onSection={setSection} onClose={onClose} docsUrl="https://example.test/docs/" />;
}

describe("the Bank Reconciliation guide", () => {
  it("opens on Getting started and links to the full documentation", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "Getting started" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Full documentation" })).toHaveAttribute("href", "https://example.test/docs/");
    expect(screen.getByRole("list", { name: "The four steps" })).toBeInTheDocument();
  });

  it("shows every section from the menu, each with its own heading", () => {
    render(<Harness />);
    const menu = within(screen.getByRole("navigation", { name: "Guide sections" }));
    for (const [, label] of RECONCILIATION_GUIDE_SECTIONS) {
      fireEvent.click(menu.getByRole("button", { name: label }));
      expect(screen.getByRole("heading", { level: 2, name: label })).toBeInTheDocument();
      expect(menu.getByRole("button", { name: label })).toHaveAttribute("aria-current", "page");
    }
  });

  it("explains the figures that confuse people: the imported payee and the apply checks", () => {
    render(<Harness />);
    const menu = within(screen.getByRole("navigation", { name: "Guide sections" }));
    fireEvent.click(menu.getByRole("button", { name: "Reviewing the plan" }));
    expect(screen.getByText("Imported payee, in plain words")).toBeInTheDocument();
    fireEvent.click(menu.getByRole("button", { name: "Applying safely" }));
    expect(screen.getByRole("list", { name: "What Apply does, in order" })).toBeInTheDocument();
  });

  it("links between sections from the text", () => {
    render(<Harness />);
    // The second button of that name is the link in the text, after the menu entry.
    fireEvent.click(screen.getAllByRole("button", { name: "Importing a statement" })[1]);
    expect(screen.getByRole("heading", { level: 2, name: "Importing a statement" })).toBeInTheDocument();
  });
});
