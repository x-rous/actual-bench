import {
  DEFAULT_PDF_PARSER_GUIDANCE,
  createPdfLayoutProfile,
  diagnosticsArePrivacySafe,
  guidanceFromPdfLayoutProfile,
  matchPdfLayoutProfile,
  normalizePdfText,
  parsePdfMoneyToMinorUnits,
  parsePdfStatementDocument,
  parsePdfStatementPages,
  reconstructPdfLayout,
  sanitizePdfLayoutProfileEnvelope,
  type PdfParserGuidance,
  type PdfStatementPage,
} from "./pdf";
import {
  PDF_FIXTURE_MANIFEST,
  PDF_FIXTURE_TEST_NAMES,
  PDF_SCHEMA_FAMILY_COVERAGE,
  PDF_SCHEMA_FAMILY_IDS,
} from "./pdf/fixtureManifest";
import { inferPdfDateFormat, parsePdfDateCandidate } from "./pdf/dates";
import { normalizeReviewedPdfStatement } from "./pdfNormalize";

type Cell = { x: number; text: string; dir?: "ltr" | "rtl" };

function page(rows: { y: number; cells: Cell[] }[], pageNumber = 1, scale = 1): PdfStatementPage {
  return {
    pageNumber,
    width: 700 * scale,
    height: 800 * scale,
    items: rows.flatMap((row, rowIndex) => row.cells.map((cell, cellIndex) => ({
      id: `p${pageNumber}-${rowIndex}-${cellIndex}`,
      str: cell.text,
      transform: [10 * scale, 0, 0, 10 * scale, cell.x * scale, row.y * scale],
      width: Math.max(8, cell.text.length * 6) * scale,
      height: 10 * scale,
      dir: cell.dir,
    }))),
  };
}

function splitCharacters(source: PdfStatementPage): PdfStatementPage {
  return {
    ...source,
    items: source.items.flatMap((item, itemIndex) => {
      const width = (item.width ?? 1) / Math.max(1, item.str.length);
      return [...item.str].map((character, characterIndex) => ({
        ...item,
        id: `${itemIndex}-${characterIndex}`,
        str: character,
        width,
        transform: [...item.transform.slice(0, 4), (item.transform[4] ?? 0) + characterIndex * width, item.transform[5] ?? 0],
      }));
    }),
  };
}

function guidance(patch: Partial<PdfParserGuidance> = {}): Partial<PdfParserGuidance> {
  return { ...DEFAULT_PDF_PARSER_GUIDANCE, currency: "USD", dateFormat: "mdy", ...patch };
}

describe("PDF parser v2 positioned model", () => {
  it("normalizes Arabic digits, Unicode minus, spaces, and mixed-case markers", () => {
    expect(normalizePdfText("١٢٣\u202f−٤٥٫٦٧ Cr")).toBe("123 -45.67 CR");
  });

  it("reconstructs equivalent rows after extreme character fragmentation", () => {
    const source = page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 710, cells: [{ x: 20, text: "08/05/2026" }, { x: 120, text: "ANON MERCHANT" }, { x: 480, text: "USD -12.50" }] },
    ]);
    const ordinary = reconstructPdfLayout({ pages: [source] });
    const fragmented = reconstructPdfLayout({ pages: [splitCharacters(source)] });
    expect(fragmented.pages[0].rows.map((row) => row.text)).toEqual(ordinary.pages[0].rows.map((row) => row.text));
    expect(fragmented.pages[0].tokens.every((token) => token.id && token.width > 0)).toBe(true);
  });

  it("is stable under content-stream reordering, empty items, and font-height jitter", () => {
    const source = page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/05/2026" }, { x: 120, text: "ANON MERCHANT" }, { x: 480, text: "USD -12.50" }] },
    ]);
    const changed: PdfStatementPage = {
      ...source,
      items: [
        { str: "  ", transform: [10, 0, 0, 10, 0, 0], width: 0, height: 10 },
        ...[...source.items].reverse().map((item, index) => ({ ...item, height: index % 2 ? 9.5 : 10.5 })),
      ],
    };
    expect(reconstructPdfLayout({ pages: [changed] }).pages[0].rows.map((row) => row.text))
      .toEqual(reconstructPdfLayout({ pages: [source] }).pages[0].rows.map((row) => row.text));
  });

  it("is scale invariant and identifies repeated page furniture", () => {
    const rows = [
      { y: 780, cells: [{ x: 20, text: "ACCOUNT STATEMENT" }] },
      { y: 710, cells: [{ x: 20, text: "08/05/2026" }, { x: 120, text: "SHOP" }, { x: 480, text: "USD -12.50" }] },
      { y: 20, cells: [{ x: 20, text: "Page 1" }] },
    ];
    const result = reconstructPdfLayout({ pages: [page(rows, 1), page(rows, 2, 1.5)] });
    expect(result.pages[0].rows.find((row) => row.text === "ACCOUNT STATEMENT")?.repeatedHeaderFooter).toBe(true);
    expect(result.pages[1].rows.some((row) => row.text.includes("08/05/2026"))).toBe(true);
  });

  it("reports image-only likelihood per page instead of for the whole document", () => {
    const result = reconstructPdfLayout({ pages: [page([{ y: 700, cells: [{ x: 20, text: "Text page" }] }]), { pageNumber: 2, width: 700, height: 800, items: [] }] });
    expect(result.pages[0].imageOnlyLikelihood).toBeLessThan(1);
    expect(result.pages[1].imageOnlyLikelihood).toBe(1);
  });

  it(PDF_FIXTURE_TEST_NAMES.rtlBilingual, () => {
    const transformed: PdfStatementPage = {
      pageNumber: 1,
      width: 800,
      height: 700,
      rotation: 90,
      viewportTransform: [1, 0, 0, -1, 0, 700],
      items: [
        { id: "rtl", str: "متجر", transform: [10, 0, 0, 10, 120, 620], width: 35, height: 10, dir: "rtl" },
        { id: "amount", str: "١٢٣٫٤٥ DR", transform: [10, 0, 0, 10, 480, 620], width: 70, height: 10, dir: "ltr" },
      ],
    };
    const reconstructed = reconstructPdfLayout({ pages: [transformed] }).pages[0];
    expect(reconstructed.rows).toHaveLength(1);
    expect(reconstructed.rows[0].text).toContain("متجر");
    expect(reconstructed.rows[0].text).toContain("123.45 DR");
    expect(reconstructed.tokens.every((token) => token.x >= 0 && token.y >= 0)).toBe(true);
  });
});

