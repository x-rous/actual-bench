import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  createPdfLayoutProfile,
  DEFAULT_PDF_PARSER_GUIDANCE,
  parsePdfStatementPages,
  type PdfParserGuidance,
  type PdfStatementPage,
} from "@/lib/reconciliation/statement/pdf";
import { PdfStatementReviewDialog, type PdfDetectionProfileOption } from "./PdfStatementReviewDialog";
import { pdfColumnColor } from "./PdfSourcePreview";

const toastSuccess = jest.fn();
jest.mock("sonner", () => ({
  toast: { success: (message: string, options?: unknown) => toastSuccess(message, options) },
}));

function result(rows: { y: number; cells: { x: number; text: string }[] }[], guidancePatch: Partial<PdfParserGuidance> = {}) {
  const page: PdfStatementPage = {
    pageNumber: 1,
    width: 700,
    height: 800,
    items: rows.flatMap((row, rowIndex) => row.cells.map((cell, cellIndex) => ({
      id: `${rowIndex}-${cellIndex}`,
      str: cell.text,
      transform: [10, 0, 0, 10, cell.x, row.y],
      width: cell.text.length * 6,
      height: 10,
    }))),
  };
  return parsePdfStatementPages([page], {
    guidance: { ...DEFAULT_PDF_PARSER_GUIDANCE, currency: "USD", dateFormat: "mdy", ...guidancePatch },
  });
}

