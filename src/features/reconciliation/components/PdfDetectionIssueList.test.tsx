import { fireEvent, render, screen, within } from "@testing-library/react";
import { PdfDetectionIssueList, type PdfDetectionIssue } from "./PdfDetectionIssueList";

function renderList(issues: PdfDetectionIssue[], onResolve = jest.fn()) {
  render(<PdfDetectionIssueList label="What needs attention" issues={issues} onResolve={onResolve} />);
  return onResolve;
}

describe("What needs attention", () => {
  it("lists what needs an answer before what is only worth knowing", () => {
    renderList([
      { message: "$ was read as USD.", kind: "note", focus: "pdf-statement-currency", actionLabel: "Change" },
      { message: "88 rows have an amount without a sign.", kind: "answer", focus: "pdf-unsigned-direction", actionLabel: "Choose a rule" },
    ]);

    const items = within(screen.getByRole("region", { name: "What needs attention" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("88 rows have an amount without a sign.");
    expect(items[1]).toHaveTextContent("$ was read as USD.");
  });

  it("names each action, and takes the reader to a row or a setting", () => {
    const onResolve = renderList([
      { message: "1 row on page 5 was not read as a transaction.", kind: "answer", goTo: [{ pageNumber: 5, rowId: "p5-r3" }] },
      { message: "Pages 10 and 11 have no readable text layer.", kind: "note" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ goTo: [{ pageNumber: 5, rowId: "p5-r3" }] }));
    // A note with nothing to settle offers no button.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("steps through several rows, one at a time, and back to the first", () => {
    const rows = [{ pageNumber: 2, rowId: "a" }, { pageNumber: 4, rowId: "b" }, { pageNumber: 4, rowId: "c" }];
    const onResolve = renderList([{ message: "3 rows on pages 2 and 4 were not read as transactions.", kind: "answer", goTo: rows }]);

    fireEvent.click(screen.getByRole("button", { name: "Show 1 of 3" }));
    expect(onResolve).toHaveBeenLastCalledWith(expect.objectContaining({ goTo: [rows[0]] }));
    fireEvent.click(screen.getByRole("button", { name: "Show 2 of 3" }));
    expect(onResolve).toHaveBeenLastCalledWith(expect.objectContaining({ goTo: [rows[1]] }));
    fireEvent.click(screen.getByRole("button", { name: "Show 3 of 3" }));
    expect(onResolve).toHaveBeenLastCalledWith(expect.objectContaining({ goTo: [rows[2]] }));
    expect(screen.getByRole("button", { name: "Show 1 of 3" })).toBeInTheDocument();
  });

  it("shows the first four and keeps the rest one click away", () => {
    renderList(Array.from({ length: 6 }, (_, index) => ({ message: `Item ${index + 1}`, kind: "note" as const })));

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("says nothing when there is nothing to say", () => {
    renderList([]);
    expect(screen.queryByRole("region")).toBeNull();
  });
});
