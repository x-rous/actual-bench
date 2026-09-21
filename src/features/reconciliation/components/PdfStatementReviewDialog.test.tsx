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

/** This jsdom build has no Blob.text, so the export is read back the long way. */
function readBlobText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
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

  it("starts with a compact automatic result and keeps calibration behind Check detection", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);

    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-[calc(100vw-2rem)]");
    expect(screen.getByRole("button", { name: /Review transactions/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: /Check detection/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Number format")).toBeNull();
    expect(screen.getByRole("table", { name: /Transactions extracted/ })).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "PDF parse summary" });
    expect(summary.textContent).toContain("1 transaction");
    const net = within(summary).getByText("Net").parentElement!;
    expect(within(net).getByText("-12.50")).toBeInTheDocument();
    // The state of the statement is a single pill rather than a raw count.
    expect(within(summary).getByText("All ready")).toBeInTheDocument();
    const reviewStep = screen.getByRole("button", { name: /Review transactions/ });
    expect(reviewStep.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Needs review 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ready 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Manual changes/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Correction scope")).not.toBeInTheDocument();
  });

  it("groups issue filters under a clickable Needs review filter", () => {
    const parsed = ordinaryResult();
    const accepted = parsed.transactions[0];
    const withReviewRows = {
      ...parsed,
      transactions: [
        { ...accepted, id: "accepted", description: "READY ROW", sourceRowNumber: 1 },
        {
          ...accepted,
          id: "review-date",
          description: "DATE REVIEW ROW",
          sourceRowNumber: 2,
          status: "review" as const,
          issueCodes: ["DATE_AMBIGUOUS_ORDER"] as typeof accepted.issueCodes,
        },
        {
          ...accepted,
          id: "rejected-amount",
          description: "AMOUNT REVIEW ROW",
          sourceRowNumber: 3,
          status: "rejected" as const,
          issueCodes: ["AMOUNT_MISSING"] as typeof accepted.issueCodes,
        },
      ],
      metrics: { ...parsed.metrics, transactions: 3, accepted: 1, review: 1, rejected: 1 },
    };
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={withReviewRows} open onOpenChange={() => {}} onImport={() => {}} />);

    expect(screen.getByRole("group", { name: "Needs review filters" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Structure/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reconciliation/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Duplicates/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Manual changes/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Needs review 2" }));
    expect(screen.queryByDisplayValue("READY ROW")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("DATE REVIEW ROW")).toBeInTheDocument();
    expect(screen.getByDisplayValue("AMOUNT REVIEW ROW")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dates 1" }));
    expect(screen.getByDisplayValue("DATE REVIEW ROW")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("AMOUNT REVIEW ROW")).not.toBeInTheDocument();
  });

  it("preserves PDF zoom between detection and source review", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in PDF" }));
    expect(screen.getByRole("button", { name: "Zoom in PDF" })).toHaveAttribute("title", "Zoom in PDF (100%, or press +)");

    fireEvent.click(screen.getByRole("button", { name: /Review transactions/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show amount in statement for PDF row 1" }));
    expect(screen.getByRole("button", { name: "Zoom in PDF" })).toHaveAttribute("title", "Zoom in PDF (100%, or press +)");
  });

  it("opens the PDF page containing the selected field evidence", () => {
    const parsed = ordinaryResult();
    const firstPage = parsed.reconstructedPages[0];
    const prefix = (value: string) => `page-2-${value}`;
    const secondPage = {
      ...firstPage,
      pageNumber: 2,
      tokens: firstPage.tokens.map((token) => ({ ...token, id: prefix(token.id), pageNumber: 2 })),
      rows: firstPage.rows.map((row) => ({
        ...row,
        id: prefix(row.id),
        pageNumber: 2,
        cells: row.cells.map((cell) => ({
          ...cell,
          id: prefix(cell.id),
          pageNumber: 2,
          tokenIds: cell.tokenIds.map(prefix),
        })),
      })),
    };
    const amountToken = secondPage.tokens.find((token) => token.text.includes("-12.50"))!;
    const multipage = {
      ...parsed,
      document: {
        ...parsed.document,
        pages: [
          ...parsed.document.pages,
          { ...parsed.document.pages[0], pageNumber: 2 },
        ],
      },
      reconstructedPages: [...parsed.reconstructedPages, secondPage],
      transactions: parsed.transactions.map((transaction) => ({
        ...transaction,
        confidence: {
          ...transaction.confidence,
          accountAmount: {
            ...transaction.confidence.accountAmount,
            sourceIds: [amountToken.id],
          },
        },
      })),
    };
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={multipage} open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Show amount in statement for PDF row 1" }));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByLabelText("PDF page 2 viewer")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));
    const selector = screen.getByLabelText("Use layout") as HTMLSelectElement;
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

    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));
    fireEvent.change(screen.getByLabelText("Use layout"), { target: { value: "record-1" } });
    await waitFor(() => expect(screen.getByText(/statement only/i)).toBeInTheDocument());
    expect(onAssignProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use for HSBC card" }));
    expect(onAssignProfile).toHaveBeenCalledWith("record-1");

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("dialog", { name: "Manage statement layouts" })).toBeInTheDocument();
    expect(screen.getByText("HSBC card")).toBeInTheDocument();
  });

  it("uses one-click sign reversal and preserves the reviewed import boundary", () => {
    const onImport = jest.fn();
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={onImport} />);

    fireEvent.click(screen.getByRole("button", { name: "Change row 1 to money in" }));
    expect(screen.getByRole("button", { name: "Change row 1 to money out" })).toHaveTextContent("+");
    const useButton = screen.getByRole("button", { name: /Use 1 transaction/ });
    expect(useButton).toBeEnabled();
    fireEvent.click(useButton);
    expect(onImport).toHaveBeenCalledWith(
      [expect.objectContaining({ amount: "12.50", direction: "credit", directionEvidence: "manual" })],
      expect.objectContaining({ modelVersion: 2 })
    );
  });

  it("edits one row first and offers an explicit counted correction for similar rows", () => {
    const duplicate = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={duplicate} open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Change row 1 to money in" }));

    expect(screen.getByRole("button", { name: "Change row 1 to money out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change row 2 to money in" })).toBeInTheDocument();
    const similar = screen.getByRole("button", { name: "Apply to 1 similar" });
    expect(similar.closest('[data-slot="dialog-footer"]')).not.toBeNull();

    fireEvent.click(similar);
    expect(screen.getByRole("button", { name: "Change row 2 to money out" })).toBeInTheDocument();
  });

  it("re-parses a manually edited amount instead of retaining stale financial data", () => {
    const onImport = jest.fn();
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={onImport} />);

    const amount = screen.getByLabelText("Amount for PDF row 1");
    fireEvent.change(amount, { target: { value: "25.75" } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole("button", { name: /Use 1 transaction/ }));

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
    fireEvent.click(screen.getByRole("button", { name: /Use 1 transaction/ }));

    expect(onImport).toHaveBeenCalledWith(
      [expect.objectContaining({ amount: "-6000.00", issueCodes: expect.not.arrayContaining(["ROW_MANUALLY_CHANGED"]) })],
      expect.anything()
    );

    fireEvent.change(amount, { target: { value: "7,500.00" } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole("button", { name: /Use 1 transaction/ }));
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

    expect(screen.getByRole("button", { name: /Check detection/ })).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: /Review transactions/ }));
    expect(screen.getByRole("button", { name: /Use 1 transaction/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
    const date = screen.getByLabelText("Transaction date for PDF row 1");
    fireEvent.change(date, { target: { value: "2026-03-04" } });
    fireEvent.blur(date);
    expect(screen.getByRole("button", { name: /Use 1 transaction/ })).toBeEnabled();
  });

  it("lets the user correct a row currency and preserves it with the exact amount", () => {
    const onImport = jest.fn();
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={onImport} />);

    const currency = screen.getByLabelText("Currency for PDF row 1");
    fireEvent.change(currency, { target: { value: "EUR" } });
    fireEvent.blur(currency);
    fireEvent.click(screen.getByRole("button", { name: /Use 1 transaction/ }));

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
    expect(screen.getByRole("button", { name: /Use 0 transactions/ })).toBeDisabled();
  });

  it("opens source evidence for a field and highlights the supporting PDF item", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Show amount in statement for PDF row 1" }));

    expect(screen.getByRole("heading", { name: "Source" })).toBeInTheDocument();
    const sourceHeader = screen.getByRole("heading", { name: "Source" }).parentElement!;
    expect(sourceHeader).toHaveClass("whitespace-nowrap");
    expect(within(sourceHeader).getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.queryByText("Page 1", { exact: true })).not.toBeInTheDocument();
    // Paging comes first, and text coverage is a detection concern that does
    // not belong beside the evidence for one field.
    const paging = within(sourceHeader).getByText("Page 1 of 1");
    const heading = screen.getByRole("heading", { name: "Source" });
    expect(paging.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(sourceHeader).queryByText(/% text coverage/)).toBeNull();
    const source = screen.getAllByText("-12.50").find((element) => element.className.includes("bg-sky-300"));
    expect(source).toBeDefined();
    expect(source!.className).toContain("bg-sky-300");
  });

  it("provides visual region and column mapping with source examples", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

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
    expect(screen.getByText("Transaction date", { selector: "span" })).toHaveClass("text-white");
    const firstSwatch = screen.getByLabelText("Role for mapped column 1").previousElementSibling as HTMLElement;
    const secondSwatch = screen.getByLabelText("Role for mapped column 2").previousElementSibling as HTMLElement;
    expect(firstSwatch.style.backgroundColor).toBeTruthy();
    expect(firstSwatch.style.backgroundColor).not.toBe(secondSwatch.style.backgroundColor);
    const previousEnd = screen.getAllByRole("button", { name: /column end boundary/ }).at(-1)!.parentElement!;
    const previousRight = Number.parseFloat(previousEnd.style.left) + Number.parseFloat(previousEnd.style.width);
    fireEvent.click(screen.getByRole("button", { name: "Map another column" }));
    const addedColumn = screen.getByRole("button", { name: "Move ignore column start boundary" }).parentElement!;
    expect(Number.parseFloat(addedColumn.style.left)).toBeGreaterThan(previousRight);
    expect(screen.getByRole("region", { name: "Transaction areas" })).toBeInTheDocument();
    expect(screen.getByText("Transaction areas")).toBeInTheDocument();
    const floatingSectionControl = screen.getByRole("button", { name: "Ignore transaction area 1 in PDF" });
    const sectionOverviewControl = screen.getByRole("button", { name: "Ignore transaction area 1 from transaction areas" });
    expect(floatingSectionControl).toHaveTextContent("Area 1 · Included");
    expect(floatingSectionControl).toHaveClass("bg-emerald-600");
    expect(sectionOverviewControl).toHaveClass("bg-emerald-500/10");
    const previewChanges = screen.getByRole("button", { name: "Preview updated transactions" });
    expect(previewChanges.closest(".border-t")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply changes and review" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Select transaction area" })).toBeInTheDocument();
    expect(screen.queryByText("Page 1")).not.toBeInTheDocument();
    const viewerControls = screen.getByRole("group", { name: "PDF viewer controls" });
    const coverage = within(viewerControls).getByText(/% text coverage/);
    expect(coverage).toHaveClass("ml-auto");
    const mappingToggle = within(viewerControls).getByRole("button", { name: "Hide column mappings" });
    expect(within(viewerControls).getByText("Page 1 of 1")).toBeInTheDocument();
    expect(mappingToggle.compareDocumentPosition(coverage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const interpretation = screen.getByText("Statement interpretation");
    expect(interpretation.compareDocumentPosition(previewChanges) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Change preview")).not.toBeInTheDocument();
    expect(interpretation.closest(".overflow-auto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide column mappings" }));
    expect(screen.queryByRole("button", { name: /Move transaction-date column start boundary/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ignore transaction area 1 in PDF" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show column mappings" }));
    expect(screen.getByRole("button", { name: /Move transaction-date column start boundary/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ignore transaction area 1 in PDF" }));
    expect(screen.getByRole("button", { name: "Include transaction area 1 in PDF" })).toHaveClass("bg-amber-400");
    expect(screen.getByRole("button", { name: "Include transaction area 1 from transaction areas" })).toHaveClass("bg-amber-500/15");
    fireEvent.click(screen.getByRole("button", { name: "Include transaction area 1 from transaction areas" }));
    expect(screen.getByRole("button", { name: "Ignore transaction area 1 in PDF" })).toHaveClass("bg-emerald-600");

    // The header row prints above the transactions, so it is the first row and
    // belongs to no transaction.
    const nonTransactionSourceRow = screen.getByRole("button", { name: "Select statement row 1" });
    expect(nonTransactionSourceRow).toHaveAttribute("title", expect.stringContaining("Transaction Date"));
    fireEvent.click(nonTransactionSourceRow);
    expect(screen.getByRole("button", { name: "Mark selected row as transaction" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Role for mapped column 1"), { target: { value: "amount" } });
    expect(within(dateMapping).getByText("Examples: No matching value read yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview updated transactions" }));
    const comparison = screen.getByRole("region", { name: "Detection change preview" });
    // Each measurement reads now → after, with the change called out, and the
    // row-level edits are summarized underneath.
    expect(within(comparison).getByText("If you apply these changes")).toBeInTheDocument();
    expect(within(comparison).getByText("Transactions")).toBeInTheDocument();
    expect(within(comparison).getByText("Ready to import")).toBeInTheDocument();
    expect(within(comparison).getByText("Net change")).toBeInTheDocument();
    expect(within(comparison).getByText(/Row changes:|No row would change\./)).toBeInTheDocument();
    const applyDetection = screen.getByRole("button", { name: "Apply changes and review" });
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
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

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
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

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

    // The header states which date is imported instead of relying on an icon.
    expect(screen.getByRole("columnheader", { name: /Value date \(used as the import date\)/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Value date for PDF row 1")).toHaveValue("2026-08-15");
  });

  const descriptionsOf = () => screen.getAllByRole("textbox", { name: /Description for PDF row/ })
    .map((input) => (input as HTMLInputElement).value);

  it("exports the transactions as they are currently shown", async () => {
    const createObjectURL = jest.fn().mockReturnValue("blob:statement");
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicks: string[] = [];
    const anchorClick = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.download); });

    const parsed = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON BRAVO" }, { x: 480, text: "USD -30.00" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "ANON ALPHA" }, { x: 480, text: "USD -10.00" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="march-statement.pdf" result={parsed} open onOpenChange={() => {}} onImport={() => {}} />);

    // Sorting and searching change what is shown, and the export follows.
    fireEvent.change(screen.getByLabelText("Search parsed transactions"), { target: { value: "ALPHA" } });
    expect(descriptionsOf()).toEqual(["ANON ALPHA"]);

    // The search clears from its own control, as it does on the rules screen.
    fireEvent.click(screen.getByRole("button", { name: "Clear the transaction search" }));
    expect(descriptionsOf()).toEqual(["ANON BRAVO", "ANON ALPHA"]);
    fireEvent.change(screen.getByLabelText("Search parsed transactions"), { target: { value: "ALPHA" } });
    fireEvent.click(screen.getByRole("button", { name: /Export/ }));

    // The export control stays beside the search box, not inside the filter
    // strip that scrolls when a statement has many issue filters.
    const toolbarSearch = screen.getByLabelText("Search parsed transactions");
    const exportButton = screen.getByRole("button", { name: /Export/ });
    expect(toolbarSearch.closest("div")).toBe(exportButton.closest("div"));
    expect(screen.getByRole("group", { name: "Review filters" }).contains(exportButton)).toBe(false);

    expect(clicks).toEqual(["march-statement.csv"]);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toContain("text/csv");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:statement");

    const csv = await readBlobText(blob);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("Transaction date");
    expect(lines[0]).toContain("Amount");
    // Only the row the search left on screen, with its reviewed values.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("ANON ALPHA");
    expect(lines[1]).toContain("-10.00");
    expect(csv).not.toContain("ANON BRAVO");
    anchorClick.mockRestore();
  });

  it("sorts the review table by a column and back to statement order", () => {
    const parsed = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON BRAVO" }, { x: 480, text: "USD -30.00" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "ANON ALPHA" }, { x: 480, text: "USD -10.00" }] },
      { y: 660, cells: [{ x: 20, text: "08/17/2026" }, { x: 120, text: "ANON CHARLIE" }, { x: 480, text: "USD -20.00" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={parsed} open onOpenChange={() => {}} onImport={() => {}} />);

    const descriptions = () => screen.getAllByRole("textbox", { name: /Description for PDF row/ })
      .map((input) => (input as HTMLInputElement).value);
    expect(descriptions()).toEqual(["ANON BRAVO", "ANON ALPHA", "ANON CHARLIE"]);

    const header = screen.getByRole("button", { name: /Description/ });
    fireEvent.click(header);
    expect(descriptions()).toEqual(["ANON ALPHA", "ANON BRAVO", "ANON CHARLIE"]);
    expect(screen.getByRole("columnheader", { name: /Description/ })).toHaveAttribute("aria-sort", "ascending");

    fireEvent.click(header);
    expect(descriptions()).toEqual(["ANON CHARLIE", "ANON BRAVO", "ANON ALPHA"]);
    expect(screen.getByRole("columnheader", { name: /Description/ })).toHaveAttribute("aria-sort", "descending");

    // A third selection returns to the order the statement itself prints.
    fireEvent.click(header);
    expect(descriptions()).toEqual(["ANON BRAVO", "ANON ALPHA", "ANON CHARLIE"]);
    expect(screen.getByRole("columnheader", { name: /Description/ })).toHaveAttribute("aria-sort", "none");
  });

  it("offers a restore action after a row is ignored", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Ignore PDF row 1" }));
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restore ignored row 1" }));
    fireEvent.click(screen.getByRole("button", { name: /Review transactions/ }));
    expect(screen.getByLabelText("Description for PDF row 1")).toHaveValue("ANON SHOP");
  });

  it("keeps possible duplicates blocked until the user explicitly accepts them", () => {
    const duplicate = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={duplicate} open onOpenChange={() => {}} onImport={() => {}} />);

    expect(screen.getByRole("button", { name: /Use 2 transactions/ })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Mark reviewed" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    expect(screen.getByRole("button", { name: /Use 2 transactions/ })).toBeEnabled();
  });


  it("asks whether to replace a layout whose name is taken", async () => {
    const parsed = ordinaryResult();
    const layout = createPdfLayoutProfile({ id: "layout-1", name: "Credit card", result: parsed });
    const option: PdfDetectionProfileOption = {
      recordId: "record-1",
      bankId: "bank-1",
      bankName: "HSBC Bank",
      envelope: { kind: "pdf-layout-v2", profile: layout },
    };
    const onSaveProfile = jest.fn().mockResolvedValue({ bankId: "bank-1", profileId: "record-1" });
    render(
      <PdfStatementReviewDialog
        fileName="statement.pdf"
        result={parsed}
        profiles={[option]}
        accountName="HSBC card"
        open
        onOpenChange={() => {}}
        onImport={() => {}}
        onSaveProfile={onSaveProfile}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    fireEvent.change(screen.getByLabelText("Bank"), { target: { value: "HSBC Bank" } });
    fireEvent.change(screen.getByLabelText("Layout name"), { target: { value: "Credit card" } });

    // The name is taken, so saving is a choice rather than a silent overwrite.
    expect(screen.getByText("HSBC Bank already has this layout")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Keep it and save a new layout/));
    expect(screen.getByRole("button", { name: "Save layout" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Update Credit card/));
    fireEvent.click(screen.getByRole("button", { name: "Update layout" }));

    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledWith(expect.objectContaining({
      bankName: "HSBC Bank",
      profileName: "Credit card",
      mode: "update",
    })));
    expect(toastSuccess).toHaveBeenCalledWith("Statement layout updated", expect.anything());
  });

  it("offers the setting that resolves an unresolved direction", async () => {
    // One amount column, no signs and no markers: every row is blocked on the
    // same question.
    const parsed = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "ANON CAFE" }, { x: 480, text: "4.00" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={parsed} open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));
    const attention = screen.getByRole("region", { name: "What needs attention" });
    expect(within(attention).getByText(/do not say whether they are money in or money out/)).toBeInTheDocument();

    fireEvent.click(within(attention).getAllByRole("button", { name: "Fix this" })[0]);
    await waitFor(() => expect(screen.getByLabelText("Amount direction")).toHaveFocus());
  });

  it("keeps the statement layout controls with the detection settings", () => {
    const parsed = ordinaryResult();
    render(
      <PdfStatementReviewDialog
        fileName="statement.pdf"
        result={parsed}
        open
        onOpenChange={() => {}}
        onImport={() => {}}
        onSaveProfile={jest.fn()}
      />
    );

    // Nothing layout-related sits in the workbench toolbar.
    expect(screen.queryByLabelText("Use layout")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));
    const layoutSection = screen.getByRole("region", { name: "Statement layout" });
    expect(within(layoutSection).getByLabelText("Use layout")).toBeInTheDocument();
    expect(within(layoutSection).getByRole("button", { name: "Save layout" })).toBeInTheDocument();
  });

  it("blocks import until unreadable pages are acknowledged", () => {
    const parsed = ordinaryResult();
    parsed.metrics = { ...parsed.metrics, unreadablePages: 1 };
    parsed.warnings = [...parsed.warnings, "1 PDF page could not be read. Review the remaining pages before importing."];
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={parsed} open onOpenChange={() => {}} onImport={() => {}} />);

    expect(screen.getByRole("alert")).toHaveTextContent("could not be read");
    expect(screen.getByRole("button", { name: /Use 1 transaction/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "I checked these pages" }));

    // Acknowledging dismisses the banner and leaves a way back to it.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /Use 1 transaction/ })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /1 page unreadable/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("could not be read");
  });

  it("selects the source row behind a transaction instead of the transaction id", () => {
    const parsed = ordinaryResult();
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={parsed} open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Show amount in statement for PDF row 1" }));
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

    // The selection is a real reconstructed row that already belongs to a
    // transaction, so marking it again is not offered.
    expect(screen.queryByRole("button", { name: /Mark selected row as transaction/ })).toBeNull();
  });

  it("offers the printed-sign convention next to the amount-direction rule", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

    const printedSign = screen.getByLabelText("Printed sign means");
    expect(printedSign).toHaveValue("auto");
    fireEvent.change(printedSign, { target: { value: "issuer" } });
    expect(screen.getByLabelText("Printed sign means")).toHaveValue("issuer");
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

    // Accepting warnings that are still unresolved is confirmed first, and the
    // confirmation names them.
    const confirmation = screen.getByRole("dialog", { name: /Mark 2 transactions reviewed/ });
    expect(within(confirmation).getByText(/Possible duplicate/)).toBeInTheDocument();
    // The confirmation renders inside a paragraph, so it must not introduce
    // block elements that cannot legally nest there.
    expect(document.querySelector("[data-slot='dialog-description'] ul, [data-slot='dialog-description'] div"))
      .toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed anyway" }));

    expect(screen.getByRole("button", { name: /Use 2 transactions/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
  });

  it("keeps row selection usable for a large parsed statement", () => {
    const parsed = ordinaryResult();
    const template = parsed.transactions[0];
    const transactions = Array.from({ length: 220 }, (_, index) => ({
      ...template,
      id: `transaction-${index + 1}`,
      sourceRowNumber: index + 1,
      description: `ANON ROW ${index + 1}`,
    }));
    const largeResult = {
      ...parsed,
      transactions,
      metrics: { ...parsed.metrics, transactions: transactions.length, accepted: transactions.length },
    };
    render(<PdfStatementReviewDialog fileName="large-statement.pdf" result={largeResult} open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select PDF row 220" }));

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select PDF row 220" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select PDF row 1" })).not.toBeChecked();
  });

  it("shows diagnostics without exposing source text", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Parser details/ }));
    // The details open beside the workbench rather than replacing it.
    expect(screen.getByRole("table", { name: /Transactions extracted/ })).toBeInTheDocument();

    const diagnostics = screen.getByRole("region", { name: "Technical diagnostics" });
    fireEvent.click(within(diagnostics).getByRole("button", { name: "Technical diagnostics" }));
    expect(
      within(diagnostics).getByText(/Statement text and source IDs are not copied/),
    ).toBeInTheDocument();
    expect(within(diagnostics).queryByText(/ANON SHOP/)).toBeNull();
  });

  it("saves a privacy-safe bank profile without deriving names from the uploaded filename", async () => {
    const onSaveProfile = jest.fn().mockResolvedValue(undefined);
    render(<PdfStatementReviewDialog fileName="private-source-name.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} onSaveProfile={onSaveProfile} />);
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    fireEvent.change(screen.getByPlaceholderText("For example, HSBC Bank"), { target: { value: "HSBC Bank" } });
    fireEvent.change(screen.getByPlaceholderText("For example, Credit card"), { target: { value: "Credit card" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Save statement layout" })).getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledWith(expect.objectContaining({
      bankName: "HSBC Bank",
      profileName: "Credit card",
      assignToAccount: true,
      result: expect.objectContaining({ modelVersion: 2 }),
    })));
    expect(JSON.stringify(onSaveProfile.mock.calls)).not.toContain("private-source-name");
  });

  it("collects several ignored rows into one restore control", () => {
    const duplicate = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "FIRST" }, { x: 480, text: "USD -12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "SECOND" }, { x: 480, text: "USD -8.00" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={duplicate} open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible PDF rows" }));
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

    // Two identical buttons say nothing a count does not.
    expect(screen.queryByRole("button", { name: "Restore ignored row 1" })).toBeNull();
    expect(screen.getByRole("button", { name: /Restore ignored rows \(2\)/ })).toBeInTheDocument();
  });

  it("drops a selection that a correction has re-assembled", () => {
    const duplicate = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "FIRST" }, { x: 480, text: "USD -12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "SECOND" }, { x: 480, text: "USD -8.00" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={duplicate} open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible PDF rows" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    // One of the selected rows is now gone, so a count including it would be
    // a count of rows that no longer exist.
    fireEvent.click(screen.getByRole("button", { name: "Ignore PDF row 1" }));
    expect(screen.queryByText(/selected/)).toBeNull();
    expect(screen.getByRole("button", { name: /Use 1 transaction/ })).toBeInTheDocument();
  });

  it("says what a row is waiting on in the table, not only in a tooltip", () => {
    const parsed = ordinaryResult();
    const row = parsed.transactions[0];
    const needsReview = {
      ...parsed,
      transactions: [{ ...row, status: "review" as const, issueCodes: ["BALANCE_MISMATCH"] as typeof row.issueCodes }],
      metrics: { ...parsed.metrics, accepted: 0, review: 1 },
    };
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={needsReview} open onOpenChange={() => {}} onImport={() => {}} />);

    expect(screen.getByText("Amount does not reconcile to the running balance")).toBeInTheDocument();
    // The status keeps the full list for anyone who wants all of it.
    expect(screen.getByLabelText("Amount does not reconcile to the running balance")).toHaveTextContent("Review");
  });

  it("offers a way back when a filter leaves nothing on screen", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.change(screen.getByLabelText("Search parsed transactions"), { target: { value: "NOTHING MATCHES" } });
    expect(screen.getByText("No transactions match this view.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all transactions" }));
    expect(screen.getByLabelText("Description for PDF row 1")).toHaveValue("ANON SHOP");
  });

  it("marks a partial selection as partial rather than as selected", () => {
    const duplicate = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "FIRST" }, { x: 480, text: "USD -12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "SECOND" }, { x: 480, text: "USD -8.00" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={duplicate} open onOpenChange={() => {}} onImport={() => {}} />);

    const selectAll = screen.getByRole("checkbox", { name: "Select all visible PDF rows" });
    expect(selectAll).not.toHaveAttribute("data-indeterminate");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select PDF row 1" }));
    expect(screen.getByRole("checkbox", { name: "Select all visible PDF rows" })).toHaveAttribute("data-indeterminate");
  });

  it("offers a page number to jump to once a statement runs long", () => {
    const parsed = ordinaryResult();
    const firstPage = parsed.reconstructedPages[0];
    const manyPages = {
      ...parsed,
      reconstructedPages: Array.from({ length: 8 }, (_, index) => ({
        ...firstPage,
        pageNumber: index + 1,
        tokens: firstPage.tokens.map((token) => ({ ...token, id: `p${index + 1}-${token.id}`, pageNumber: index + 1 })),
        rows: firstPage.rows.map((row) => ({ ...row, id: `p${index + 1}-${row.id}`, pageNumber: index + 1 })),
      })),
    };
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={manyPages} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

    const pageInput = screen.getByLabelText("Go to PDF page");
    fireEvent.change(pageInput, { target: { value: "6" } });
    expect(screen.getByLabelText("PDF page 6 viewer")).toBeInTheDocument();

    // Out-of-range entries are ignored rather than paging to nowhere.
    fireEvent.change(pageInput, { target: { value: "99" } });
    expect(screen.getByLabelText("PDF page 6 viewer")).toBeInTheDocument();
  });

  it("explains an image-only PDF without offering import", async () => {
    render(<PdfStatementReviewDialog fileName="scan.pdf" result={parsePdfStatementPages([{ pageNumber: 1, width: 700, height: 800, items: [] }])} open onOpenChange={() => {}} onImport={() => {}} />);
    await waitFor(() => expect(screen.getByText(/does not have a usable text layer/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Use/ })).toBeNull();
  });
});