function ordinaryResult() {
  return result([
    { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
    { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
  ]);
}

describe("PdfStatementReviewDialog v2", () => {
  beforeEach(() => toastSuccess.mockClear());

  it("starts with a compact automatic result and keeps calibration behind Adjust detection", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);

    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-[calc(100vw-2rem)]");
    expect(screen.getByRole("tab", { name: /Review transactions/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Adjust detection/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Number format")).toBeNull();
    expect(screen.getByRole("table", { name: /Transactions extracted/ })).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "PDF parse summary" });
    const netChange = within(summary).getByText("Net change").parentElement!;
    expect(within(netChange).getByText("-12.50")).toBeInTheDocument();
  });

  it("groups global profiles by bank", () => {
    const parsed = ordinaryResult();
    const layout = createPdfLayoutProfile({
      id: "layout-1",
      name: "Credit card",
      result: parsed,
    });
    const option: PdfDetectionProfileOption = {
      recordId: "record-1",
      bankId: "bank-1",
      bankName: "HSBC Bank",
      envelope: { kind: "pdf-layout-v2", profile: layout },
    };
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={parsed} profiles={[option]} activeProfileId="record-1" open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("tab", { name: /Adjust detection/ }));
    const selector = screen.getByLabelText("Detection profile") as HTMLSelectElement;
    expect(selector.value).toBe("record-1");
    expect(selector.querySelector("optgroup")?.label).toBe("HSBC Bank");
    expect(within(selector).getByRole("option", { name: "Credit card" })).toBeInTheDocument();
  });

  it("keeps profile selection statement-only until the user assigns it to the account", async () => {
    const parsed = ordinaryResult();
    const layout = createPdfLayoutProfile({ id: "layout-1", name: "Credit card", result: parsed });
    const option: PdfDetectionProfileOption = {
      recordId: "record-1",
      bankId: "bank-1",
      bankName: "HSBC Bank",
      envelope: { kind: "pdf-layout-v2", profile: layout },
    };
    const onAssignProfile = jest.fn().mockResolvedValue(undefined);
    const noop = jest.fn().mockResolvedValue(undefined);
    render(
      <PdfStatementReviewDialog
        fileName="statement.pdf"
        result={parsed}
        profiles={[option]}
        banks={[{ id: "bank-1", name: "HSBC Bank", createdAt: "2026-09-19T00:00:00.000Z", updatedAt: "2026-09-19T00:00:00.000Z" }]}
        accountName="HSBC card"
        open
        onOpenChange={() => {}}
        onImport={() => {}}
        onAssignProfile={onAssignProfile}
        onRemoveAccountAssignment={noop}
        onRenameBank={noop}
        onRenameProfile={noop}
        onDeleteProfile={noop}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: /Adjust detection/ }));
    fireEvent.change(screen.getByLabelText("Detection profile"), { target: { value: "record-1" } });
    await waitFor(() => expect(screen.getByText(/this statement only/)).toBeInTheDocument());
    expect(onAssignProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use for this account" }));
    expect(onAssignProfile).toHaveBeenCalledWith("record-1");

    fireEvent.click(screen.getByRole("button", { name: "Manage profiles" }));
    expect(screen.getByRole("dialog", { name: "Manage detection profiles" })).toBeInTheDocument();
    expect(screen.getByText("HSBC card")).toBeInTheDocument();
  });

  it("uses one-click sign reversal and preserves the reviewed import boundary", () => {
    const onImport = jest.fn();
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={onImport} />);

    fireEvent.click(screen.getByRole("button", { name: "Change row 1 to money in" }));
    expect(screen.getByRole("button", { name: "Change row 1 to money out" })).toHaveTextContent("+");
    const useButton = screen.getByRole("button", { name: /Use 1 reviewed transaction/ });
    expect(useButton).toBeEnabled();
    fireEvent.click(useButton);
    expect(onImport).toHaveBeenCalledWith(
      [expect.objectContaining({ amount: "12.50", direction: "credit", directionEvidence: "manual" })],
      expect.objectContaining({ modelVersion: 2 })
    );
  });

  it("re-parses a manually edited amount instead of retaining stale financial data", () => {
    const onImport = jest.fn();
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={onImport} />);

    const amount = screen.getByLabelText("Amount for PDF row 1");
    fireEvent.change(amount, { target: { value: "25.75" } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole("button", { name: /Use 1 reviewed transaction/ }));

    expect(onImport).toHaveBeenCalledWith(
      [expect.objectContaining({ amount: "-25.75", exactAmount: expect.objectContaining({ coefficient: "-2575", scale: 2 }) })],
      expect.anything()
    );
  });

  it("shows grouped amounts without treating unchanged formatting as a manual edit", async () => {
    const onImport = jest.fn();
    const largeAmount = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -6000.00" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={largeAmount} open onOpenChange={() => {}} onImport={onImport} />);

    const amount = screen.getByLabelText("Amount for PDF row 1");
    expect(amount).toHaveValue("6,000.00");
    fireEvent.blur(amount);
    await waitFor(() => expect(amount).toHaveValue("6,000.00"));
    fireEvent.click(screen.getByRole("button", { name: /Use 1 reviewed transaction/ }));

    expect(onImport).toHaveBeenCalledWith(
      [expect.objectContaining({ amount: "-6000.00", issueCodes: expect.not.arrayContaining(["ROW_MANUALLY_CHANGED"]) })],
      expect.anything()
    );

    fireEvent.change(amount, { target: { value: "7,500.00" } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole("button", { name: /Use 1 reviewed transaction/ }));
    expect(onImport).toHaveBeenLastCalledWith(
      [expect.objectContaining({ amount: "-7500.00", exactAmount: expect.objectContaining({ coefficient: "-750000", scale: 2 }) })],
      expect.anything()
    );
  });

  it("revalidates a corrected import date in one parser run", () => {
    const ambiguous = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "03/04/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
    ], { dateFormat: "auto" });
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ambiguous} open onOpenChange={() => {}} onImport={() => {}} />);

    expect(screen.getByRole("tab", { name: /Adjust detection/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Review transactions/ }));
    expect(screen.getByRole("button", { name: /Use 1 reviewed transaction/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
    const date = screen.getByLabelText("Transaction date for PDF row 1");
    fireEvent.change(date, { target: { value: "2026-03-04" } });
    fireEvent.blur(date);
    expect(screen.getByRole("button", { name: /Use 1 reviewed transaction/ })).toBeEnabled();
  });

  it("lets the user correct a row currency and preserves it with the exact amount", () => {
    const onImport = jest.fn();
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={onImport} />);

    const currency = screen.getByLabelText("Currency for PDF row 1");
    fireEvent.change(currency, { target: { value: "EUR" } });
    fireEvent.blur(currency);
    fireEvent.click(screen.getByRole("button", { name: /Use 1 reviewed transaction/ }));

    expect(onImport).toHaveBeenCalledWith(
      [expect.objectContaining({ currency: "EUR", exactAmount: expect.objectContaining({ currency: "EUR" }) })],
      expect.anything()
    );
  });

  it("applies a selected bulk ignore as one correction batch", () => {
    const duplicate = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "FIRST" }, { x: 480, text: "USD -12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "SECOND" }, { x: 480, text: "USD -8.00" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={duplicate} open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible PDF rows" }));
    const ignore = screen.getByRole("button", { name: "Ignore" });
    expect(ignore.closest('[data-slot="dialog-footer"]')).not.toBeNull();
    fireEvent.click(ignore);

    expect(screen.getByText("No transactions match this view.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Use 0 reviewed transactions/ })).toBeDisabled();
  });

  it("opens source evidence for a field and highlights the supporting PDF item", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Show amount source for PDF row 1" }));

    expect(screen.getByRole("heading", { name: "Source" })).toBeInTheDocument();
    const source = screen.getAllByText("-12.50").find((element) => element.className.includes("bg-sky-300"));
    expect(source).toBeDefined();
    expect(source!.className).toContain("bg-sky-300");
  });

  it("provides visual region and column mapping with source examples", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /Adjust detection/ }));

    expect(screen.getByText("Column mapping")).toBeInTheDocument();
    expect(screen.getAllByText(/Examples:/).length).toBeGreaterThan(0);
    const roleSelect = screen.getByLabelText("Role for mapped column 1") as HTMLSelectElement;
    expect(Array.from(roleSelect.querySelectorAll("optgroup"), (group) => group.label)).toEqual([
      "Dates",
      "Transaction details",
      "Account values",
      "Foreign-currency details",
      "Charges",
      "Exclude",
    ]);
    const dateMapping = roleSelect.closest("div")!;
    expect(within(dateMapping).getByText("Examples: 08/15/2026")).toBeInTheDocument();
    expect(dateMapping).toHaveClass("items-center");
    expect(within(dateMapping).getByRole("button", { name: "Remove transaction-date column" })).toBeInTheDocument();
    expect(within(dateMapping).queryByText(/ANON SHOP/)).toBeNull();
    const boundary = screen.getByRole("button", { name: /Move transaction-date column start boundary/ });
    expect(boundary).toHaveClass("w-3", "bg-transparent");
    expect(screen.getByText("transaction date")).toHaveClass("text-white");
    const firstSwatch = screen.getByLabelText("Role for mapped column 1").previousElementSibling as HTMLElement;
    const secondSwatch = screen.getByLabelText("Role for mapped column 2").previousElementSibling as HTMLElement;
    expect(firstSwatch.style.backgroundColor).toBeTruthy();
    expect(firstSwatch.style.backgroundColor).not.toBe(secondSwatch.style.backgroundColor);
    const previousEnd = screen.getAllByRole("button", { name: /column end boundary/ }).at(-1)!.parentElement!;
    const previousRight = Number.parseFloat(previousEnd.style.left) + Number.parseFloat(previousEnd.style.width);
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    const addedColumn = screen.getByRole("button", { name: "Move ignore column start boundary" }).parentElement!;
    expect(Number.parseFloat(addedColumn.style.left)).toBeGreaterThan(previousRight);
    expect(screen.getByRole("region", { name: "Page sections" })).toBeInTheDocument();
    expect(screen.getByText("Sections")).toBeInTheDocument();
    const floatingSectionControl = screen.getByRole("button", { name: "Ignore section 1 in PDF" });
    const sectionOverviewControl = screen.getByRole("button", { name: "Ignore section 1 from page sections" });
    expect(floatingSectionControl).toHaveTextContent("Section 1 · Included");
    expect(floatingSectionControl).toHaveClass("bg-emerald-600");
    expect(sectionOverviewControl).toHaveClass("bg-emerald-500/10");
    const previewChanges = screen.getByRole("button", { name: "Preview changes" });
    expect(previewChanges.closest(".border-t")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply detection changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Draw transaction region" })).toBeInTheDocument();
    expect(screen.queryByText("Page 1")).not.toBeInTheDocument();
    const coverage = screen.getByText(/% text coverage/);
    expect(coverage).toHaveClass("ml-auto");
    const mappingToggle = screen.getByRole("button", { name: "Hide column mappings" });
    expect(coverage.compareDocumentPosition(mappingToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const interpretation = screen.getByText("Document interpretation");
    expect(interpretation.compareDocumentPosition(previewChanges) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Change preview")).not.toBeInTheDocument();
    expect(interpretation.closest(".overflow-auto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide column mappings" }));
    expect(screen.queryByRole("button", { name: /Move transaction-date column start boundary/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ignore section 1 in PDF" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show column mappings" }));
    expect(screen.getByRole("button", { name: /Move transaction-date column start boundary/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ignore section 1 in PDF" }));
    expect(screen.getByRole("button", { name: "Include section 1 in PDF" })).toHaveClass("bg-amber-400");
    expect(screen.getByRole("button", { name: "Include section 1 from page sections" })).toHaveClass("bg-amber-500/15");
    fireEvent.click(screen.getByRole("button", { name: "Include section 1 from page sections" }));
    expect(screen.getByRole("button", { name: "Ignore section 1 in PDF" })).toHaveClass("bg-emerald-600");

    const nonTransactionSourceRow = screen.getAllByRole("button", { name: /Select source row/ })
      .find((button) => button.getAttribute("aria-label")?.includes("Transaction Date"));
    expect(nonTransactionSourceRow).toBeDefined();
    fireEvent.click(nonTransactionSourceRow!);
    expect(screen.getByRole("button", { name: "Mark selected row as transaction" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Role for mapped column 1"), { target: { value: "amount" } });
    expect(within(dateMapping).getByText("Examples: No matching value read yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    const comparison = screen.getByRole("region", { name: "Detection change preview" });
    expect(within(comparison).getByText("Transactions")).toBeInTheDocument();
    expect(within(comparison).getByText("Needs review")).toBeInTheDocument();
    expect(within(comparison).getByText("Money in")).toBeInTheDocument();
    expect(within(comparison).getByText("Money out")).toBeInTheDocument();
    expect(within(comparison).queryByText("Net change")).toBeNull();
    expect(within(comparison).getByText("Rows changed")).toBeInTheDocument();
    expect(within(comparison).getByLabelText("Detection count comparison").children).toHaveLength(3);
    expect(within(comparison).getByLabelText("Detection amount comparison").children).toHaveLength(2);
    expect(within(comparison).getByText("Preview impact")).toBeInTheDocument();
    expect(within(comparison).getAllByTitle(/Current .*; preview/)).toHaveLength(4);
    expect(within(comparison).getByText("Money in")).toHaveClass("text-emerald-700");
    expect(within(comparison).getByText("Money out")).toHaveClass("text-rose-700");
    const applyDetection = screen.getByRole("button", { name: "Apply detection changes" });
    expect(applyDetection).toBeEnabled();
    fireEvent.click(applyDetection);
    expect(toastSuccess).toHaveBeenCalledWith("Detection changes applied", expect.objectContaining({ description: expect.any(String) }));
    expect(screen.queryByText(/Updated result:/)).not.toBeInTheDocument();
  });

  it("uses a strongly separated mapping palette that avoids section-state colors", () => {
    const colors = Array.from({ length: 12 }, (_, index) => pdfColumnColor(index).border);

    expect(new Set(colors).size).toBe(12);
    expect(colors.slice(0, 6)).toEqual(["#2563eb", "#c026d3", "#0891b2", "#dc2626", "#7c3aed", "#475569"]);
    expect(colors).not.toContain("#059669");
    expect(colors).not.toContain("#d97706");
  });

  it("moves a column and its selected PDF area left or right", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /Adjust detection/ }));

    const originalDateArea = screen.getByRole("button", { name: "Move transaction-date column start boundary" }).parentElement!;
    const originalDescriptionArea = screen.getByRole("button", { name: "Move description column start boundary" }).parentElement!;
    const originalDateWidth = Number.parseFloat(originalDateArea.style.width);
    expect(Number.parseFloat(originalDateArea.style.left)).toBeLessThan(Number.parseFloat(originalDescriptionArea.style.left));

    fireEvent.click(screen.getByRole("button", { name: "Move transaction-date column right" }));

    expect(screen.getByLabelText("Role for mapped column 1")).toHaveValue("description");
    expect(screen.getByLabelText("Role for mapped column 2")).toHaveValue("transaction-date");
    const movedDateArea = screen.getByRole("button", { name: "Move transaction-date column start boundary" }).parentElement!;
    const movedDescriptionArea = screen.getByRole("button", { name: "Move description column start boundary" }).parentElement!;
    expect(Number.parseFloat(movedDateArea.style.left)).toBeGreaterThan(Number.parseFloat(movedDescriptionArea.style.left));
    expect(Number.parseFloat(movedDateArea.style.width)).toBeCloseTo(originalDateWidth);
  });

  it("temporarily hides section fills while a column boundary is dragged", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /Adjust detection/ }));

    const boundary = screen.getByRole("button", { name: "Move transaction-date column start boundary" });
    const includedRegion = document.querySelector(".border-emerald-500\\/70") as HTMLElement;
    expect(includedRegion).toHaveClass("bg-emerald-300/5");

    fireEvent.pointerDown(boundary, { pointerId: 1 });
    expect(includedRegion).not.toHaveClass("bg-emerald-300/5");
    fireEvent.pointerUp(boundary, { pointerId: 1 });
    expect(includedRegion).toHaveClass("bg-emerald-300/5");
  });

  it("formats balances with thousands separators in the transaction table", () => {
    const parsed = ordinaryResult();
    const withBalance = {
      ...parsed,
      guidance: {
        ...parsed.guidance,
        columns: [
          ...parsed.guidance.columns,
          { ...parsed.guidance.columns[0], id: "balance-column", role: "balance" as const },
        ],
      },
      transactions: parsed.transactions.map((row) => ({ ...row, balance: "112953.65" })),
    };

    render(<PdfStatementReviewDialog fileName="statement.pdf" result={withBalance} open onOpenChange={() => {}} onImport={() => {}} />);

    expect(screen.getByRole("columnheader", { name: "Balance" })).toBeInTheDocument();
    expect(screen.getByText("112,953.65")).toBeInTheDocument();
  });

  it("shows and edits a value date when it is mapped, marking it as the import date", () => {
    const withValueDate = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Value Date" }, { x: 220, text: "Description" }, { x: 500, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/14/2026" }, { x: 120, text: "08/15/2026" }, { x: 220, text: "ANON" }, { x: 500, text: "USD -12.50" }] },
    ], { importDate: "value" });
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={withValueDate} open onOpenChange={() => {}} onImport={() => {}} />);

    expect(screen.getByRole("columnheader", { name: "Value date" })).toBeInTheDocument();
    expect(screen.getByLabelText("Value date for PDF row 1")).toHaveValue("2026-08-15");
  });

  it("offers a restore action after a row is ignored", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Ignore PDF row 1" }));
    fireEvent.click(screen.getByRole("tab", { name: /Adjust detection/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restore ignored row 1" }));
    fireEvent.click(screen.getByRole("tab", { name: /Review transactions/ }));
    expect(screen.getByLabelText("Description for PDF row 1")).toHaveValue("ANON SHOP");
  });

  it("keeps possible duplicates blocked until the user explicitly accepts them", () => {
    const duplicate = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={duplicate} open onOpenChange={() => {}} onImport={() => {}} />);

    expect(screen.getByRole("button", { name: /Use 2 reviewed transactions/ })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Mark reviewed" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    expect(screen.getByRole("button", { name: /Use 2 reviewed transactions/ })).toBeEnabled();
  });

  it("marks multiple selected review rows as reviewed in one bulk action", () => {
    const duplicate = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={duplicate} open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible PDF rows" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark 2 reviewed" }));

    expect(screen.getByRole("button", { name: /Use 2 reviewed transactions/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
  });

  it("shows diagnostics without exposing source text", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /Diagnostics/ }));

    const section = screen.getByRole("heading", { name: "Parser diagnostics" }).closest("section")!;
    expect(within(section).getByText(/Statement text is not logged/)).toBeInTheDocument();
    expect(within(section).queryByText(/ANON SHOP/)).toBeNull();
  });

  it("saves a privacy-safe bank profile without deriving names from the uploaded filename", async () => {
    const onSaveProfile = jest.fn().mockResolvedValue(undefined);
    render(<PdfStatementReviewDialog fileName="private-source-name.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} onSaveProfile={onSaveProfile} />);
    fireEvent.click(screen.getByRole("tab", { name: /Adjust detection/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    fireEvent.change(screen.getByPlaceholderText("For example, HSBC Bank"), { target: { value: "HSBC Bank" } });
    fireEvent.change(screen.getByPlaceholderText("For example, Credit card"), { target: { value: "Credit card" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Save detection profile" })).getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledWith(expect.objectContaining({
      bankName: "HSBC Bank",
      profileName: "Credit card",
      assignToAccount: true,
      result: expect.objectContaining({ modelVersion: 2 }),
    })));
    expect(JSON.stringify(onSaveProfile.mock.calls)).not.toContain("private-source-name");
  });

  it("explains an image-only PDF without offering import", async () => {
    render(<PdfStatementReviewDialog fileName="scan.pdf" result={parsePdfStatementPages([{ pageNumber: 1, width: 700, height: 800, items: [] }])} open onOpenChange={() => {}} onImport={() => {}} />);
    await waitFor(() => expect(screen.getByText(/does not have a usable text layer/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Use/ })).toBeNull();
  });
});
