/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { createPlanDocument, createRow, setCells } from "@/lib/cashflow-planning/document";
import { computePlan } from "@/lib/cashflow-planning/engine";
import { buildColumns, buildLines } from "../lib/view";
import { PlanGrid, type GridSelection } from "./PlanGrid";

jest.mock("sonner", () => ({ toast: { message: jest.fn() } }));
// jsdom does not scroll.
beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });

function grid(selection: GridSelection | null, rowId?: string) {
  const row = createRow({ name: "Rent", section: "expenses" });
  const other = createRow({ name: "Pay", section: "income" });
  let doc = { ...createPlanDocument({ name: "T", startMonth: "2026-01", years: 1 }), useActuals: false, rows: [row, other] };
  doc = setCells(doc, [{ rowId: row.id, month: "2026-06", amount: 10_000 }, { rowId: row.id, month: "2026-07", amount: 20_000 }, { rowId: other.id, month: "2026-06", amount: 50_000 }]);
  const computed = computePlan(doc, null, null);
  const columns = buildColumns(computed.months, { mode: "months", fromYear: 2026, span: 1 });
  const lines = buildLines(doc, computed, new Set());
  const sel = selection ?? null;
  render(<PlanGrid doc={doc} computed={computed} lines={lines} columns={columns} cents={false} pastMode="actual" selection={sel && rowId ? { ...sel, line: `row:${row.id}`, anchor: sel.anchor ? { ...sel.anchor, line: `row:${row.id}` } : undefined } : sel} problems={new Map()} linkNotes={new Map()} shiftedCells={new Set()} find="" onFind={() => {}} scrollToken={0} onSelect={() => {}} onCollapseAll={() => {}} onToggle={() => {}} onEdit={() => {}} onCommand={() => {}} onNotice={() => {}} />);
}

describe("the selection bar under the grid", () => {
  it("invites a selection when there is none", () => {
    grid(null);
    expect(screen.getByRole("status", { name: "Selection summary" })).toHaveTextContent("Select cells of a row");
  });

  it("adds up the selected cells of a row, with their average and range", () => {
    grid({ line: "x", col: "2026-07", anchor: { line: "x", col: "2026-06" } }, "row");
    const bar = screen.getByRole("status", { name: "Selection summary" });
    expect(bar).toHaveTextContent("Sum300.00");
    expect(bar).toHaveTextContent("Average150.00");
    expect(bar).toHaveTextContent("Min100.00");
    expect(bar).toHaveTextContent("Max200.00");
    expect(bar).toHaveTextContent("2 cells · 1 row × 2 months");
  });
});