describe("PDF parser v2 regions, schema, and blocks", () => {
  const statement = page([
    { y: 770, cells: [{ x: 20, text: "Credit Card Statement AED" }] },
    { y: 735, cells: [{ x: 20, text: "Transaction Date" }, { x: 105, text: "Posting Date" }, { x: 205, text: "Description" }, { x: 500, text: "Debit" }, { x: 590, text: "Credit" }] },
    { y: 700, cells: [{ x: 20, text: "23/07/2026" }, { x: 105, text: "25/07/2026" }, { x: 205, text: "ANON STORE" }] },
    { y: 684, cells: [{ x: 205, text: "Foreign amount SAR 100.00" }] },
    { y: 668, cells: [{ x: 500, text: "AED 97.92" }] },
    { y: 640, cells: [{ x: 20, text: "24/07/2026" }, { x: 105, text: "25/07/2026" }, { x: 205, text: "PAYMENT" }, { x: 590, text: "AED 50.00" }] },
    { y: 300, cells: [{ x: 20, text: "Rewards summary" }] },
    { y: 280, cells: [{ x: 20, text: "Points earned 500" }] },
  ]);

  it(PDF_FIXTURE_TEST_NAMES.dualDateDebitCredit, () => {
    const result = parsePdfStatementPages([statement], { guidance: guidance({ currency: "AED", dateFormat: "dmy" }) });
    expect(result.activeSchema?.columns.map((column) => column.role)).toEqual(expect.arrayContaining(["transaction-date", "posting-date", "description", "debit", "credit"]));
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({ transactionDate: "2026-07-23", postedDate: "2026-07-25", amount: "-97.92", direction: "debit" });
    expect(result.transactions[0].description).toContain("Foreign amount SAR 100.00");
    expect(result.transactions[1]).toMatchObject({ amount: "50.00", direction: "credit" });
    expect(result.regions.some((region) => region.kind !== "transactions" && !region.included)).toBe(true);
  });

  it("infers columns only from the repeated transaction table, not credit-card summaries", () => {
    const result = parsePdfStatementPages([page([
      { y: 790, cells: [{ x: 20, text: "Credit Card Statement USD" }] },
      { y: 770, cells: [{ x: 20, text: "Credit Limit" }, { x: 500, text: "5,000.00" }] },
      { y: 750, cells: [{ x: 20, text: "Available Credit Limit" }, { x: 500, text: "3,400.00" }] },
      { y: 730, cells: [{ x: 20, text: "Minimum Payment Due" }, { x: 500, text: "120.00" }] },
      { y: 700, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Posting Date" }, { x: 220, text: "Description" }, { x: 500, text: "Amount" }] },
      { y: 670, cells: [{ x: 20, text: "23/07/2026" }, { x: 120, text: "24/07/2026" }, { x: 220, text: "FIRST" }, { x: 500, text: "10.00CR" }] },
      { y: 650, cells: [{ x: 20, text: "25/07/2026" }, { x: 120, text: "26/07/2026" }, { x: 220, text: "SECOND" }, { x: 500, text: "20.00" }] },
      { y: 630, cells: [{ x: 20, text: "27/07/2026" }, { x: 120, text: "28/07/2026" }, { x: 220, text: "THIRD" }, { x: 500, text: "30.00" }] },
      { y: 600, cells: [{ x: 20, text: "Total debits" }, { x: 500, text: "50.00" }] },
    ])], { guidance: guidance({ dateFormat: "auto", unsignedDirection: "debit" }) });

    expect(result.activeSchema?.columns.map((column) => column.role)).toEqual([
      "transaction-date",
      "posting-date",
      "description",
      "amount",
    ]);
    expect(result.activeSchema?.columns.map((column) => column.role)).not.toEqual(expect.arrayContaining(["balance", "debit"]));
    const transactionRegionIds = new Set(result.regions
      .filter((region) => region.kind === "transactions" && region.included)
      .flatMap((region) => region.rowIds));
    const transactionRegionText = result.reconstructedPages.flatMap((parsedPage) => parsedPage.rows
      .filter((row) => transactionRegionIds.has(row.id))
      .map((row) => row.text));
    expect(transactionRegionText).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/Credit Limit|Minimum Payment|Total debits/i),
    ]));
    expect(result.transactions).toHaveLength(3);
  });

  it("keeps one visible source block and trace IDs for every transaction", () => {
    const result = parsePdfStatementPages([statement], { guidance: guidance({ currency: "AED", dateFormat: "dmy" }) });
    expect(result.transactions.every((transaction) => transaction.raw.sourceIds.length > 0)).toBe(true);
    expect(result.blocks.every((block) => block.width > 0 && block.height > 0)).toBe(true);
  });

  it("keeps dated rows with unreadable amounts as rejected rows for correction", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON" }, { x: 480, text: "N/A" }] },
    ])], { guidance: guidance() });
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({ amount: "", status: "rejected" });
    expect(result.transactions[0].issueCodes).toContain("AMOUNT_MISSING");
  });

  it(PDF_FIXTURE_TEST_NAMES.crossPageBlock, () => {
    const first = page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "ANON TRANSFER" }, { x: 480, text: "USD -10.00" }] },
    ], 1);
    const second = page([
      { y: 760, cells: [{ x: 120, text: "CONTINUED REFERENCE" }] },
      { y: 720, cells: [{ x: 20, text: "08/02/2026" }, { x: 120, text: "NEXT ROW" }, { x: 480, text: "USD -20.00" }] },
    ], 2);
    const result = parsePdfStatementPages([first, second], { guidance: guidance() });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].description).toContain("CONTINUED REFERENCE");
  });

  it("uses the next date anchor as the boundary when its description baseline appears first", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 150, text: "Description" }, { x: 560, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 150, text: "FIRST MERCHANT" }, { x: 560, text: "-10.00" }] },
      { y: 680, cells: [{ x: 150, text: "FIRST REFERENCE" }] },
      // This description is printed slightly above its transaction date. Its
      // box overlaps the date vertically, but the baseline gap is large enough
      // for PDF.js reconstruction to emit a separate visual row.
      { y: 650, cells: [{ x: 150, text: "SECOND MERCHANT" }] },
      { y: 646, cells: [{ x: 20, text: "08/02/2026" }] },
      { y: 630, cells: [{ x: 150, text: "SECOND REFERENCE" }, { x: 560, text: "-20.00" }] },
    ])], { guidance: guidance() });

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].description).toContain("FIRST REFERENCE");
    expect(result.transactions[0].description).not.toContain("SECOND MERCHANT");
    expect(result.transactions[1].description).toContain("SECOND MERCHANT");
    expect(result.transactions[1].description).toContain("SECOND REFERENCE");
  });

  it("keeps a non-overlapping lead description line with its nearby date anchor", () => {
    const result = parsePdfStatementPages([page([
      { y: 760, cells: [{ x: 20, text: "Date" }, { x: 150, text: "Description" }, { x: 600, text: "Amount" }] },
      { y: 720, cells: [{ x: 20, text: "08/01/2026" }, { x: 150, text: "PREVIOUS TRANSACTION" }, { x: 600, text: "-10.00" }] },
      { y: 690, cells: [{ x: 150, text: "PREVIOUS TRANSACTION DETAILS" }] },
      // PDF font metrics place the first description line just above, but not
      // overlapping, its date box. It is still in the same local row band.
      { y: 665, cells: [{ x: 150, text: "ANON DIGITAL SERVICE USD 100.00" }] },
      { y: 650, cells: [{ x: 20, text: "08/02/2026" }] },
      { y: 630, cells: [{ x: 150, text: "FX USD/AED 0.250000000" }] },
      { y: 610, cells: [{ x: 150, text: "ANON FOREIGN CURRENCY FEE" }, { x: 600, text: "-25.00" }] },
      { y: 590, cells: [{ x: 150, text: "ANON STANDARD PROCESSING FEE" }] },
      { y: 550, cells: [{ x: 20, text: "08/03/2026" }, { x: 150, text: "NEXT TRANSACTION" }, { x: 600, text: "-5.00" }] },
    ])], { guidance: guidance() });

    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[0].description).not.toContain("ANON DIGITAL SERVICE");
    expect(result.transactions[1].description).toContain(
      "ANON DIGITAL SERVICE USD 100.00 FX USD/AED 0.250000000 ANON FOREIGN CURRENCY FEE ANON STANDARD PROCESSING FEE"
    );
  });

  it(PDF_FIXTURE_TEST_NAMES.multilineFinancialBlock, () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [
        { x: 20, text: "Date" },
        { x: 150, text: "Description" },
        { x: 390, text: "Original Amount" },
        { x: 475, text: "Fee" },
        { x: 525, text: "VAT" },
        { x: 585, text: "Amount" },
      ] },
      { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 150, text: "MULTI-LINE PURCHASE" }] },
      { y: 680, cells: [{ x: 150, text: "Foreign purchase" }, { x: 390, text: "SAR 70.00" }] },
      { y: 660, cells: [{ x: 150, text: "FX processing fee" }, { x: 475, text: "1.37" }] },
      { y: 640, cells: [{ x: 150, text: "VAT on fee" }, { x: 525, text: "0.07" }] },
      { y: 620, cells: [{ x: 150, text: "Intermediate total" }, { x: 585, text: "69.99" }] },
      { y: 600, cells: [{ x: 150, text: "Final account total" }, { x: 585, text: "AED 70.77" }] },
    ])], { guidance: guidance({ currency: "AED", unsignedDirection: "debit" }) });

    expect(result.transactions).toHaveLength(1);
    expect(result.blocks[0].rowIds).toHaveLength(6);
    expect(result.transactions[0]).toMatchObject({
      amount: "-70.77",
      originalAmount: { coefficient: "7000", scale: 2, currency: "SAR" },
      fees: [{ coefficient: "137", scale: 2 }],
      vat: [{ coefficient: "7", scale: 2 }],
    });
    expect(result.transactions[0].description).toContain("Final account total");
    expect(result.transactions[0].issueCodes).toContain("AMOUNT_MULTIPLE_CANDIDATES");
  });

  it(PDF_FIXTURE_TEST_NAMES.suppressedDate, () => {
    const result = parsePdfStatementPages([page([
      { y: 750, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }, { x: 580, text: "Balance" }] },
      { y: 710, cells: [{ x: 20, text: "31/12" }, { x: 120, text: "FIRST" }, { x: 480, text: "10.00" }, { x: 580, text: "990.00" }] },
      { y: 690, cells: [{ x: 120, text: "SECOND SAME DAY" }, { x: 480, text: "20.00" }, { x: 580, text: "970.00" }] },
      { y: 670, cells: [{ x: 120, text: "THIRD SAME DAY" }, { x: 480, text: "5.00" }, { x: 580, text: "965.00" }] },
    ])], {
      guidance: guidance({
        dateFormat: "dmy",
        statementPeriod: { start: "2025-12-01", end: "2025-12-31" },
      }),
    });

    expect(result.transactions).toHaveLength(3);
    expect(result.transactions.map((row) => row.transactionDate)).toEqual([
      "2025-12-31",
      "2025-12-31",
      "2025-12-31",
    ]);
    expect(result.transactions.slice(1).every((row) =>
      row.issueCodes.includes("DATE_INHERITED_FROM_PREVIOUS_ROW")
    )).toBe(true);
    expect(result.blocks.slice(1).every((block) => block.inheritsPreviousDate)).toBe(true);
  });

  it(PDF_FIXTURE_TEST_NAMES.controlRows, () => {
    const result = parsePdfStatementPages([page([
      { y: 750, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }, { x: 580, text: "Balance" }] },
      { y: 710, cells: [{ x: 20, text: "01/01/2026" }, { x: 120, text: "FIRST" }, { x: 480, text: "10.00" }, { x: 580, text: "990.00" }] },
      { y: 690, cells: [{ x: 120, text: "Balance carried forward" }, { x: 580, text: "990.00" }] },
      { y: 670, cells: [{ x: 120, text: "Total debits" }, { x: 480, text: "10.00" }] },
      { y: 650, cells: [{ x: 20, text: "02/01/2026" }, { x: 120, text: "SECOND" }, { x: 480, text: "20.00" }, { x: 580, text: "970.00" }] },
    ])], { guidance: guidance({ dateFormat: "dmy" }) });

    expect(result.transactions.map((row) => row.description)).toEqual(["FIRST", "SECOND"]);
    expect(result.diagnostics.filter((entry) => entry.code === "CONTROL_ROW_EXCLUDED")).toHaveLength(2);
  });

  it(PDF_FIXTURE_TEST_NAMES.feeTaxClassification, () => {
    const columns = [
      { id: "date", pageNumber: null, xStart: 15, xEnd: 100, role: "transaction-date" as const, header: "Date", examples: [], confidence: 1 },
      { id: "description", pageNumber: null, xStart: 105, xEnd: 390, role: "description" as const, header: "Description", examples: [], confidence: 1 },
      { id: "fee", pageNumber: null, xStart: 395, xEnd: 455, role: "fee" as const, header: "Fee", examples: [], confidence: 1 },
      { id: "vat", pageNumber: null, xStart: 460, xEnd: 515, role: "vat" as const, header: "Tax", examples: [], confidence: 1 },
      { id: "debit", pageNumber: null, xStart: 520, xEnd: 575, role: "debit" as const, header: "Debit", examples: [], confidence: 1 },
      { id: "balance", pageNumber: null, xStart: 580, xEnd: 690, role: "balance" as const, header: "Balance", examples: [], confidence: 1 },
    ];
    const result = parsePdfStatementPages([page([
      { y: 750, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 410, text: "Fee" }, { x: 470, text: "Tax" }, { x: 530, text: "Debit" }, { x: 600, text: "Balance" }] },
      { y: 710, cells: [{ x: 20, text: "01/01/2026" }, { x: 120, text: "PURCHASE" }] },
      { y: 690, cells: [{ x: 120, text: "PROCESSING COMPONENT" }, { x: 410, text: "1.00" }] },
      { y: 670, cells: [{ x: 120, text: "TAX COMPONENT" }, { x: 470, text: "0.05" }] },
      { y: 650, cells: [{ x: 120, text: "FINAL ACCOUNT AMOUNT" }, { x: 530, text: "11.05" }, { x: 600, text: "988.95" }] },
      { y: 630, cells: [{ x: 120, text: "SEPARATE SERVICE FEE" }, { x: 530, text: "2.00" }, { x: 600, text: "986.95" }] },
    ])], { guidance: guidance({ dateFormat: "dmy", columns }) });

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      description: expect.stringContaining("PROCESSING COMPONENT"),
      fees: [expect.objectContaining({ coefficient: "100" })],
      vat: [expect.objectContaining({ coefficient: "5" })],
      amount: "-11.05",
    });
    expect(result.transactions[1]).toMatchObject({
      description: "SEPARATE SERVICE FEE",
      transactionDate: "2026-01-01",
      amount: "-2.00",
    });
  });

  it(PDF_FIXTURE_TEST_NAMES.multiColumnDescription, () => {
    const columns = [
      { id: "date", pageNumber: null, xStart: 15, xEnd: 85, role: "transaction-date" as const, header: "Date", examples: [], confidence: 1 },
      { id: "counterparty", pageNumber: null, xStart: 90, xEnd: 205, role: "description" as const, header: "Counterparty", examples: [], confidence: 1 },
      { id: "reference", pageNumber: null, xStart: 210, xEnd: 300, role: "reference" as const, header: "Reference", examples: [], confidence: 1 },
      { id: "details", pageNumber: null, xStart: 305, xEnd: 410, role: "description" as const, header: "Other details", examples: [], confidence: 1 },
      { id: "description", pageNumber: null, xStart: 415, xEnd: 535, role: "description" as const, header: "Description", examples: [], confidence: 1 },
      { id: "debit", pageNumber: null, xStart: 540, xEnd: 695, role: "debit" as const, header: "Debit", examples: [], confidence: 1 },
    ];
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 100, text: "Counterparty" }, { x: 220, text: "Reference" }, { x: 320, text: "Other details" }, { x: 430, text: "Description" }, { x: 580, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "15/08/2026" }, { x: 100, text: "ANON COUNTERPARTY" }, { x: 220, text: "REF-001" }, { x: 320, text: "DETAIL A" }, { x: 430, text: "PURCHASE" }, { x: 580, text: "10.00" }] },
    ])], { guidance: guidance({ dateFormat: "dmy", columns }) });

    expect(result.activeSchema?.columns.filter((column) => column.role === "description")).toHaveLength(3);
    expect(result.transactions[0].description).toBe("ANON COUNTERPARTY DETAIL A PURCHASE");
    expect(result.transactions[0].reference).toBe("REF-001");
    expect(result.transactions[0].status).toBe("accepted");
  });

  it(PDF_FIXTURE_TEST_NAMES.withdrawalDeposit, () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 430, text: "Withdrawal" }, { x: 520, text: "Deposit" }, { x: 610, text: "Balance" }] },
      { y: 700, cells: [{ x: 20, text: "15/08/2026" }, { x: 120, text: "ANON PURCHASE" }, { x: 450, text: "25.00" }, { x: 610, text: "975.00" }] },
      { y: 680, cells: [{ x: 20, text: "16/08/2026" }, { x: 120, text: "ANON CREDIT" }, { x: 540, text: "50.00" }, { x: 610, text: "1,025.00" }] },
    ])], { guidance: guidance({ dateFormat: "dmy" }) });

    expect(result.activeSchema?.columns.map((column) => column.role)).toEqual(expect.arrayContaining(["debit", "credit", "balance"]));
    expect(result.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: "ANON PURCHASE", amount: "-25.00", direction: "debit" }),
      expect.objectContaining({ description: "ANON CREDIT", amount: "50.00", direction: "credit" }),
    ]));
    expect(result.transactions.every((transaction) => transaction.status === "accepted")).toBe(true);
  });

  it(PDF_FIXTURE_TEST_NAMES.dualDateReference, () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 125, text: "Posting Date" }, { x: 225, text: "Reference" }, { x: 330, text: "Description" }, { x: 580, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "15/08/2026" }, { x: 125, text: "16/08/2026" }, { x: 225, text: "REF-001" }, { x: 330, text: "ANON PURCHASE" }, { x: 580, text: "-10.00" }] },
    ])], { guidance: guidance({ dateFormat: "dmy" }) });

    expect(result.transactions[0]).toMatchObject({
      transactionDate: "2026-08-15",
      postedDate: "2026-08-16",
      reference: "REF-001",
      amount: "-10.00",
      status: "accepted",
    });
  });

  it(PDF_FIXTURE_TEST_NAMES.valueDateDebitCredit, () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Booking Date" }, { x: 130, text: "Value Date" }, { x: 240, text: "Description" }, { x: 500, text: "Debit" }, { x: 590, text: "Credit" }] },
      { y: 700, cells: [{ x: 20, text: "15/08/2026" }, { x: 130, text: "16/08/2026" }, { x: 240, text: "ANON PURCHASE" }, { x: 500, text: "10.00" }] },
      { y: 680, cells: [{ x: 20, text: "17/08/2026" }, { x: 130, text: "18/08/2026" }, { x: 240, text: "ANON CREDIT" }, { x: 590, text: "20.00" }] },
    ])], { guidance: guidance({ dateFormat: "dmy", currency: "EUR", importDate: "posting" }) });

    expect(result.activeSchema?.columns.map((column) => column.role)).toEqual(expect.arrayContaining(["posting-date", "value-date", "debit", "credit"]));
    expect(result.transactions[0]).toMatchObject({ postedDate: "2026-08-15", valueDate: "2026-08-16", amount: "-10.00" });
    expect(result.transactions[1]).toMatchObject({ postedDate: "2026-08-17", valueDate: "2026-08-18", amount: "20.00" });
    expect(result.transactions.every((transaction) => transaction.status === "accepted")).toBe(true);
  });

  it(PDF_FIXTURE_TEST_NAMES.multiSection, () => {
    const result = parsePdfStatementPages([page([
      { y: 780, cells: [{ x: 20, text: "Primary Card" }] },
      { y: 750, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 500, text: "Debit" }, { x: 590, text: "Credit" }] },
      { y: 720, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON PRIMARY" }, { x: 500, text: "10.00" }] },
      { y: 680, cells: [{ x: 20, text: "Supplementary Card" }] },
      { y: 650, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "ANON SUPPLEMENTARY" }, { x: 590, text: "20.00" }] },
    ])], { guidance: guidance() });

    expect(result.transactions).toHaveLength(2);
    expect(new Set(result.transactions.map((transaction) => transaction.sectionId)).size).toBe(2);
    expect(result.transactions.every((transaction) => transaction.status === "accepted")).toBe(true);
  });

  it(PDF_FIXTURE_TEST_NAMES.rtlTransaction, () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 150, text: "Description" }, { x: 520, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "١٥/٠٨/٢٠٢٦" }, { x: 150, text: "متجر تجريبي", dir: "rtl" }, { x: 520, text: "١٢٣٫٤٥ DR" }] },
    ])], { guidance: guidance({ dateFormat: "dmy", currency: "AED" }) });

    expect(result.transactions[0]).toMatchObject({
      transactionDate: "2026-08-15",
      description: "متجر تجريبي",
      amount: "-123.45",
      status: "accepted",
    });
  });

  it(PDF_FIXTURE_TEST_NAMES.dateLikeNarrative, () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 560, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "15/08/2026" }, { x: 120, text: "ANON TRANSFER TIMED 17:30 31 JAN" }, { x: 560, text: "10.00" }] },
    ])], { guidance: guidance({ dateFormat: "dmy", currency: "GBP" }) });

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      transactionDate: "2026-08-15",
      description: "ANON TRANSFER TIMED 17:30 31 JAN",
      amount: "-10.00",
      status: "accepted",
    });
  });
});

