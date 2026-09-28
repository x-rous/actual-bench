import { render, screen } from "@testing-library/react";
import { PdfStatementLayoutPanel } from "./PdfStatementLayoutPanel";

describe("Statement Layout without a saved layout", () => {
  it("says so briefly in its header instead of a line of its own", () => {
    render(
      <PdfStatementLayoutPanel
        profiles={[]}
        selectedProfileId={null}
        accountProfileId={null}
        accountName="Card"
        notices={[]}
        disabled={false}
        canSave
        saveBlockedReason={null}
        onSelect={() => {}}
      />
    );

    expect(screen.getByText("Not saved · save to reuse next month")).toBeInTheDocument();
    expect(screen.queryByText("Detected from this statement only. Save a layout to reuse it next month.")).toBeNull();
  });
});
