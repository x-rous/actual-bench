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
    // Readiness is a composition drawn the way the reconcile stage draws
    // coverage: a track whose parts sum to the total, each named beside its
    // colour rather than carried by the colour alone.
    const readiness = within(summary).getByRole("img", { name: "1 ready" });
    expect(readiness).toBeInTheDocument();
    const ready = within(summary).getByText("Ready").parentElement!;
    expect(within(ready).getByText("1")).toBeInTheDocument();
    expect(within(summary).queryByText("Review")).toBeNull();
    const reviewStep = screen.getByRole("button", { name: /Review transactions/ });
    expect(reviewStep.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Needs review 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ready 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Manual changes/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Correction scope")).not.toBeInTheDocument();
  });

  it("shows readiness as a composition, in the colours the reconcile stage uses", () => {
    const parsed = ordinaryResult();
    const accepted = parsed.transactions[0];
    const mixed = {
      ...parsed,
      transactions: [
        { ...accepted, id: "ready", description: "READY", sourceRowNumber: 1 },
        { ...accepted, id: "review", description: "REVIEW", sourceRowNumber: 2, status: "review" as const, issueCodes: ["DATE_AMBIGUOUS_ORDER"] as typeof accepted.issueCodes },
        { ...accepted, id: "fix", description: "FIX", sourceRowNumber: 3, status: "rejected" as const, issueCodes: ["AMOUNT_MISSING"] as typeof accepted.issueCodes },
      ],
      metrics: { ...parsed.metrics, transactions: 3, accepted: 1, review: 1, rejected: 1 },
    };
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={mixed} open onOpenChange={() => {}} onImport={() => {}} />);

    const summary = screen.getByRole("region", { name: "PDF parse summary" });
    // The whole statement in one reading, not only the worst thing in it.
    expect(within(summary).getByRole("img", { name: "1 ready, 1 review, 1 fix" })).toBeInTheDocument();
    ["Ready", "Review", "Fix"].forEach((label) => {
      expect(within(summary).getByText(label)).toBeInTheDocument();
    });

    // A period is read rather than typed, so the month is named.
    expect(within(summary).getByText("15 Aug 2026")).toBeInTheDocument();
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
      bankName: "HSBC Bank",
      envelope: { kind: "pdf-layout-v3", profile: layout },
    };
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={parsed} profiles={[option]} activeProfileId="record-1" open onOpenChange={() => {}} onImport={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));
    // A layout was already in force when the PDF was read, so the panel starts
    // out of the way.
    expect(screen.queryByLabelText("Use layout")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Statement layout/ }));
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
      bankName: "HSBC Bank",
      envelope: { kind: "pdf-layout-v3", profile: layout },
    };
    const onAssignProfile = jest.fn().mockResolvedValue(undefined);
    const noop = jest.fn().mockResolvedValue(undefined);
    render(
      <PdfStatementReviewDialog
        fileName="statement.pdf"
        result={parsed}
        profiles={[option]}
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
    expect(screen.queryByRole("button", { name: /Mark PDF row \d+ reviewed/ })).toBeNull();
    const date = screen.getByLabelText("Transaction date for PDF row 1");
    fireEvent.change(date, { target: { value: "04/03/2026" } });
    fireEvent.blur(date);
    expect(screen.getByRole("button", { name: /Use 1 transaction/ })).toBeEnabled();
  });

  it("states the statement currency over the amounts rather than on every row", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);

    // Actual holds one currency per budget file and the import carries no
    // currency at all, so a per-row field would be an edit with no consequence.
    expect(screen.queryByLabelText("Currency for PDF row 1")).toBeNull();
    expect(screen.getByRole("columnheader", { name: /Amount \(USD\)/ })).toBeInTheDocument();
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
    // The label on the page is also the handle that moves the whole column.
    const pageLabel = screen.getByRole("button", { name: "Move the transaction-date column" });
    expect(pageLabel).toHaveTextContent("Transaction date");
    expect(pageLabel).toHaveClass("text-white", "cursor-grab");
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
    // Previewing is an offer, not a gate: nothing is written by applying.
    expect(screen.getByRole("button", { name: "Apply changes and review" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Select transaction area" })).toBeInTheDocument();
    expect(screen.queryByText("Page 1")).not.toBeInTheDocument();
    // Paging and page-level actions above the viewer; zoom and the mapping
    // toggle on the page itself.
    const pageControls = screen.getByRole("group", { name: "PDF page controls" });
    const coverage = within(pageControls).getByText(/% text coverage/);
    expect(coverage).toHaveClass("ml-auto");
    expect(within(pageControls).getByText("Page 1 of 1")).toBeInTheDocument();
    const viewerControls = screen.getByRole("group", { name: "PDF viewer controls" });
    expect(viewerControls).toContainElement(screen.getByRole("button", { name: "Hide column mappings" }));
    expect(viewerControls).toContainElement(screen.getByRole("button", { name: "Zoom in PDF" }));
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
    // A measurement per column and a state per row, so the change sits under
    // the two figures it came from.
    expect(within(comparison).getByText("If you apply these changes")).toBeInTheDocument();
    ["Transactions", "Ready", "In", "Out", "Net"].forEach((measurement) => {
      expect(within(comparison).getByRole("columnheader", { name: measurement })).toBeInTheDocument();
    });
    ["Now", "After", "Change"].forEach((state) => {
      expect(within(comparison).getByRole("rowheader", { name: state })).toBeInTheDocument();
    });
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

  it("moves a column down the list and right across the page, together", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

    const originalDateArea = screen.getByRole("button", { name: "Move transaction-date column start boundary" }).parentElement!;
    const originalDescriptionArea = screen.getByRole("button", { name: "Move description column start boundary" }).parentElement!;
    const originalDateWidth = Number.parseFloat(originalDateArea.style.width);
    expect(Number.parseFloat(originalDateArea.style.left)).toBeLessThan(Number.parseFloat(originalDescriptionArea.style.left));

    // The list runs down, the page runs across, and the two stay in step.
    fireEvent.click(screen.getByRole("button", { name: "Move transaction-date column down" }));

    expect(screen.getByLabelText("Role for mapped column 1")).toHaveValue("description");
    expect(screen.getByLabelText("Role for mapped column 2")).toHaveValue("transaction-date");
    const movedDateArea = screen.getByRole("button", { name: "Move transaction-date column start boundary" }).parentElement!;
    const movedDescriptionArea = screen.getByRole("button", { name: "Move description column start boundary" }).parentElement!;
    expect(Number.parseFloat(movedDateArea.style.left)).toBeGreaterThan(Number.parseFloat(movedDescriptionArea.style.left));
    expect(Number.parseFloat(movedDateArea.style.width)).toBeCloseTo(originalDateWidth);
  });

  it("inserts a mapping between two columns and keeps the list in page order", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

    const rolesInOrder = () => screen.getAllByRole("combobox", { name: /Role for mapped column/ })
      .map((select) => (select as HTMLSelectElement).value);
    expect(rolesInOrder()).toEqual(["transaction-date", "description", "amount"]);

    // A column the detection missed belongs where the statement prints it,
    // not at the end of the list.
    fireEvent.click(screen.getByRole("button", { name: "Add a column after transaction-date" }));
    expect(rolesInOrder()).toEqual(["transaction-date", "ignore", "description", "amount"]);

    const inserted = screen.getByRole("button", { name: "Move the ignore column" }).parentElement!;
    const date = screen.getByRole("button", { name: "Move the transaction-date column" }).parentElement!;
    const description = screen.getByRole("button", { name: "Move the description column" }).parentElement!;
    expect(Number.parseFloat(inserted.style.left)).toBeGreaterThan(Number.parseFloat(date.style.left));
    expect(Number.parseFloat(inserted.style.left)).toBeLessThan(Number.parseFloat(description.style.left));
  });

  it("moves a whole column with its label, and reorders the list once it lands", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

    const handle = screen.getByRole("button", { name: "Move the transaction-date column" });
    // Read before the move: React keeps the same element, so the old values
    // have to be captured rather than re-read afterwards.
    const width = Number.parseFloat(handle.parentElement!.style.width);
    const left = Number.parseFloat(handle.parentElement!.style.left);

    // Both edges travel together, so the column keeps its width.
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    const moved = screen.getByRole("button", { name: "Move the transaction-date column" }).parentElement!;
    expect(Number.parseFloat(moved.style.width)).toBeCloseTo(width);
    expect(Number.parseFloat(moved.style.left)).toBeGreaterThan(left);
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
    // Dates are written one way across the workbench, whatever the statement
    // prints and whatever locale the browser would prefer.
    expect(screen.getByLabelText("Value date for PDF row 1")).toHaveValue("15/08/2026");
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
    fireEvent.click(screen.getAllByRole("button", { name: /Mark PDF row \d+ reviewed/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Mark PDF row \d+ reviewed/ }));
    expect(screen.getByRole("button", { name: /Use 2 transactions/ })).toBeEnabled();
  });


  it("asks whether to replace a layout whose name is taken", async () => {
    const parsed = ordinaryResult();
    const layout = createPdfLayoutProfile({ id: "layout-1", name: "Credit card", result: parsed });
    const option: PdfDetectionProfileOption = {
      recordId: "record-1",
      bankName: "HSBC Bank",
      envelope: { kind: "pdf-layout-v3", profile: layout },
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

  it("asks to save a layout only when the layout itself would change", () => {
    const parsed = ordinaryResult();
    const layout = createPdfLayoutProfile({ id: "layout-1", name: "Credit card", result: parsed });
    const option: PdfDetectionProfileOption = {
      recordId: "record-1",
      bankName: "HSBC Bank",
      envelope: { kind: "pdf-layout-v3", profile: layout },
    };
    render(
      <PdfStatementReviewDialog
        fileName="statement.pdf"
        result={parsed}
        profiles={[option]}
        activeProfileId="record-1"
        open
        onOpenChange={() => {}}
        onImport={() => {}}
        onSaveProfile={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

    // A transaction area belongs to this statement. A layout holds no areas,
    // so saving after changing one would store the same layout again.
    fireEvent.click(screen.getByRole("button", { name: "Ignore transaction area 1 in PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply changes and review" }));

    expect(toastSuccess).toHaveBeenCalledWith(
      "Detection changes applied",
      expect.not.objectContaining({ action: expect.anything() })
    );
    expect(screen.queryByRole("button", { name: /Layout not saved/ })).toBeNull();

    // A column role is part of the layout, so changing one is worth keeping.
    toastSuccess.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));
    fireEvent.change(screen.getByLabelText("Role for mapped column 1"), { target: { value: "reference" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes and review" }));

    expect(toastSuccess).toHaveBeenCalledWith(
      "Detection changes applied",
      expect.objectContaining({ action: expect.objectContaining({ label: "Save layout" }) })
    );
    // The toast dismisses itself, so the state stays in the header, where it
    // is visible from either step and opens the save dialog.
    const chip = screen.getByRole("button", { name: /Layout not saved/ });
    expect(chip).toHaveAttribute("title", expect.stringContaining("Credit card"));
    fireEvent.click(chip);
    expect(screen.getByRole("dialog", { name: "Save statement layout" })).toBeInTheDocument();
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

  it("states a layout notice once, with the layout control it is about", () => {
    const notice = "General Bank · Sample Statement 3 was not applied because this statement does not match it closely enough.";
    render(
      <PdfStatementReviewDialog
        fileName="statement.pdf"
        result={ordinaryResult()}
        profileNotice={notice}
        open
        onOpenChange={() => {}}
        onImport={() => {}}
      />
    );

    // Not in the attention list as well: the control that answers it is in the
    // layout panel, which says it.
    expect(screen.getAllByText(notice)).toHaveLength(1);
    const layoutSection = screen.getByRole("region", { name: "Statement layout" });
    expect(within(layoutSection).getByText(notice)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "What needs attention" })).toBeNull();
  });

  it("says why a layout cannot be saved instead of hiding it in a tooltip", () => {
    const blocked = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "03/04/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
    ], { dateFormat: "auto" });
    render(
      <PdfStatementReviewDialog
        fileName="statement.pdf"
        result={blocked}
        open
        onOpenChange={() => {}}
        onImport={() => {}}
        onSaveProfile={jest.fn()}
      />
    );

    const layoutSection = screen.getByRole("region", { name: "Statement layout" });
    expect(within(layoutSection).getByRole("button", { name: "Save layout" })).toBeDisabled();
    expect(within(layoutSection).getByText("Resolve rejected transactions before saving this layout"))
      .toBeInTheDocument();
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

  it("keeps the statement period out of the settings a layout saves", async () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

    // It is a fact about this document, not a property of the bank's layout,
    // and that is said where someone deciding what to save will read it -
    // behind the setting's own hint rather than as a paragraph under it.
    const hint = screen.getByRole("button", { name: "More about statement period" });
    fireEvent.focus(hint);
    await waitFor(() => expect(screen.getByText(/not kept in a saved layout/i)).toBeInTheDocument());

    const start = screen.getByLabelText("Statement period start");
    fireEvent.change(start, { target: { value: "21/09/2026" } });
    fireEvent.blur(start);
    expect(screen.getByLabelText("Statement period start")).toHaveValue("21/09/2026");
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
    expect(screen.queryByRole("button", { name: /Mark PDF row \d+ reviewed/ })).toBeNull();
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

  it("moves down a column on Enter and marks a row reviewed with the modifier", () => {
    // Two rows the parser cannot tell apart: both stay in review until someone
    // says they are separate transactions.
    const duplicate = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={duplicate} open onOpenChange={() => {}} onImport={() => {}} />);

    const first = screen.getByLabelText("Description for PDF row 1");
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    expect(screen.getByLabelText("Description for PDF row 2")).toHaveFocus();

    // The modifier accepts the row before moving on, so a run of rows can be
    // cleared without returning to the mouse.
    expect(screen.getAllByRole("button", { name: /Mark PDF row \d+ reviewed/ })).toHaveLength(2);
    fireEvent.keyDown(screen.getByLabelText("Description for PDF row 2"), { key: "Enter", ctrlKey: true });
    expect(screen.getAllByRole("button", { name: /Mark PDF row \d+ reviewed/ })).toHaveLength(1);
  });

  it("asks before throwing away the detection settings", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Check detection/ }));

    // Nothing has changed yet, so there is nothing to ask about.
    fireEvent.click(screen.getByRole("button", { name: "Reset detection" }));
    expect(screen.queryByRole("dialog", { name: /Reset the detection settings/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Role for mapped column 1"), { target: { value: "amount" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset detection" }));
    expect(screen.getByRole("dialog", { name: /Reset the detection settings/ })).toBeInTheDocument();

    const confirmation = screen.getByRole("dialog", { name: /Reset the detection settings/ });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Reset detection" }));
    expect(screen.getByLabelText("Role for mapped column 1")).toHaveValue("transaction-date");
  });

  it("says what a row is waiting on in the table, and keeps the rest behind its status", async () => {
    const parsed = ordinaryResult();
    const row = parsed.transactions[0];
    const needsReview = {
      ...parsed,
      transactions: [{
        ...row,
        status: "review" as const,
        issueCodes: ["DATE_INHERITED_FROM_PREVIOUS_ROW", "BALANCE_MISMATCH", "BALANCE_RECONCILED"] as typeof row.issueCodes,
        confidence: {
          ...row.confidence,
          transactionDate: { ...row.confidence.transactionDate, status: "review" as const, reasons: ["DATE_INHERITED_FROM_PREVIOUS_ROW"] as typeof row.issueCodes },
          accountAmount: { ...row.confidence.accountAmount, status: "rejected" as const, reasons: ["BALANCE_MISMATCH"] as typeof row.issueCodes },
          direction: { ...row.confidence.direction, status: "accepted" as const, reasons: ["BALANCE_RECONCILED"] as typeof row.issueCodes },
        },
      }],
      metrics: { ...parsed.metrics, accepted: 0, review: 1 },
    };
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={needsReview} open onOpenChange={() => {}} onImport={() => {}} />);

    // The line goes to the reason that blocks the row, not the first one read,
    // and it stays on screen so a column of them can be scanned.
    expect(screen.getByText("Amount does not reconcile to the running balance")).toBeInTheDocument();
    expect(screen.queryByText("Date was inherited from the previous statement row")).toBeNull();

    // The description cell carries no controls: the notes live on the status,
    // which is in the same place on every row.
    const status = screen.getByRole("button", { name: /Review: show the notes on PDF row 1/ });
    expect(status).toHaveAttribute("aria-haspopup");
    expect(screen.queryByText("Needs attention")).toBeNull();

    fireEvent.click(status);
    await waitFor(() => expect(screen.getByText("Needs attention")).toBeInTheDocument());
    expect(screen.getByText("Date was inherited from the previous statement row")).toBeInTheDocument();
    expect(screen.getByText("How this was read")).toBeInTheDocument();
    expect(screen.getByText("Amount reconciles to the running balance")).toBeInTheDocument();

    // The notes are on the app's popover layer, which sits above the dialog
    // rather than level with it. This says where they are rendered, not that
    // they are visible - jsdom paints nothing.
    const notes = screen.getByText("Needs attention").closest("[data-slot='popover-content']");
    expect(notes).not.toBeNull();
    expect(notes!.parentElement).toHaveClass("z-[80]");

    fireEvent.keyDown(notes!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Needs attention")).toBeNull());
  });

  it("says how a ready row was read, without claiming it needs attention", async () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);

    // Nothing is wrong with the row, so nothing is printed under it.
    expect(screen.queryByText(/Amount came from the mapped column/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Ready: show the notes on PDF row 1/ }));
    await waitFor(() => expect(screen.getByText("How this was read")).toBeInTheDocument());
    expect(screen.queryByText("Needs attention")).toBeNull();
  });

  it("keeps undo beside the table, and the parse summary beside the steps", () => {
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={() => {}} />);

    // Undo acts on corrections made to these rows, so it sits with them rather
    // than in the statement's own header.
    const undo = screen.getByRole("button", { name: "Undo PDF correction" });
    expect(undo).toBeDisabled();
    expect(undo.closest("div")).toBe(screen.getByRole("button", { name: /Export/ }).closest("div"));
    expect(undo).toHaveTextContent("");

    // The summary shares the step bar's row instead of taking one of its own.
    const summary = screen.getByRole("region", { name: "PDF parse summary" });
    const steps = screen.getByRole("navigation", { name: "PDF import steps" });
    expect(summary.parentElement).toBe(steps.parentElement);

    // Parser details belongs with the file it is about.
    const details = screen.getByRole("button", { name: /Parser details/ });
    expect(details.closest("[data-slot='dialog-header']")).not.toBeNull();
  });

  it("keeps the row actions in one place whether or not a row can be split", () => {
    const parsed = result([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
    ]);
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={parsed} open onOpenChange={() => {}} onImport={() => {}} />);

    // One value, one cell, one way to see where it came from.
    expect(screen.queryByRole("columnheader", { name: /^Sort by Currency/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Show currency in statement/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Show amount in statement for PDF row 1" })).toBeInTheDocument();

    // The icons keep their own slot, so a row without a split button does not
    // let the other controls slide across.
    const ignore = screen.getByRole("button", { name: "Ignore PDF row 1" });
    expect(ignore.parentElement).toHaveClass("w-14", "justify-end");

    // The date column heads a narrow column, so it carries a name that fits.
    expect(screen.getByRole("columnheader", { name: /Trans\. date/ })).toBeInTheDocument();
  });

  it("writes dates one way and keeps an unreadable one on screen", () => {
    const onImport = jest.fn();
    render(<PdfStatementReviewDialog fileName="statement.pdf" result={ordinaryResult()} open onOpenChange={() => {}} onImport={onImport} />);

    const date = screen.getByLabelText("Transaction date for PDF row 1");
    expect(date).toHaveValue("15/08/2026");

    fireEvent.change(date, { target: { value: "01/09/2026" } });
    fireEvent.blur(date);
    expect(screen.getByLabelText("Transaction date for PDF row 1")).toHaveValue("01/09/2026");

    // Something that is not a date is kept and marked, not discarded and not
    // written to the row as a guess.
    const corrected = screen.getByLabelText("Transaction date for PDF row 1");
    fireEvent.change(corrected, { target: { value: "not a date" } });
    fireEvent.blur(corrected);
    expect(screen.getByLabelText("Transaction date for PDF row 1")).toHaveValue("not a date");
    expect(screen.getByLabelText("Transaction date for PDF row 1")).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(screen.getByRole("button", { name: /Use 1 transaction/ }));
    expect(onImport).toHaveBeenCalledWith(
      [expect.objectContaining({ transactionDate: "2026-09-01" })],
      expect.anything()
    );
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