describe("PDF parser v2 financial interpretation and validation", () => {
  it("parses an explicitly ordered numeric date", () => {
    expect(parsePdfDateCandidate("08/15/2026", "mdy", [], { start: null, end: null }).value).toBe("2026-08-15");
  });

  it.each([
    ["3rd July 2026", "2026-07-03"],
    ["Sep. 3, 2026", "2026-09-03"],
    ["September 3rd, 2026", "2026-09-03"],
  ])("parses the common month-name date %s", (raw, expected) => {
    expect(parsePdfDateCandidate(raw, "dmy-name", [], { start: null, end: null }).value).toBe(expected);
  });

  it("uses an ordinal month-name date as a transaction anchor", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "3rd July 2026" }, { x: 120, text: "ANON" }, { x: 480, text: "USD -10.00" }] },
    ])], { guidance: guidance({ dateFormat: "dmy-name" }) });

    expect(result.transactions[0].transactionDate).toBe("2026-07-03");
  });

  it("does not guess an ambiguous date order", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "03/04/2026" }, { x: 120, text: "ANON" }, { x: 480, text: "USD -10.00" }] },
    ])], { guidance: guidance({ dateFormat: "auto" }) });
    expect(result.transactions[0].transactionDate).toBeNull();
    expect(result.transactions[0].confidence.transactionDate.reasons).toContain("DATE_AMBIGUOUS_ORDER");
    expect(result.transactions[0].status).toBe("rejected");
  });

  it("uses statement-period and chronological evidence only when column values do not establish the order", () => {
    expect(inferPdfDateFormat(
      [["02/08/2026", "03/08/2026", "05/08/2026"]],
      { start: "2026-08-01", end: "2026-08-31" }
    )).toBe("dmy");
    expect(inferPdfDateFormat(
      [["01/02/2026", "02/01/2026", "03/04/2026"]],
      { start: "2026-01-01", end: "2026-12-31" }
    )).toBe("mdy");
    expect(inferPdfDateFormat(
      [["02/03/2026", "04/05/2026"]],
      { start: null, end: null }
    )).toBe("auto");
  });

  it("infers one date order from the mapped column and applies it to ambiguous rows", () => {
    const result = parsePdfStatementPages([page([
      { y: 760, cells: [{ x: 20, text: "Statement period 23/07/2026 - 05/08/2026" }] },
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "23/07/2026" }, { x: 120, text: "FIRST" }, { x: 480, text: "1.00" }] },
      { y: 680, cells: [{ x: 20, text: "29/07/2026" }, { x: 120, text: "SECOND" }, { x: 480, text: "2.00" }] },
      { y: 660, cells: [{ x: 20, text: "31/07/2026" }, { x: 120, text: "THIRD" }, { x: 480, text: "3.00" }] },
      { y: 640, cells: [{ x: 20, text: "02/08/2026" }, { x: 120, text: "FOURTH" }, { x: 480, text: "4.00" }] },
      { y: 620, cells: [{ x: 20, text: "03/08/2026" }, { x: 120, text: "FIFTH" }, { x: 480, text: "5.00" }] },
      { y: 600, cells: [{ x: 20, text: "05/08/2026" }, { x: 120, text: "SIXTH" }, { x: 480, text: "6.00" }] },
    ])], {
      guidance: guidance({
        dateFormat: "auto",
        statementPeriod: { start: "2026-07-23", end: "2026-08-05" },
      }),
    });

    expect(result.guidance.dateFormat).toBe("dmy");
    expect(result.transactions.map((row) => row.transactionDate)).toEqual([
      "2026-07-23",
      "2026-07-29",
      "2026-07-31",
      "2026-08-02",
      "2026-08-03",
      "2026-08-05",
    ]);
    expect(result.transactions.every((row) => !row.issueCodes.includes("DATE_AMBIGUOUS_ORDER"))).toBe(true);
    expect(result.metrics.rejected).toBe(0);
  });

  it(PDF_FIXTURE_TEST_NAMES.independentDateColumns, () => {
    const document = { pages: [page([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 130, text: "Posting Date" }, { x: 240, text: "Description" }, { x: 520, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "23/07/2026" }, { x: 130, text: "07/24/2026" }, { x: 240, text: "FIRST" }, { x: 520, text: "10.00" }] },
      { y: 680, cells: [{ x: 20, text: "02/08/2026" }, { x: 130, text: "08/03/2026" }, { x: 240, text: "SECOND" }, { x: 520, text: "20.00" }] },
    ])] };
    const result = parsePdfStatementDocument(document, { guidance: guidance({ dateFormat: "auto" }) });

    expect(result.guidance.dateFormat).toBe("auto");
    expect(result.transactions.map((row) => [row.transactionDate, row.postedDate])).toEqual([
      ["2026-07-23", "2026-07-24"],
      ["2026-08-02", "2026-08-03"],
    ]);
    const rerun = parsePdfStatementDocument(document, { guidance: result.guidance });
    expect(rerun.transactions.map((row) => [row.transactionDate, row.postedDate])).toEqual([
      ["2026-07-23", "2026-07-24"],
      ["2026-08-02", "2026-08-03"],
    ]);
  });

  it(PDF_FIXTURE_TEST_NAMES.crossYearPartialDates, () => {
    const result = parsePdfStatementPages([page([
      { y: 775, cells: [{ x: 20, text: "Statement period 15/12/2025 - 14/01/2026" }] },
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "30/12" }, { x: 120, text: "YEAR END" }, { x: 480, text: "10.00" }] },
      { y: 680, cells: [{ x: 20, text: "02/01" }, { x: 120, text: "NEW YEAR" }, { x: 480, text: "20.00" }] },
    ])], { guidance: guidance({ dateFormat: "auto" }) });

    expect(result.guidance.statementPeriod).toEqual({ start: "2025-12-15", end: "2026-01-14" });
    expect(result.transactions.map((row) => row.transactionDate)).toEqual(["2025-12-30", "2026-01-02"]);
  });

  it("normalizes PDF spacing inside partial dates and fragmented four-digit years", () => {
    const result = parsePdfStatementPages([page([
      { y: 775, cells: [{ x: 20, text: "Open Date: 12/ 15/ 20 25 Closing Date: 01/ 14/ 20 26" }] },
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "12/ 30" }, { x: 120, text: "YEAR END" }, { x: 480, text: "10.00" }] },
      { y: 680, cells: [{ x: 20, text: "01/ 02" }, { x: 120, text: "NEW YEAR" }, { x: 480, text: "20.00" }] },
    ])], { guidance: guidance({ dateFormat: "auto" }) });

    expect(result.guidance.statementPeriod).toEqual({ start: "2025-12-15", end: "2026-01-14" });
    expect(result.transactions.map((row) => row.transactionDate)).toEqual(["2025-12-30", "2026-01-02"]);
  });

  it("fully removes an optional posting date after its column mapping is removed", () => {
    const document = { pages: [page([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Posting Date" }, { x: 220, text: "Description" }, { x: 500, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "23/07/2026" }, { x: 120, text: "24/07/2026" }, { x: 220, text: "FIRST" }, { x: 500, text: "10.00" }] },
      { y: 680, cells: [{ x: 20, text: "25/07/2026" }, { x: 220, text: "SECOND" }, { x: 500, text: "20.00" }] },
    ])] };
    const detected = parsePdfStatementDocument(document, { guidance: guidance({ dateFormat: "dmy" }) });
    const withoutPosting = parsePdfStatementDocument(document, {
      guidance: {
        ...detected.guidance,
        importDate: "posting",
        columns: detected.guidance.columns.filter((column) => column.role !== "posting-date"),
      },
    });

    expect(withoutPosting.guidance.importDate).toBe("transaction");
    expect(withoutPosting.transactions.map((row) => row.postedDate)).toEqual([null, null]);
    expect(withoutPosting.transactions.every((row) => row.confidence.postingDate === null)).toBe(true);
    expect(withoutPosting.transactions.every((row) => !row.issueCodes.includes("DATE_INVALID"))).toBe(true);
    expect(withoutPosting.metrics.rejected).toBe(0);
    expect(withoutPosting.warnings.some((warning) => warning.includes("unresolved required fields"))).toBe(false);
  });

  it.each([
    ["1,234.56", 123456], ["1.234,56", 123456], ["1 234,56", 123456],
    ["1,23,456.78", 12345678], ["1'234.56", 123456], ["١٢٣٫٤٥", 12345],
  ])("reads exact country number form %s", (input, expected) => {
    expect(parsePdfMoneyToMinorUnits(input)).toBe(expected);
  });

  it.each([
    ["US", "08/15/2026", "USD 1,234.56", "mdy", "us", "123456", 2],
    ["Europe", "15/08/2026", "EUR 1.234,56", "dmy", "european", "123456", 2],
    ["Space grouping", "15/08/2026", "EUR 1 234,56", "dmy", "space", "123456", 2],
    ["India", "15/08/2026", "INR 1,23,456.78", "dmy", "indian", "12345678", 2],
    ["Switzerland", "15/08/2026", "CHF 1'234.56", "dmy", "swiss", "123456", 2],
    ["GCC Arabic digits", "15/08/2026", "AED ١٬٢٣٤٫٥٦", "dmy", "us", "123456", 2],
    ["East Asia", "2026/08/15", "JPY 1,234", "ymd", "us", "1234", 0],
  ] as const)(PDF_FIXTURE_TEST_NAMES.countryNumberFormats, (_family, date, amount, dateFormat, numberFormat, coefficient, scale) => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: date }, { x: 120, text: "ANON" }, { x: 480, text: amount }] },
    ])], { guidance: guidance({ dateFormat, numberFormat }) });
    expect(result.transactions[0].exactAmount).toMatchObject({ coefficient, scale });
    expect(result.transactions[0].direction).toBe("debit");
  });

  it.each([
    ["Checking account", "checking"],
    ["Savings account", "savings"],
    ["Credit card statement", "credit-card"],
    ["Prepaid card statement", "prepaid"],
    ["Multi-currency account", "multi-currency"],
    ["Business checking account", "business-cash"],
    ["Mortgage loan statement", "loan"],
    ["Investment statement portfolio", "investment"],
  ] as const)("routes generic %s headings to the %s account model", (heading, expected) => {
    const result = parsePdfStatementPages([page([
      { y: 770, cells: [{ x: 20, text: heading }] },
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON" }, { x: 480, text: "USD 1.00" }] },
    ])], { guidance: guidance() });
    expect(result.accountType).toBe(expected);
  });

  it(PDF_FIXTURE_TEST_NAMES.originalAndAccountAmount, () => {
    const columns = [
      { id: "date", pageNumber: null, xStart: 15, xEnd: 95, role: "transaction-date" as const, header: null, examples: [], confidence: 1 },
      { id: "description", pageNumber: null, xStart: 100, xEnd: 300, role: "description" as const, header: null, examples: [], confidence: 1 },
      { id: "original", pageNumber: null, xStart: 305, xEnd: 385, role: "original-amount" as const, header: null, examples: [], confidence: 1 },
      { id: "original-currency", pageNumber: null, xStart: 390, xEnd: 440, role: "original-currency" as const, header: null, examples: [], confidence: 1 },
      { id: "rate", pageNumber: null, xStart: 445, xEnd: 495, role: "exchange-rate" as const, header: null, examples: [], confidence: 1 },
      { id: "fee", pageNumber: null, xStart: 500, xEnd: 545, role: "fee" as const, header: null, examples: [], confidence: 1 },
      { id: "vat", pageNumber: null, xStart: 550, xEnd: 595, role: "vat" as const, header: null, examples: [], confidence: 1 },
      { id: "debit", pageNumber: null, xStart: 600, xEnd: 700, role: "debit" as const, header: null, examples: [], confidence: 1 },
    ];
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 620, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON FX" }, { x: 320, text: "100.00" }, { x: 400, text: "SAR" }, { x: 455, text: "3.6725" }, { x: 510, text: "5.00" }, { x: 560, text: "0.25" }, { x: 620, text: "AED 372.25" }] },
    ])], { guidance: guidance({ columns }) });
    expect(result.transactions[0]).toMatchObject({
      originalAmount: { coefficient: "10000", scale: 2, currency: "SAR" },
      exchangeRate: "3.6725",
    });
    expect(result.transactions[0].fees[0]).toMatchObject({ coefficient: "500", currency: "USD" });
    expect(result.transactions[0].vat[0]).toMatchObject({ coefficient: "25", currency: "USD" });
  });

  it("retains three-decimal money internally and rejects lossy downstream conversion", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "23/07/2026" }, { x: 120, text: "ANON" }, { x: 480, text: "KWD 1.234" }] },
    ])], { guidance: guidance({ currency: "KWD", dateFormat: "dmy" }) });
    expect(result.transactions[0].exactAmount).toMatchObject({ coefficient: "1234", scale: 3, currency: "KWD" });
    expect(result.transactions[0].status).toBe("rejected");
    expect(result.transactions[0].issueCodes).toContain("ACTUAL_PRECISION_UNSUPPORTED");
    expect(parsePdfMoneyToMinorUnits(result.transactions[0].amount)).toBeNull();
  });

  it("reads compact and yearless dates only with enough explicit period guidance", () => {
    const compact = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "20260805" }, { x: 120, text: "ANON" }, { x: 480, text: "USD 1.00" }] },
    ])], { guidance: guidance({ dateFormat: "ymd-compact" }) });
    expect(compact.transactions[0].transactionDate).toBe("2026-08-05");

    const yearless = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Credit" }] },
      { y: 700, cells: [{ x: 20, text: "05 Aug" }, { x: 120, text: "ANON" }, { x: 480, text: "USD 1.00" }] },
    ])], { guidance: guidance({ dateFormat: "dmy-name", statementPeriod: { start: "2026-08-01", end: "2026-08-31" } }) });
    expect(yearless.transactions[0].transactionDate).toBe("2026-08-05");
    expect(yearless.transactions[0].confidence.transactionDate.reasons).toContain("DATE_YEAR_INFERRED_FROM_PERIOD");
  });

  it.each(["CR", "Cr", "cr"])("uses a lone %s marker as money in", (marker) => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON" }, { x: 480, text: `USD 12.50 ${marker}` }] },
    ])], { guidance: guidance() });
    expect(result.transactions[0]).toMatchObject({ direction: "credit", amount: "12.50" });
  });

  it.each([
    ["D", "debit", "-12.50"],
    ["C", "credit", "12.50"],
    ["Debit", "debit", "-12.50"],
    ["Credit", "credit", "12.50"],
  ] as const)(PDF_FIXTURE_TEST_NAMES.directionIndicator, (indicator, direction, amount) => {
    const columns = [
      { id: "date", pageNumber: null, xStart: 15, xEnd: 100, role: "transaction-date" as const, header: "Date", examples: [], confidence: 1 },
      { id: "description", pageNumber: null, xStart: 105, xEnd: 390, role: "description" as const, header: "Description", examples: [], confidence: 1 },
      { id: "amount", pageNumber: null, xStart: 400, xEnd: 520, role: "amount" as const, header: "Amount", examples: [], confidence: 1 },
      { id: "direction", pageNumber: null, xStart: 525, xEnd: 620, role: "direction" as const, header: "D/C", examples: [], confidence: 1 },
    ];
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 420, text: "Amount" }, { x: 540, text: "D/C" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON" }, { x: 420, text: "12.50" }, { x: 540, text: indicator }] },
    ])], { guidance: guidance({ columns }) });
    expect(result.transactions[0]).toMatchObject({ direction, amount });
  });

  it(PDF_FIXTURE_TEST_NAMES.sectionDirection, () => {
    const result = parsePdfStatementPages([page([
      { y: 760, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 735, cells: [{ x: 120, text: "Purchases and Other Debits" }] },
      { y: 710, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "ANON PURCHASE" }, { x: 480, text: "10.00" }] },
      { y: 680, cells: [{ x: 120, text: "Payments and Other Credits" }] },
      { y: 655, cells: [{ x: 20, text: "08/02/2026" }, { x: 120, text: "ANON PAYMENT" }, { x: 480, text: "20.00" }] },
    ])], { guidance: guidance() });

    expect(result.transactions.map((row) => [row.direction, row.directionEvidence, row.amount])).toEqual([
      ["debit", "section", "-10.00"],
      ["credit", "section", "20.00"],
    ]);
  });

  it(PDF_FIXTURE_TEST_NAMES.singleAmountCr, () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON CREDIT" }, { x: 480, text: "113.61CR" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "ANON DEBIT" }, { x: 480, text: "42.10" }] },
    ])], { guidance: guidance({ unsignedDirection: "debit" }) });

    expect(result.activeSchema?.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "amount" }),
    ]));
    expect(result.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: "ANON CREDIT", amount: "113.61", direction: "credit", status: "accepted" }),
      expect.objectContaining({ description: "ANON DEBIT", amount: "-42.10", direction: "debit", status: "accepted" }),
    ]));
  });

  it("applies normalized mapped columns to every included page width", () => {
    const rows = [
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "PAGE ROW" }, { x: 480, text: "10.00CR" }] },
    ];
    const columns = [
      { id: "date", pageNumber: null, referencePageWidth: 700, xStart: 15, xEnd: 105, role: "transaction-date" as const, header: "Date", examples: [], confidence: 1 },
      { id: "description", pageNumber: null, referencePageWidth: 700, xStart: 110, xEnd: 400, role: "description" as const, header: "Description", examples: [], confidence: 1 },
      { id: "amount", pageNumber: null, referencePageWidth: 700, xStart: 450, xEnd: 560, role: "amount" as const, header: "Amount", examples: [], confidence: 1 },
    ];
    const result = parsePdfStatementPages([page(rows, 1), page(rows, 2, 1.5)], {
      guidance: guidance({ columns, unsignedDirection: "debit" }),
    });

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.map((row) => [row.raw.pageNumber, row.transactionDate, row.amount, row.direction])).toEqual([
      [1, "2026-08-15", "10.00", "credit"],
      [2, "2026-08-15", "10.00", "credit"],
    ]);
  });

  it("rejects a mapped debit column when its printed marker says credit", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON" }, { x: 480, text: "USD 12.50 CR" }] },
    ])], { guidance: guidance() });
    expect(result.transactions[0].status).toBe("rejected");
    expect(result.transactions[0].issueCodes).toContain("DIRECTION_EVIDENCE_CONFLICT");
  });

  it("rejects a row populated in both debit and credit columns", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }, { x: 580, text: "Credit" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON" }, { x: 480, text: "USD 12.50" }, { x: 580, text: "USD 12.50" }] },
    ])], { guidance: guidance() });
    expect(result.transactions[0].status).toBe("rejected");
    expect(result.transactions[0].issueCodes).toContain("AMOUNT_DEBIT_CREDIT_CONFLICT");
  });

  it("requires review rather than using account type to guess an unsigned direction", () => {
    const result = parsePdfStatementPages([page([
      { y: 760, cells: [{ x: 20, text: "Credit Card Statement USD" }] },
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON" }, { x: 480, text: "12.50" }] },
    ])], { guidance: guidance() });
    expect(result.transactions[0]).toMatchObject({ direction: "unknown", status: "rejected" });
    expect(result.transactions[0].issueCodes).toContain("DIRECTION_UNRESOLVED");
  });

  it("uses a consistent balance sequence, not one isolated pair, to resolve unsigned directions", () => {
    const rows = [
      { y: 775, cells: [{ x: 20, text: "Checking account statement USD" }] },
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }, { x: 580, text: "Balance" }] },
      { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "OPEN" }, { x: 480, text: "100.00" }, { x: 580, text: "1,000.00" }] },
      { y: 680, cells: [{ x: 20, text: "08/02/2026" }, { x: 120, text: "IN" }, { x: 480, text: "10.00" }, { x: 580, text: "1,010.00" }] },
      { y: 660, cells: [{ x: 20, text: "08/03/2026" }, { x: 120, text: "OUT" }, { x: 480, text: "5.00" }, { x: 580, text: "1,005.00" }] },
    ];
    const sequence = parsePdfStatementPages([page(rows)], { guidance: guidance() });
    expect(sequence.transactions.slice(1).map((row) => [row.direction, row.directionEvidence])).toEqual([
      ["credit", "balance"],
      ["debit", "balance"],
    ]);

    const isolated = parsePdfStatementPages([page(rows.slice(0, 4))], { guidance: guidance() });
    expect(isolated.transactions[1].direction).toBe("unknown");
    expect(isolated.transactions[1].status).toBe("rejected");
  });

  it(PDF_FIXTURE_TEST_NAMES.runningBalance, () => {
    const result = parsePdfStatementPages([page([
      { y: 775, cells: [{ x: 20, text: "Checking account statement USD" }] },
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }, { x: 580, text: "Balance" }] },
      { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "OPEN" }, { x: 480, text: "+100.00" }, { x: 580, text: "1,000.00" }] },
      { y: 680, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "UNMARKED IN" }, { x: 480, text: "10.00" }, { x: 580, text: "1,010.00" }] },
      { y: 660, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "UNMARKED OUT" }, { x: 480, text: "5.00" }, { x: 580, text: "1,005.00" }] },
    ])], { guidance: guidance() });

    expect(result.balanceBehavior).toBe("running");
    expect(result.transactions.slice(1).map((row) => [row.direction, row.directionEvidence])).toEqual([
      ["credit", "balance"],
      ["debit", "balance"],
    ]);
  });

  it("uses an opening-balance control row to reconcile the first transaction", () => {
    const result = parsePdfStatementPages([page([
      { y: 785, cells: [{ x: 20, text: "Checking account statement USD" }] },
      { y: 760, cells: [{ x: 120, text: "Opening Balance" }, { x: 580, text: "1,000.00" }] },
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }, { x: 580, text: "Balance" }] },
      { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "FIRST" }, { x: 480, text: "10.00" }, { x: 580, text: "1,010.00" }] },
      { y: 680, cells: [{ x: 20, text: "08/02/2026" }, { x: 120, text: "SECOND" }, { x: 480, text: "5.00" }, { x: 580, text: "1,005.00" }] },
      { y: 660, cells: [{ x: 20, text: "08/03/2026" }, { x: 120, text: "THIRD" }, { x: 480, text: "2.00" }, { x: 580, text: "1,007.00" }] },
    ])], { guidance: guidance() });

    expect(result.transactions.map((row) => [row.direction, row.directionEvidence])).toEqual([
      ["credit", "balance"],
      ["debit", "balance"],
      ["credit", "balance"],
    ]);
    expect(result.transactions[0].issueCodes).toContain("BALANCE_RECONCILED");
  });

  it(PDF_FIXTURE_TEST_NAMES.availableBalance, () => {
    const result = parsePdfStatementPages([page([
      { y: 775, cells: [{ x: 20, text: "Checking account statement USD" }] },
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }, { x: 580, text: "Available Balance" }] },
      { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "FIRST" }, { x: 480, text: "10.00" }, { x: 580, text: "1,000.00" }] },
      { y: 680, cells: [{ x: 20, text: "08/02/2026" }, { x: 120, text: "SECOND" }, { x: 480, text: "10.00" }, { x: 580, text: "1,010.00" }] },
      { y: 660, cells: [{ x: 20, text: "08/03/2026" }, { x: 120, text: "THIRD" }, { x: 480, text: "10.00" }, { x: 580, text: "1,020.00" }] },
    ])], { guidance: guidance() });

    expect(result.balanceBehavior).toBe("available");
    expect(result.transactions.every((row) => row.direction === "unknown")).toBe(true);
    expect(result.transactions.every((row) => !row.issueCodes.includes("BALANCE_RECONCILED"))).toBe(true);
  });

  it(PDF_FIXTURE_TEST_NAMES.periodicBalance, () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }, { x: 580, text: "Daily Balance" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON FIRST" }, { x: 480, text: "10.00" }] },
      { y: 680, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SECOND" }, { x: 480, text: "20.00" }] },
      { y: 660, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON THIRD" }, { x: 480, text: "5.00" }, { x: 580, text: "965.00" }] },
    ])], { guidance: guidance() });

    expect(result.balanceBehavior).toBe("periodic");
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions.every((row) => row.direction === "debit")).toBe(true);
    expect(result.transactions.every((row) => row.status === "accepted")).toBe(true);
    expect(result.transactions.every((row) => !row.issueCodes.includes("BALANCE_MISMATCH"))).toBe(true);
  });

  it("preserves negative running-balance signs during reconciliation", () => {
    const result = parsePdfStatementPages([page([
      { y: 775, cells: [{ x: 20, text: "Checking account statement USD" }] },
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }, { x: 580, text: "Balance" }] },
      { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "FIRST" }, { x: 480, text: "10.00" }, { x: 580, text: "-100.00" }] },
      { y: 680, cells: [{ x: 20, text: "08/02/2026" }, { x: 120, text: "SECOND" }, { x: 480, text: "5.00" }, { x: 580, text: "-105.00" }] },
    ])], { guidance: guidance() });

    expect(result.transactions.map((row) => row.balance)).toEqual(["-100.00", "-105.00"]);
    expect(result.transactions[1].issueCodes).toContain("BALANCE_RECONCILED");
    expect(result.transactions[1].issueCodes).not.toContain("BALANCE_MISMATCH");
  });

  it("rejects zero amounts before the reviewed import boundary", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Debit" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON" }, { x: 480, text: "USD 0.00" }] },
    ])], { guidance: guidance() });
    expect(result.transactions[0].status).toBe("rejected");
    expect(result.transactions[0].issueCodes).toContain("AMOUNT_ZERO");
  });

  it("marks duplicate candidates for explicit review and supports explicit acceptance", () => {
    const document = { pages: [page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON" }, { x: 480, text: "USD -12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON" }, { x: 480, text: "USD -12.50" }] },
    ])] };
    const first = parsePdfStatementDocument(document, { guidance: guidance() });
    expect(first.metrics.duplicates).toBe(2);
    const accepted = parsePdfStatementDocument(document, {
      guidance: guidance(),
      corrections: [{ id: "accept", kind: "accept-transaction", scope: "row", createdAt: "2026-01-01T00:00:00.000Z", transactionIds: first.transactions.map((row) => row.id) }],
    });
    expect(accepted.transactions.every((row) => row.status === "accepted")).toBe(true);
    expect(accepted.transactions.every((row) => !row.issueCodes.includes("POSSIBLE_DUPLICATE"))).toBe(true);
  });

  it("revalidates corrected required fields and does not accept an invalid transaction", () => {
    const document = { pages: [page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "NOT A DATE" }, { x: 120, text: "ANON" }, { x: 480, text: "N/A" }] },
    ])] };
    const marked = parsePdfStatementDocument(document, {
      guidance: guidance(),
      corrections: [{ id: "mark", kind: "mark-row", scope: "row", createdAt: "2026-01-01T00:00:00.000Z", rowId: "p1-r1", pageNumber: 1 }],
    });
    const id = marked.transactions[0].id;
    const invalidAcceptance = parsePdfStatementDocument(document, {
      guidance: guidance(),
      corrections: [
        { id: "mark", kind: "mark-row", scope: "row", createdAt: "2026-01-01T00:00:00.000Z", rowId: "p1-r1", pageNumber: 1 },
        { id: "accept", kind: "accept-transaction", scope: "row", createdAt: "2026-01-01T00:00:00.000Z", transactionIds: [id] },
      ],
    });
    expect(invalidAcceptance.transactions[0].status).toBe("rejected");

    const corrected = parsePdfStatementDocument(document, {
      guidance: guidance(),
      corrections: [
        { id: "mark", kind: "mark-row", scope: "row", createdAt: "2026-01-01T00:00:00.000Z", rowId: "p1-r1", pageNumber: 1 },
        { id: "date", kind: "set-field", scope: "row", createdAt: "2026-01-01T00:00:00.000Z", transactionIds: [id], field: "transactionDate", value: "2026-08-15" },
        { id: "import-date", kind: "set-field", scope: "row", createdAt: "2026-01-01T00:00:00.000Z", transactionIds: [id], field: "importDate", value: "2026-08-15" },
        { id: "amount", kind: "set-field", scope: "row", createdAt: "2026-01-01T00:00:00.000Z", transactionIds: [id], field: "amount", value: "25.00" },
        { id: "direction", kind: "set-direction", scope: "row", createdAt: "2026-01-01T00:00:00.000Z", transactionIds: [id], direction: "debit" },
        { id: "accept", kind: "accept-transaction", scope: "row", createdAt: "2026-01-01T00:00:00.000Z", transactionIds: [id] },
      ],
    });
    expect(corrected.transactions[0]).toMatchObject({
      transactionDate: "2026-08-15",
      importDate: "2026-08-15",
      amount: "-25.00",
      direction: "debit",
      status: "accepted",
    });
    expect(corrected.transactions[0].issueCodes).not.toEqual(expect.arrayContaining(["DATE_INVALID", "AMOUNT_MISSING", "DIRECTION_UNRESOLVED"]));
  });

  it("keeps diagnostics privacy-safe", () => {
    const result = parsePdfStatementPages([page([{ y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "SYNTHETIC PRIVATE TEXT" }, { x: 480, text: "USD -12.50" }] }])], { guidance: guidance() });
    expect(diagnosticsArePrivacySafe(result.diagnostics)).toBe(true);
    expect(JSON.stringify(result.diagnostics)).not.toContain("SYNTHETIC PRIVATE TEXT");
  });

  it("keeps the anonymized fixture manifest traceable to the F1-F26 coverage matrix", () => {
    const fixtureIds = PDF_FIXTURE_MANIFEST.map((fixture) => fixture.id);
    const fixtureTestNames = PDF_FIXTURE_MANIFEST.map((fixture) => fixture.testName);
    const coverageIds = PDF_SCHEMA_FAMILY_COVERAGE.map((family) => family.id);

    expect(new Set(fixtureIds).size).toBe(fixtureIds.length);
    expect(new Set(fixtureTestNames)).toEqual(new Set(Object.values(PDF_FIXTURE_TEST_NAMES)));
    expect(coverageIds).toEqual(PDF_SCHEMA_FAMILY_IDS);
    expect(PDF_FIXTURE_MANIFEST.every((fixture) => fixture.challenges.length > 0)).toBe(true);
    expect(Object.fromEntries(["covered", "partial", "pending", "deferred"].map((status) => [
      status,
      PDF_SCHEMA_FAMILY_COVERAGE.filter((family) => family.status === status).length,
    ]))).toEqual({ covered: 19, partial: 4, pending: 2, deferred: 1 });

    const fixturesById = new Map(PDF_FIXTURE_MANIFEST.map((fixture) => [fixture.id, fixture]));
    for (const family of PDF_SCHEMA_FAMILY_COVERAGE) {
      if (family.status === "covered") expect(family.fixtureIds.length).toBeGreaterThan(0);
      if (family.status === "partial") expect(family.fixtureIds.length).toBeGreaterThan(0);
      if (family.status !== "covered") expect(family.remaining).toBeTruthy();
      for (const fixtureId of family.fixtureIds) {
        const fixture = fixturesById.get(fixtureId);
        expect(fixture).toBeDefined();
        expect(fixture?.schemaFamilies).toContain(family.id);
      }
    }

    for (const fixture of PDF_FIXTURE_MANIFEST) {
      for (const familyId of fixture.schemaFamilies) {
        expect(PDF_SCHEMA_FAMILY_COVERAGE.find((family) => family.id === familyId)?.fixtureIds).toContain(fixture.id);
      }
    }
  });
});

