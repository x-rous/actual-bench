import { parsePdfStatementDocument, type PdfStatementPage } from "../pdf";
import { buildPdfDiagnosticsReport, maskForDiagnostics } from "./report";

function page(rows: { y: number; cells: { x: number; text: string }[] }[], pageNumber = 1): PdfStatementPage {
  return {
    pageNumber,
    width: 700,
    height: 800,
    items: rows.flatMap((row, rowIndex) => row.cells.map((cell, cellIndex) => ({
      id: `p${pageNumber}-${rowIndex}-${cellIndex}`,
      str: cell.text,
      transform: [10, 0, 0, 10, cell.x, row.y],
      width: Math.max(8, cell.text.length * 6),
      height: 10,
    }))),
  };
}

const statement = {
  pages: [page([
    { y: 780, cells: [{ x: 20, text: "Customer Zephyrine Quillfeather Account 4485123456789012" }] },
    { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
    { y: 700, cells: [{ x: 20, text: "08/05/2026" }, { x: 120, text: "MARZIPANTOWER BAKERY" }, { x: 480, text: "1,234.56" }] },
    { y: 680, cells: [{ x: 20, text: "08/06/2026" }, { x: 120, text: "Refund Quokkamart" }, { x: 480, text: "20.00 CR" }] },
  ])],
};

describe("diagnostics report", () => {
  const result = parsePdfStatementDocument(statement);
  const report = buildPdfDiagnosticsReport(result, { appVersion: "9.9.9" });
  const json = JSON.stringify(report);

  it("contains none of the statement's names, merchants, figures or account numbers", () => {
    for (const secret of ["Zephyrine", "Quillfeather", "4485123456789012", "MARZIPANTOWER", "BAKERY", "Quokkamart", "1,234.56", "20.00", "08/05/2026"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("keeps the shape of a row, and the words the parser reads", () => {
    expect(maskForDiagnostics("Refund Quokkamart")).toBe("A A");
    expect(maskForDiagnostics("20.00 CR")).toBe("99.99 CR");
    expect(maskForDiagnostics("12-Feb-2026")).toBe("99-Feb-9999");
    expect(maskForDiagnostics("الرصيد الافتتاحي")).toBe("A A");
    expect(maskForDiagnostics("Total Amount (AED)")).toBe("Total Amount (AED)");
  });

  it("says which version read it and what settings were in force, with their source", () => {
    expect(report.appVersion).toBe("9.9.9");
    expect(report.settings.unsignedDirection).toEqual({ inUse: "review", detected: "review", changed: false });
    expect(report.settings.statementPeriod.inUse).toEqual(expect.objectContaining({ start: expect.any(Boolean) }));
  });

  it("gives the columns as positions and why rows are not ready, as counts", () => {
    expect(report.columns.inUse.map((column) => column.role)).toEqual(expect.arrayContaining(["transaction-date", "description", "amount"]));
    expect(report.columns.inUse.every((column) => column.from >= 0 && column.to <= 100)).toBe(true);
    expect(Object.values(report.outcome.byStatus).reduce((sum, count) => sum + count, 0)).toBe(result.transactions.length);
    expect(report.rowSamples.transactions.length).toBeGreaterThan(0);
  });

  it("counts per-row events instead of listing each one", () => {
    expect(report.events.counts["interpret:TRANSACTION_INTERPRETED"]).toBe(result.transactions.length);
    expect(report.events.events.some((event) => event.code === "TRANSACTION_INTERPRETED")).toBe(false);
  });
});