describe("PDF parser v2 sign and structure safeguards", () => {
  const checkingWithCardPayment = [
    { y: 775, cells: [{ x: 20, text: "Checking account statement" }] },
    { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }, { x: 580, text: "Balance" }] },
    { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "PAYROLL" }, { x: 480, text: "100.00" }, { x: 580, text: "1,000.00" }] },
    { y: 680, cells: [{ x: 20, text: "08/02/2026" }, { x: 120, text: "CREDIT CARD PAYMENT" }, { x: 480, text: "50.00" }, { x: 580, text: "950.00" }] },
    { y: 660, cells: [{ x: 20, text: "08/03/2026" }, { x: 120, text: "REFUND" }, { x: 480, text: "5.00" }, { x: 580, text: "955.00" }] },
  ];

  it("reads a statement the same way whatever order its columns are listed in", () => {
    // The mapping list keeps its columns in the order the page prints them, so
    // the array the parser receives can be reordered by the reader at any
    // time. Cell division sorts by position itself; this pins that the rest of
    // the parser does not read anything from the array's order either.
    const rows = [
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 420, text: "Amount" }, { x: 540, text: "Balance" }] },
      { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "ANON SHOP" }, { x: 420, text: "-12.50" }, { x: 540, text: "987.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/02/2026" }, { x: 120, text: "ANON CAFE" }, { x: 420, text: "40.00" }, { x: 540, text: "1,027.50" }] },
    ];
    const detected = parsePdfStatementPages([page(rows)], { guidance: guidance() });
    const compare = (result: typeof detected) => result.transactions.map((row) => [
      row.sourceRowNumber, row.importDate, row.amount, row.direction, row.balance, row.status, row.description,
    ]);

    const reversed = parsePdfStatementPages([page(rows)], {
      guidance: { ...detected.guidance, columns: [...detected.guidance.columns].reverse() },
    });
    const sorted = parsePdfStatementPages([page(rows)], {
      guidance: {
        ...detected.guidance,
        columns: [...detected.guidance.columns].sort((left, right) => left.xStart - right.xStart),
      },
    });

    expect(compare(reversed)).toEqual(compare(detected));
    expect(compare(sorted)).toEqual(compare(detected));
  });

  it("reads a printed currency symbol rather than leaving the currency unknown", () => {
    const dollars = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "$ -12.50" }] },
    ])], { guidance: guidance({ currency: undefined }) });

    expect(dollars.guidance.currency).toBe("USD");
    // A dollar sign is shared, so the reading is stated rather than assumed
    // silently, and the "currency not detected" warning is gone.
    expect(dollars.warnings.join(" ")).toContain("read as USD");
    expect(dollars.warnings.join(" ")).not.toContain("currency was not detected");

    const pounds = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "£ -12.50" }] },
    ])], { guidance: guidance({ currency: undefined }) });

    expect(pounds.guidance.currency).toBe("GBP");
    // A pound sign is not shared, so there is nothing to warn about.
    expect(pounds.warnings.join(" ")).not.toContain("read as GBP");
  });

  it("leaves the currency unknown when a statement prints two symbols", () => {
    const mixed = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "$ -12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "ANON EURO" }, { x: 480, text: "€ -8.00" }] },
    ])], { guidance: guidance({ currency: undefined }) });

    expect(mixed.guidance.currency).toBeNull();
    expect(mixed.warnings.join(" ")).toContain("currency was not detected");
  });

  it("reads the account type from the statement heading, not from its transactions", () => {
    const result = parsePdfStatementPages([page(checkingWithCardPayment)], { guidance: guidance() });

    expect(result.accountType).toBe("checking");
    expect(result.transactions.map((row) => [row.description, row.amount])).toEqual(expect.arrayContaining([
      ["CREDIT CARD PAYMENT", "-50.00"],
      ["REFUND", "5.00"],
    ]));
  });

  it("keeps balance-derived directions in review while the account type is only detected", () => {
    const detected = parsePdfStatementPages([page(checkingWithCardPayment)], { guidance: guidance() });
    const derived = detected.transactions.filter((row) => row.directionEvidence === "balance");

    expect(derived.length).toBeGreaterThan(0);
    expect(derived.every((row) => row.status === "review")).toBe(true);
    expect(derived[0].issueCodes).toContain("ACCOUNT_TYPE_UNCONFIRMED");

    const confirmed = parsePdfStatementPages([page(checkingWithCardPayment)], { guidance: guidance({ accountType: "checking" }) });
    const confirmedDerived = confirmed.transactions.filter((row) => row.directionEvidence === "balance");
    expect(confirmedDerived.map((row) => [row.description, row.amount, row.status])).toEqual([
      ["CREDIT CARD PAYMENT", "-50.00", "accepted"],
      ["REFUND", "5.00", "accepted"],
    ]);
  });

  it("refuses to sign balance movement when the heading is ambiguous and nothing is printed", () => {
    const result = parsePdfStatementPages([page([
      { y: 775, cells: [{ x: 20, text: "Checking account statement with a credit card offer" }] },
      ...checkingWithCardPayment.slice(1),
    ])], { guidance: guidance() });

    expect(result.accountType).toBe("unknown");
    expect(result.balancePolarity).toBeNull();
    expect(result.transactions.every((row) => row.direction === "unknown")).toBe(true);
  });

  it("uses printed directions, not the account type, to read the balance column", () => {
    const result = parsePdfStatementPages([page([
      { y: 775, cells: [{ x: 20, text: "Card statement with a linked checking account" }] },
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 400, text: "Debit" }, { x: 480, text: "Credit" }, { x: 580, text: "Balance" }] },
      { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "FIRST" }, { x: 400, text: "10.00" }, { x: 580, text: "990.00" }] },
      { y: 680, cells: [{ x: 20, text: "08/02/2026" }, { x: 120, text: "SECOND" }, { x: 480, text: "20.00" }, { x: 580, text: "1,010.00" }] },
      { y: 660, cells: [{ x: 20, text: "08/03/2026" }, { x: 120, text: "THIRD" }, { x: 400, text: "5.00" }, { x: 580, text: "1,005.00" }] },
    ])], { guidance: guidance() });

    expect(result.balancePolarity).toMatchObject({ direction: "deposit", source: "evidence" });
    expect(result.transactions.every((row) => !row.issueCodes.includes("BALANCE_MISMATCH"))).toBe(true);
  });

  const cardWithPrintedPayment = [
    { y: 770, cells: [{ x: 20, text: "Credit Card Statement" }] },
    { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
    { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "COFFEE" }, { x: 480, text: "4.50" }] },
    { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "PAYMENT THANK YOU" }, { x: 480, text: "-500.00" }] },
  ];

  it("does not read a card issuer's printed minus as money out without confirmation", () => {
    const result = parsePdfStatementPages([page(cardWithPrintedPayment)], { guidance: guidance({ unsignedDirection: "debit" }) });
    const payment = result.transactions.find((row) => row.description.includes("PAYMENT"))!;

    expect(payment.status).toBe("review");
    expect(payment.issueCodes).toContain("SIGN_CONVENTION_UNCONFIRMED");
  });

  it("reads a printed minus as money in once the statement is known to print from the issuer's side", () => {
    const result = parsePdfStatementPages([page(cardWithPrintedPayment)], {
      guidance: guidance({ unsignedDirection: "debit", printedSign: "issuer" }),
    });

    expect(result.transactions.map((row) => [row.description, row.amount, row.status])).toEqual([
      ["COFFEE", "-4.50", "accepted"],
      ["PAYMENT THANK YOU", "500.00", "accepted"],
    ]);
  });

  it("reads a trailing minus as money out", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "SHOP" }, { x: 480, text: "45,00-" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "SALARY" }, { x: 480, text: "900,00" }] },
    ])], { guidance: guidance({ numberFormat: "european", unsignedDirection: "credit" }) });

    expect(result.transactions.map((row) => [row.description, row.amount])).toEqual([
      ["SHOP", "-45.00"],
      ["SALARY", "900.00"],
    ]);
  });

  it("keeps a wrapped description line that reads like a section heading inside its transaction", () => {
    const result = parsePdfStatementPages([page([
      { y: 760, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 735, cells: [{ x: 120, text: "Purchases" }] },
      { y: 710, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "ONLINE BILL" }, { x: 480, text: "10.00" }] },
      { y: 698, cells: [{ x: 120, text: "PAYMENT" }] },
      { y: 680, cells: [{ x: 20, text: "08/02/2026" }, { x: 120, text: "GROCERY" }, { x: 480, text: "20.00" }] },
    ])], { guidance: guidance() });

    expect(result.transactions.map((row) => [row.description, row.amount])).toEqual([
      ["ONLINE BILL PAYMENT", "-10.00"],
      ["GROCERY", "-20.00"],
    ]);
  });

  it("keeps a merchant whose description starts with a control word", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Description" }, { x: 300, text: "Date" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "TOTAL ENERGIES DUBAI" }, { x: 300, text: "08/15/2026" }, { x: 480, text: "-45.00" }] },
      { y: 680, cells: [{ x: 20, text: "CAFE" }, { x: 300, text: "08/16/2026" }, { x: 480, text: "-4.00" }] },
    ])], { guidance: guidance() });

    expect(result.transactions.map((row) => row.description)).toEqual(["TOTAL ENERGIES DUBAI", "CAFE"]);
  });

  it("reports rows inside the transaction area that became no transaction", () => {
    const result = parsePdfStatementPages([
      page([
        { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
        { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "A" }, { x: 480, text: "-1.00" }] },
        { y: 680, cells: [{ x: 20, text: "08/02/2026" }, { x: 120, text: "B" }, { x: 480, text: "-2.00" }] },
        { y: 660, cells: [{ x: 20, text: "08/03/2026" }, { x: 120, text: "C" }, { x: 480, text: "-3.00" }] },
      ], 1),
      page([
        { y: 500, cells: [{ x: 20, text: "3 Aout" }, { x: 120, text: "UNREADABLE DATE ROW" }, { x: 480, text: "-9.00" }] },
        { y: 480, cells: [{ x: 20, text: "08/05/2026" }, { x: 120, text: "D" }, { x: 480, text: "-4.00" }] },
      ], 2),
    ], { guidance: guidance() });

    expect(result.metrics.unassignedRows).toBeGreaterThan(0);
    expect(result.diagnostics.some((event) => event.code === "ROW_UNASSIGNED")).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("did not become a transaction"))).toBe(true);
  });

  it("stops reporting a row once it has been marked as a transaction", () => {
    const pages = [
      page([
        { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
        { y: 700, cells: [{ x: 20, text: "08/01/2026" }, { x: 120, text: "A" }, { x: 480, text: "-1.00" }] },
        { y: 680, cells: [{ x: 20, text: "08/02/2026" }, { x: 120, text: "B" }, { x: 480, text: "-2.00" }] },
        { y: 660, cells: [{ x: 20, text: "08/03/2026" }, { x: 120, text: "C" }, { x: 480, text: "-3.00" }] },
      ], 1),
      page([
        { y: 500, cells: [{ x: 20, text: "3 Aout" }, { x: 120, text: "UNREADABLE DATE ROW" }, { x: 480, text: "-9.00" }] },
        { y: 480, cells: [{ x: 20, text: "08/05/2026" }, { x: 120, text: "D" }, { x: 480, text: "-4.00" }] },
      ], 2),
    ];
    const reported = parsePdfStatementPages(pages, { guidance: guidance() });
    const row = reported.reconstructedPages
      .flatMap((entry) => entry.rows)
      .find((candidate) => candidate.text.includes("UNREADABLE DATE ROW"));
    expect(row).toBeDefined();

    const marked = parsePdfStatementPages(pages, {
      guidance: guidance(),
      corrections: [{
        id: "correction-1",
        kind: "mark-row",
        rowId: row!.id,
        pageNumber: row!.pageNumber,
        scope: "row",
        createdAt: "2026-09-21T00:00:00.000Z",
      }],
    });

    // The reader did the one thing the warning asked for, so it goes.
    expect(marked.metrics.unassignedRows).toBe(reported.metrics.unassignedRows - 1);
    expect(marked.transactions.length).toBe(reported.transactions.length + 1);
  });

  it("keeps a wrapped description that repeats at a page edge", () => {
    const pageWith = (pageNumber: number) => page([
      { y: 780, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 760, cells: [{ x: 20, text: `08/0${pageNumber}/2026` }, { x: 120, text: `SHOP ${pageNumber}` }, { x: 480, text: `-1${pageNumber}.00` }] },
      { y: 110 + pageNumber * 6, cells: [{ x: 20, text: `08/2${pageNumber}/2026` }, { x: 120, text: "ANON MARKETPLACE" }, { x: 480, text: `-3${pageNumber}.00` }] },
      { y: 98 + pageNumber * 6, cells: [{ x: 120, text: "ANON CITY" }] },
    ], pageNumber);
    const result = parsePdfStatementPages([pageWith(1), pageWith(2)], { guidance: guidance() });

    expect(result.transactions.filter((row) => row.description.includes("ANON MARKETPLACE ANON CITY"))).toHaveLength(2);
  });

  it("asks for the statement currency once instead of on every row", () => {
    const rows = [
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "$-12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "ANON CAFE" }, { x: 480, text: "$-4.00" }] },
    ];
    const undeclared = parsePdfStatementPages([page(rows)], { guidance: { ...DEFAULT_PDF_PARSER_GUIDANCE, dateFormat: "mdy" } });

    expect(undeclared.transactions.every((row) => !row.issueCodes.includes("CURRENCY_AMBIGUOUS"))).toBe(true);
    expect(undeclared.warnings.some((warning) => warning.includes("statement currency"))).toBe(true);

    const foreign = parsePdfStatementPages([page([
      ...rows,
      { y: 660, cells: [{ x: 20, text: "08/17/2026" }, { x: 120, text: "ANON TRIP" }, { x: 480, text: "EUR -9.00" }] },
    ])], { guidance: guidance() });
    expect(foreign.transactions.find((row) => row.currency === "EUR")?.issueCodes).toContain("CURRENCY_AMBIGUOUS");
  });

  it("treats an ordinary wrapped description as readable rather than uncertain", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON MARKETPLACE" }, { x: 480, text: "USD -12.50" }] },
      { y: 688, cells: [{ x: 120, text: "ANON CITY" }] },
    ])], { guidance: guidance() });

    expect(result.transactions[0].description).toBe("ANON MARKETPLACE ANON CITY");
    expect(result.transactions[0].issueCodes).not.toContain("ROW_CONTINUATION_UNCERTAIN");
    expect(result.transactions[0].status).toBe("accepted");
  });

  it("reads an unmarked amount as the opposite of the statement's own credit marker", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Total Amount (AED)" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "ANON CAFE" }, { x: 480, text: "4.00" }] },
      { y: 660, cells: [{ x: 20, text: "08/17/2026" }, { x: 120, text: "ANON PAYMENT" }, { x: 480, text: "500.00CR" }] },
    // No currency is supplied, so the statement has to name its own.
    ])], { guidance: { dateFormat: "mdy" } });

    // The statement names its own currency in the amount header.
    expect(result.guidance.currency).toBe("AED");
    expect(result.transactions.map((row) => [row.amount, row.direction, row.directionEvidence, row.status])).toEqual([
      ["-12.50", "debit", "marker-convention", "review"],
      ["-4.00", "debit", "marker-convention", "review"],
      ["500.00", "credit", "marker", "accepted"],
    ]);
  });

  it("does not read a lone debit marker as a convention for the unmarked rows", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "12.50" }] },
      { y: 680, cells: [{ x: 20, text: "08/16/2026" }, { x: 120, text: "ANON CAFE" }, { x: 480, text: "4.00" }] },
      { y: 660, cells: [{ x: 20, text: "08/17/2026" }, { x: 120, text: "ANON INTEREST" }, { x: 480, text: "9.00DR" }] },
    ])], { guidance: guidance() });

    expect(result.transactions.filter((row) => row.direction === "unknown")).toHaveLength(2);
    expect(result.transactions.every((row) => !row.issueCodes.includes("DIRECTION_FROM_MARKER_CONVENTION"))).toBe(true);
  });

  it("maps the account amount when one money column dominates the table", () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      y: 700 - index * 20,
      cells: [
        { x: 20, text: `08/0${index + 1}/2026` },
        { x: 120, text: `ANON ${index}` },
        // A foreign amount appears on a minority of rows; the account amount
        // appears on all of them.
        ...(index < 2 ? [{ x: 300, text: "USD 20.00" }] : []),
        { x: 480, text: `${10 + index}.00` },
      ],
    }));
    const result = parsePdfStatementPages([page(rows)], { guidance: guidance({ unsignedDirection: "debit" }) });

    expect(result.activeSchema?.columns.some((column) => column.role === "amount")).toBe(true);
    expect(result.transactions).toHaveLength(6);
    expect(result.transactions.every((row) => row.amount !== "")).toBe(true);
  });

  it("gives a value that cannot be divided to the column that covers most of it", () => {
    // Money is right-aligned, so a boundary drawn between header labels can
    // cut through the printed number.
    const columns = [
      { id: "date", pageNumber: null, referencePageWidth: 700, xStart: 15, xEnd: 100, role: "transaction-date" as const, header: null, examples: [], confidence: 1 },
      { id: "details", pageNumber: null, referencePageWidth: 700, xStart: 100, xEnd: 236, role: "description" as const, header: null, examples: [], confidence: 1 },
      { id: "out", pageNumber: null, referencePageWidth: 700, xStart: 236, xEnd: 370, role: "debit" as const, header: null, examples: [], confidence: 1 },
      { id: "in", pageNumber: null, referencePageWidth: 700, xStart: 370, xEnd: 479, role: "credit" as const, header: null, examples: [], confidence: 1 },
      { id: "bal", pageNumber: null, referencePageWidth: 700, xStart: 479, xEnd: 575, role: "balance" as const, header: null, examples: [], confidence: 1 },
    ];
    const result = parsePdfStatementPages([page([
      // The amount runs from 340 to 379, so it sits across the money-out and
      // money-in boundary at 370 with more of it on the money-out side.
      { y: 700, cells: [{ x: 20, text: "21/02/2026" }, { x: 105, text: "ANON TRANSFER" }, { x: 340, text: "1,000.00" }, { x: 500, text: "2,009.88" }] },
      { y: 680, cells: [{ x: 20, text: "22/02/2026" }, { x: 105, text: "ANON DEPOSIT" }, { x: 430, text: "500.00" }, { x: 500, text: "2,509.88" }] },
    ])], { guidance: guidance({ columns, dateFormat: "dmy", accountType: "checking" }) });

    expect(result.transactions.map((row) => [row.amount, row.direction])).toEqual([
      ["-1000.00", "debit"],
      ["500.00", "credit"],
    ]);
    expect(result.transactions.every((row) => !row.issueCodes.includes("AMOUNT_DEBIT_CREDIT_CONFLICT"))).toBe(true);
  });

  it("starts a transaction for an undated row whose description prints a date", () => {
    const result = parsePdfStatementPages([page([
      { y: 760, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Transaction Details" }, { x: 360, text: "Debits" }, { x: 450, text: "Credits" }, { x: 520, text: "Balance" }] },
      { y: 720, cells: [{ x: 20, text: "21/02/2026" }, { x: 120, text: "ANON TRANSFER" }, { x: 360, text: "100.00" }, { x: 520, text: "900.00" }] },
      // A second transaction on the same day: the statement prints the date
      // once, and this row carries a date only inside its own narrative.
      { y: 700, cells: [{ x: 120, text: "ANON PAYMENT VALUE 20 FEB" }, { x: 360, text: "250.00" }, { x: 520, text: "650.00" }] },
      { y: 680, cells: [{ x: 20, text: "22/02/2026" }, { x: 120, text: "ANON DEPOSIT" }, { x: 450, text: "50.00" }, { x: 520, text: "700.00" }] },
    ])], { guidance: guidance({ dateFormat: "dmy", accountType: "checking" }) });

    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[1]).toMatchObject({ amount: "-250.00", transactionDate: "2026-02-21" });
    expect(result.transactions[1].description).toContain("ANON PAYMENT");
    expect(result.transactions[0].description).not.toContain("ANON PAYMENT");
    expect(result.transactions[1].issueCodes).toContain("DATE_INHERITED_FROM_PREVIOUS_ROW");
  });

  it("divides one cell between the columns that claim it", () => {
    // Extraction gives both dates and the description as a single cell when a
    // statement prints them tightly together.
    const columns = [
      { id: "date", pageNumber: null, referencePageWidth: 700, xStart: 15, xEnd: 78, role: "transaction-date" as const, header: null, examples: [], confidence: 1 },
      { id: "value", pageNumber: null, referencePageWidth: 700, xStart: 78, xEnd: 138, role: "value-date" as const, header: null, examples: [], confidence: 1 },
      { id: "details", pageNumber: null, referencePageWidth: 700, xStart: 138, xEnd: 430, role: "description" as const, header: null, examples: [], confidence: 1 },
      { id: "out", pageNumber: null, referencePageWidth: 700, xStart: 440, xEnd: 560, role: "debit" as const, header: null, examples: [], confidence: 1 },
    ];
    const result = parsePdfStatementPages([page([
      { y: 700, cells: [{ x: 20, text: "17 Jun 19 16 Jun 19 ATM WITHDRAWAL SELF" }, { x: 470, text: "1,500.00" }] },
      { y: 680, cells: [{ x: 20, text: "19 Jun 19 18 Jun 19 ANON SHOP PAYMENT" }, { x: 470, text: "2,000.00" }] },
    ])], { guidance: guidance({ columns, dateFormat: "dmy-name", importDate: "transaction" }) });

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      transactionDate: "2019-06-17",
      valueDate: "2019-06-16",
      amount: "-1500.00",
    });
    // Each column reports its own value: the dates are no longer repeated
    // inside the description.
    expect(result.transactions[0].description).toBe("ATM WITHDRAWAL SELF");
    expect(result.transactions[1].description).toBe("ANON SHOP PAYMENT");
  });

  it("leaves a cell that only one column claims exactly as it was", () => {
    const result = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP AND CAFE" }, { x: 480, text: "USD -12.50" }] },
    ])], { guidance: guidance() });

    expect(result.transactions[0].description).toBe("ANON SHOP AND CAFE");
    expect(result.transactions[0].amount).toBe("-12.50");
  });

  it("does not let a reference and the next cell's amount fabricate a date", () => {
    const result = parsePdfStatementPages([page([
      { y: 760, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 360, text: "Deposit" }, { x: 440, text: "Withdrawal" }, { x: 520, text: "Balance" }] },
      { y: 720, cells: [{ x: 20, text: "18 Jun 19" }, { x: 120, text: "ANON PURCHASE" }, { x: 440, text: "966.00" }, { x: 520, text: "111,523.14" }] },
      { y: 700, cells: [{ x: 120, text: "ANON CITY IN 13:44:16" }] },
      // The reference is cut off mid-date. Joined with the amount beside it,
      // "2019-06-" and "1,035.49" read as 2019-06-1, which used to stop this
      // row becoming the transaction it is.
      { y: 680, cells: [{ x: 120, text: "CRADJ/UPI/ANON/916616736180/2019-06-" }, { x: 360, text: "1,035.49" }, { x: 520, text: "112,558.63" }] },
      { y: 660, cells: [{ x: 20, text: "19 Jun 19" }, { x: 120, text: "ANON WITHDRAWAL" }, { x: 440, text: "2,000.00" }, { x: 520, text: "110,558.63" }] },
    ])], { guidance: guidance({ dateFormat: "dmy-name", currency: "INR" }) });

    expect(result.transactions.map((row) => [row.amount, row.direction])).toEqual([
      ["-966.00", "debit"],
      ["1035.49", "credit"],
      ["-2000.00", "debit"],
    ]);
    // The adjustment keeps its own description rather than joining the purchase.
    expect(result.transactions[0].description).toContain("ANON PURCHASE");
    expect(result.transactions[0].description).not.toContain("CRADJ");
    expect(result.transactions[1].description).toContain("CRADJ");
    expect(result.transactions[0].issueCodes).not.toContain("AMOUNT_DEBIT_CREDIT_CONFLICT");
  });

  it("keeps a lead description line with the transaction whose date follows it", () => {
    // Some statements print the date on the second line of a transaction and
    // separate transactions with a printed rule.
    const result = parsePdfStatementPages([page([
      { y: 760, cells: [{ x: 20, text: "Transaction Date" }, { x: 110, text: "Posting Date" }, { x: 200, text: "Description" }, { x: 480, text: "Total Amount" }] },
      { y: 730, cells: [{ x: 200, text: "FIRST MERCHANT" }, { x: 480, text: "10.00" }] },
      { y: 721, cells: [{ x: 20, text: "01/08/2026" }, { x: 110, text: "02/08/2026" }] },
      { y: 712, cells: [{ x: 200, text: "FIRST DETAIL" }] },
      { y: 704, cells: [{ x: 110, text: "-" }] },
      { y: 695, cells: [{ x: 200, text: "SECOND MERCHANT" }] },
      { y: 686, cells: [{ x: 20, text: "03/08/2026" }, { x: 110, text: "04/08/2026" }, { x: 200, text: "SECOND DETAIL" }] },
      { y: 677, cells: [{ x: 200, text: "SECOND EXTRA" }, { x: 480, text: "20.00" }] },
      { y: 669, cells: [{ x: 110, text: "-" }] },
    ])], { guidance: guidance({ dateFormat: "dmy", unsignedDirection: "debit" }) });

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({ transactionDate: "2026-08-01", amount: "-10.00" });
    expect(result.transactions[0].description).toContain("FIRST MERCHANT");
    expect(result.transactions[0].description).not.toContain("SECOND MERCHANT");
    expect(result.transactions[1]).toMatchObject({ transactionDate: "2026-08-03", amount: "-20.00" });
    expect(result.transactions[1].description).toContain("SECOND MERCHANT");
    // The printed rule between transactions is not statement content.
    expect(result.transactions.every((row) => !row.raw.lines.some((line) => line.trim() === "-"))).toBe(true);
  });

  it("keeps the printed column header out of the transactions it names", () => {
    const statementPage = (pageNumber: number) => page([
      { y: 770, cells: [{ x: 20, text: "Transaction Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 740, cells: [{ x: 20, text: `08/0${pageNumber}/2026` }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "-10.00" }] },
      { y: 720, cells: [{ x: 20, text: `08/1${pageNumber}/2026` }, { x: 120, text: "ANON CAFE" }, { x: 480, text: "-20.00" }] },
    ], pageNumber);
    const result = parsePdfStatementPages([statementPage(1), statementPage(2)], { guidance: guidance() });

    // The header still names the columns...
    expect(result.activeSchema?.columns.map((column) => column.role))
      .toEqual(expect.arrayContaining(["transaction-date", "description", "amount"]));
    // ...without becoming part of any transaction.
    expect(result.transactions).toHaveLength(4);
    expect(result.transactions.every((row) => !/Transaction Date|Description|Amount/.test(row.description))).toBe(true);
    expect(result.transactions.every((row) => row.raw.lines.length === 1)).toBe(true);
  });

  it("keeps a page footer out of the transaction area", () => {
    const statementPage = (pageNumber: number) => page([
      { y: 760, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 730, cells: [{ x: 20, text: `08/0${pageNumber}/2026` }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "-10.00" }] },
      { y: 710, cells: [{ x: 20, text: `08/1${pageNumber}/2026` }, { x: 120, text: "ANON CAFE" }, { x: 480, text: "-20.00" }] },
      { y: 60, cells: [{ x: 300, text: `Page ${pageNumber} of 2` }] },
    ], pageNumber);
    const result = parsePdfStatementPages([statementPage(1), statementPage(2)], { guidance: guidance() });

    const areaRowIds = new Set(result.regions
      .filter((region) => region.kind === "transactions" && region.included)
      .flatMap((region) => region.rowIds));
    const footerRows = result.reconstructedPages
      .flatMap((entry) => entry.rows)
      .filter((row) => row.text.startsWith("Page "));

    expect(footerRows).toHaveLength(2);
    expect(footerRows.every((row) => !areaRowIds.has(row.id))).toBe(true);
    expect(result.transactions).toHaveLength(4);
    expect(result.transactions.every((row) => !row.description.includes("Page"))).toBe(true);
  });

  it("keeps reading the transaction table after a summary page interrupts it", () => {
    const summary = (pageNumber: number) => page([
      { y: 770, cells: [{ x: 20, text: "Checking account statement" }] },
      { y: 700, cells: [{ x: 20, text: "Opening balance" }, { x: 480, text: "1,000.00" }] },
    ], pageNumber);
    const table = (pageNumber: number, day: number, rows: number) => page([
      { y: 760, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      ...Array.from({ length: rows }, (_, index) => ({
        y: 730 - index * 20,
        cells: [
          { x: 20, text: `08/${String(day + index).padStart(2, "0")}/2026` },
          { x: 120, text: `ANON ${index}` },
          { x: 480, text: `-${10 + index}.00` },
        ],
      })),
    ], pageNumber);
    const result = parsePdfStatementPages([summary(1), table(2, 1, 3), summary(3), table(4, 10, 2)], { guidance: guidance() });

    expect(result.regions.filter((region) => region.kind === "transactions" && region.included).map((region) => region.pageNumber))
      .toEqual([2, 4]);
    expect(result.transactions).toHaveLength(5);
  });

  it("stores a manually corrected amount in the parser's own format", () => {
    const document = { pages: [page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON" }, { x: 480, text: "USD -12.50" }] },
    ])] };
    const first = parsePdfStatementDocument(document, { guidance: guidance() });
    const corrected = parsePdfStatementDocument(document, {
      guidance: guidance(),
      corrections: [{
        id: "amount",
        kind: "set-field",
        scope: "row",
        createdAt: "2026-01-01T00:00:00.000Z",
        transactionIds: [first.transactions[0].id],
        field: "amount",
        value: "-1 234,50",
      }],
    });

    expect(corrected.transactions[0].amount).toBe("-1234.50");
    expect(parsePdfMoneyToMinorUnits(corrected.transactions[0].amount)).toBe(-123450);
  });
});

describe("PDF layout profiles", () => {
  it("recognizes its own statement however much the mapping was corrected", () => {
    const rows = [
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 200, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 200, text: "ANON SHOP" }, { x: 480, text: "-12.50" }] },
    ];
    const detected = parsePdfStatementPages([page(rows)], { guidance: guidance() });
    // A layout is saved after its mapping has been put right, which is the
    // whole point of saving one. Matching used to compare those corrections
    // against bare detection, so the corrections themselves counted against
    // the layout; the statement's own header does not move when they are made.
    const corrected = createPdfLayoutProfile({
      id: "layout-1",
      name: "Corrected",
      result: {
        ...detected,
        guidance: {
          ...detected.guidance,
          columns: [
            ...detected.guidance.columns,
            { ...detected.guidance.columns[0], id: "added-value-date", role: "value-date" },
            { ...detected.guidance.columns[0], id: "added-reference", role: "reference" },
            { ...detected.guidance.columns[0], id: "added-balance", role: "balance" },
          ],
        },
      },
    });

    const match = matchPdfLayoutProfile(corrected, detected);

    expect(match.outcome).toBe("strong");
  });

  it("does not recognize a layout saved from another bank's table", () => {
    const detected = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 200, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 200, text: "ANON SHOP" }, { x: 480, text: "-12.50" }] },
    ])], { guidance: guidance() });
    const elsewhere = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 30, text: "Buchungstag" }, { x: 210, text: "Verwendungszweck" }, { x: 470, text: "Betrag EUR" }] },
      { y: 700, cells: [{ x: 30, text: "15/08/2026" }, { x: 210, text: "ANON LADEN" }, { x: 470, text: "-12,50" }] },
    ])], { guidance: guidance({ dateFormat: "dmy", currency: "EUR", numberFormat: "european" }) });

    const match = matchPdfLayoutProfile(
      createPdfLayoutProfile({ id: "layout-2", name: "Elsewhere", result: elsewhere }),
      detected
    );

    expect(match.outcome).toBe("conflicting");
  });

  it("carries no statement text into the signature it saves", () => {
    const detected = parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Transaction Date" }, { x: 200, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 200, text: "ANON SHOP" }, { x: 480, text: "-12.50" }] },
    ])], { guidance: guidance() });

    const serialized = JSON.stringify(detected.detectionSignature);

    expect(serialized).not.toContain("ANON SHOP");
    expect(serialized).not.toContain("Transaction");
    expect(serialized).not.toContain("12.50");
    // Letters and digits are masked, so only the shape of the header survives.
    expect(serialized).toContain("A");
  });

  function parsedWithDescription(description: string) {
    return parsePdfStatementPages([page([
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: description }, { x: 480, text: "USD -12.50" }] },
    ])], { guidance: guidance() });
  }

  it("matches the same layout when transaction data changes and stores no source text", () => {
    const original = parsedWithDescription("ANON SHOP");
    const profile = createPdfLayoutProfile({ id: "profile-1", name: "Card layout", result: original });
    const changedData = parsedWithDescription("OTHER SHOP");
    expect(matchPdfLayoutProfile(profile, changedData).outcome).toBe("strong");
    expect(JSON.stringify(profile)).not.toContain("ANON SHOP");
    // A layout describes a table: no period, no transaction areas, and bounds
    // as fractions of the page rather than points on one particular page.
    expect(profile).not.toHaveProperty("guidance");
    expect(JSON.stringify(profile)).not.toContain("statementPeriod");
    expect(JSON.stringify(profile)).not.toContain("regions");
    expect(profile.reading.columns.every((column) => column.xStart >= 0 && column.xEnd <= 1)).toBe(true);
  });

  it("reads transaction pages the saved layout never saw", () => {
    const summary = (pageNumber: number) => page([
      { y: 770, cells: [{ x: 20, text: "Checking account statement" }] },
      { y: 700, cells: [{ x: 20, text: "Opening balance" }, { x: 480, text: "1,000.00" }] },
    ], pageNumber);
    const table = (pageNumber: number, day: number) => page([
      { y: 760, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      ...Array.from({ length: 3 }, (_, index) => ({
        y: 730 - index * 20,
        cells: [
          { x: 20, text: `08/${String(day + index).padStart(2, "0")}/2026` },
          { x: 120, text: `ANON ${index}` },
          { x: 480, text: `-${10 + index}.00` },
        ],
      })),
    ], pageNumber);

    const lastMonth = parsePdfStatementPages([summary(1), table(2, 1)], { guidance: guidance() });
    const layout = createPdfLayoutProfile({ id: "profile-1", name: "Checking", result: lastMonth });

    // This month the same table runs onto pages the layout has never seen.
    const thisMonth = parsePdfStatementPages([summary(1), table(2, 1), table(3, 10), table(4, 20)], { guidance: guidance() });
    const applied = parsePdfStatementPages([summary(1), table(2, 1), table(3, 10), table(4, 20)], {
      guidance: guidanceFromPdfLayoutProfile(layout, thisMonth),
    });

    expect(applied.regions.filter((region) => region.kind === "transactions" && region.included).map((region) => region.pageNumber))
      .toEqual([2, 3, 4]);
    expect(applied.transactions).toHaveLength(9);
  });

  it("keeps automatic detection available after a layout is applied", () => {
    const rows = [
      { y: 740, cells: [{ x: 20, text: "Date" }, { x: 120, text: "Description" }, { x: 480, text: "Amount" }] },
      { y: 700, cells: [{ x: 20, text: "08/15/2026" }, { x: 120, text: "ANON SHOP" }, { x: 480, text: "USD -12.50" }] },
    ];
    const detected = parsePdfStatementPages([page(rows)], { guidance: guidance() });
    const layout = createPdfLayoutProfile({ id: "profile-1", name: "Card layout", result: detected });
    const applied = parsePdfStatementPages([page(rows)], {
      guidance: { ...guidanceFromPdfLayoutProfile(layout, detected), regions: [] },
    });

    // `detectedGuidance` is what Reset detection returns to, so it has to stay
    // the automatic answer rather than echoing the applied layout.
    expect(applied.detectedGuidance.regions.length).toBeGreaterThan(0);
    expect(applied.detectedGuidance.accountType).toBe("auto");
  });

  it("reports moved amount-column geometry as layout drift", () => {
    const original = parsedWithDescription("ANON SHOP");
    const profile = createPdfLayoutProfile({ id: "profile-1", name: "Card layout", result: original });
    const shifted = parsedWithDescription("OTHER SHOP");
    // Without a header on either side the table's shape is the only evidence,
    // and a financial column that has moved is drift whatever else aligns.
    const headerless = {
      ...shifted,
      detectionSignature: { ...shifted.detectionSignature, header: [] },
      activeSchema: shifted.activeSchema && {
        ...shifted.activeSchema,
        columns: shifted.activeSchema.columns.map((column) => column.role === "amount"
          ? { ...column, xStart: column.xStart - 100, xEnd: column.xEnd - 100 }
          : column),
      },
    };
    const match = matchPdfLayoutProfile({ ...profile, signature: { ...profile.signature, header: [] } }, headerless);
    expect(match.drift).toBe(true);
    expect(match.outcome).not.toBe("strong");
  });

  it("allow-lists persisted layout fields and drops injected source content", () => {
    const profile = createPdfLayoutProfile({
      id: "profile-1",
      name: "Card layout",
      result: parsedWithDescription("ANON SHOP"),
    });
    const safe = sanitizePdfLayoutProfileEnvelope({
      kind: "pdf-layout-v3",
      statementText: "PRIVATE TRANSACTION",
      profile: {
        ...profile,
        transactionText: "PRIVATE TRANSACTION",
        reading: { ...profile.reading, extractedText: "PRIVATE TRANSACTION" },
      },
    });

    expect(safe).not.toBeNull();
    expect(JSON.stringify(safe)).not.toContain("PRIVATE TRANSACTION");

    // A header shape that still carries letters or digits is statement text
    // wearing the shape's name, so the whole layout is refused.
    expect(sanitizePdfLayoutProfileEnvelope({
      kind: "pdf-layout-v3",
      profile: {
        ...profile,
        signature: { ...profile.signature, header: [{ shape: "ANON SHOP", x: 1, width: 2 }] },
      },
    })).toBeNull();

    // So is a column that claims a place outside the page.
    expect(sanitizePdfLayoutProfileEnvelope({
      kind: "pdf-layout-v3",
      profile: {
        ...profile,
        reading: { ...profile.reading, columns: [{ ...profile.reading.columns[0], xEnd: 42 }] },
      },
    })).toBeNull();
  });

  it("keeps the current statement period when applying a reusable layout", () => {
    const original = parsedWithDescription("ANON SHOP");
    const profile = createPdfLayoutProfile({ id: "profile-1", name: "Card layout", result: original });
    const current = parsePdfStatementPages(original.document.pages, {
      guidance: {
        ...original.guidance,
        statementPeriod: { start: "2026-09-01", end: "2026-09-30" },
      },
    });

    expect(guidanceFromPdfLayoutProfile(profile, current).statementPeriod).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
  });
});

describe("reviewed PDF normalization", () => {
  it("preserves the selected import date and signed amount at the existing boundary", () => {
    const normalized = normalizeReviewedPdfStatement([{ sourceRowNumber: 1, transactionDate: "2026-08-02", postedDate: "2026-08-03", importDate: "2026-08-03", description: "ANON MERCHANT", amount: "-15.00", raw: { pageNumber: 1, lines: ["anonymized source"], sourceIds: ["p1-i1"] } }], (index) => `row-${index}`);
    expect(normalized.rows[0]).toMatchObject({ postedDate: "2026-08-03", amount: -1500, importedPayee: "ANON MERCHANT", transactionDate: "2026-08-02" });
  });
});
