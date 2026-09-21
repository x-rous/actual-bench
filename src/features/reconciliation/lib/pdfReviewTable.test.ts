import type { PdfStatementParseResult, PdfTransactionProposal } from "@/lib/reconciliation/statement/pdf";
import {
  columnRoleLabel,
  csvFileNameFor,
  formatDateInput,
  formatGroupedDecimal,
  matchesCategory,
  matchesSearch,
  minorUnits,
  newColumnBounds,
  nextSortState,
  normalizeTableAmountInput,
  parseDateInput,
  regionKindLabel,
  sortColumnsByPosition,
  columnBoundsAfter,
  resultDiff,
  sortTransactions,
  transactionTotals,
} from "./pdfReviewTable";

function transaction(patch: Partial<PdfTransactionProposal> & { id: string }): PdfTransactionProposal {
  return {
    sourceRowNumber: 1,
    status: "accepted",
    description: "ANON ROW",
    reference: null,
    amount: "-10.00",
    currency: "USD",
    direction: "debit",
    directionEvidence: "sign",
    transactionDate: "2026-08-15",
    postedDate: null,
    valueDate: null,
    importDate: "2026-08-15",
    balance: null,
    exactAmount: null,
    originalAmount: null,
    exchangeRate: null,
    fees: [],
    vat: [],
    issueCodes: [],
    confidence: {},
    raw: { pageNumber: 1, lines: [], sourceIds: [] },
    ...patch,
  } as unknown as PdfTransactionProposal;
}

function parseResult(transactions: PdfTransactionProposal[]): PdfStatementParseResult {
  return {
    transactions,
    metrics: {
      accepted: transactions.filter((row) => row.status === "accepted").length,
      review: transactions.filter((row) => row.status === "review").length,
      rejected: transactions.filter((row) => row.status === "rejected").length,
    },
  } as unknown as PdfStatementParseResult;
}

describe("pdfReviewTable", () => {
  describe("sorting", () => {
    it("keeps rows with nothing to compare at the end in both directions", () => {
      const rows = [
        transaction({ id: "a", sourceRowNumber: 1, balance: "50.00" }),
        transaction({ id: "b", sourceRowNumber: 2, balance: null }),
        transaction({ id: "c", sourceRowNumber: 3, balance: "10.00" }),
      ];

      expect(sortTransactions(rows, { key: "balance", direction: "asc" }).map((row) => row.id))
        .toEqual(["c", "a", "b"]);
      expect(sortTransactions(rows, { key: "balance", direction: "desc" }).map((row) => row.id))
        .toEqual(["a", "c", "b"]);
    });

    it("falls back to the statement's own order for rows the sort cannot separate", () => {
      const rows = [
        transaction({ id: "second", sourceRowNumber: 2, description: "SAME" }),
        transaction({ id: "first", sourceRowNumber: 1, description: "SAME" }),
      ];

      expect(sortTransactions(rows, { key: "description", direction: "desc" }).map((row) => row.id))
        .toEqual(["first", "second"]);
    });

    it("sorts amounts by value rather than by text", () => {
      const rows = [
        transaction({ id: "small", amount: "-9.00" }),
        transaction({ id: "large", amount: "-100.00" }),
      ];

      expect(sortTransactions(rows, { key: "amount", direction: "asc" }).map((row) => row.id))
        .toEqual(["large", "small"]);
    });

    it("returns to the statement order on the third selection", () => {
      expect(nextSortState(null, "amount", "asc")).toEqual({ key: "amount", direction: "asc" });
      expect(nextSortState({ key: "amount", direction: "asc" }, "amount", "desc"))
        .toEqual({ key: "amount", direction: "desc" });
      expect(nextSortState({ key: "amount", direction: "desc" }, "amount", null)).toBeNull();
    });
  });

  describe("views", () => {
    it("puts a row in the view its reason belongs to, and never files a ready row as an issue", () => {
      const dateIssue = transaction({ id: "date", status: "review", issueCodes: ["DATE_AMBIGUOUS_ORDER"] as never });
      const accepted = transaction({ id: "ready", issueCodes: ["DATE_AMBIGUOUS_ORDER"] as never });

      expect(matchesCategory(dateIssue, "dates")).toBe(true);
      expect(matchesCategory(dateIssue, "needs-review")).toBe(true);
      expect(matchesCategory(accepted, "dates")).toBe(false);
      expect(matchesCategory(accepted, "ready")).toBe(true);
    });

    it("counts a manual change as its own view rather than as a structural issue", () => {
      const manual = transaction({ id: "manual", issueCodes: ["ROW_MANUALLY_CHANGED"] as never });

      expect(matchesCategory(manual, "manual")).toBe(true);
      expect(matchesCategory(manual, "structure")).toBe(false);
    });

    it("searches the description, the amount, and the import date", () => {
      const row = transaction({ id: "row", description: "ANON SHOP", amount: "-12.50", importDate: "2026-08-15" });

      expect(matchesSearch(row, "anon")).toBe(true);
      expect(matchesSearch(row, "12.50")).toBe(true);
      expect(matchesSearch(row, "2026-08")).toBe(true);
      expect(matchesSearch(row, "elsewhere")).toBe(false);
    });
  });

  describe("money", () => {
    it("reads minor units from an exact decimal string", () => {
      expect(minorUnits("-12.50")).toBe(-1250);
      expect(minorUnits("7")).toBe(700);
      expect(minorUnits("not money")).toBe(0);
    });

    it("groups thousands without inventing precision", () => {
      expect(formatGroupedDecimal("112953.65")).toBe("112,953.65");
      expect(formatGroupedDecimal("-6000")).toBe("-6,000");
    });

    it("accepts a grouped amount back from the table", () => {
      expect(normalizeTableAmountInput("7,500.00")).toBe("7500.00");
      expect(normalizeTableAmountInput("-1,234.56")).toBe("-1234.56");
      // Not a grouped number: left alone for the parser to reject.
      expect(normalizeTableAmountInput("12,3")).toBe("12,3");
    });

    it("totals credits and debits separately", () => {
      const totals = transactionTotals([
        transaction({ id: "in", amount: "40.00" }),
        transaction({ id: "out", amount: "-12.50" }),
      ]);

      expect(totals).toEqual({ credits: 4000, debits: 1250 });
    });
  });

  describe("resultDiff", () => {
    it("reports a changed row once, even when its block id changed", () => {
      const before = parseResult([
        transaction({ id: "block-p1-r4", description: "ANON SHOP", amount: "-12.50" }),
        transaction({ id: "block-p1-r5", description: "ANON CAFE", amount: "-4.00" }),
      ]);
      // The area now starts a row earlier, so both blocks have new anchors and
      // the first row's amount was read differently.
      const after = parseResult([
        transaction({ id: "block-p1-r3", description: "ANON SHOP", amount: "-12.50" }),
        transaction({ id: "block-p1-r4", description: "ANON CAFE", amount: "-4.00" }),
      ]);

      const diff = resultDiff(before, after);

      expect(diff.added).toBe(0);
      expect(diff.removed).toBe(0);
      expect(diff.amounts).toBe(0);
    });

    it("counts a genuinely new transaction as added", () => {
      const before = parseResult([transaction({ id: "a", description: "ANON SHOP" })]);
      const after = parseResult([
        transaction({ id: "a", description: "ANON SHOP" }),
        transaction({ id: "b", description: "ANON CAFE", amount: "-4.00" }),
      ]);

      const diff = resultDiff(before, after);

      expect(diff.added).toBe(1);
      expect(diff.removed).toBe(0);
      expect(diff.after - diff.before).toBe(1);
    });

    it("names the fields that changed on a row that stayed", () => {
      const before = parseResult([transaction({ id: "a", description: "ANON SHOP", transactionDate: "2026-08-15" })]);
      const after = parseResult([transaction({ id: "a", description: "ANON SHOP", transactionDate: "2026-08-16" })]);

      const diff = resultDiff(before, after);

      expect(diff.dates).toBe(1);
      expect(diff.descriptions).toBe(0);
      expect(diff.added + diff.removed).toBe(0);
    });

    it("does not pair two different rows that merely lost their ids", () => {
      const before = parseResult([transaction({ id: "a", description: "ANON SHOP", amount: "-12.50" })]);
      const after = parseResult([transaction({ id: "b", description: "ANON OTHER", amount: "-99.00" })]);

      const diff = resultDiff(before, after);

      expect(diff.added).toBe(1);
      expect(diff.removed).toBe(1);
    });

    it("reports the net change the review table would show", () => {
      const before = parseResult([transaction({ id: "a", amount: "-12.50" })]);
      const after = parseResult([transaction({ id: "a", amount: "12.50" })]);

      const diff = resultDiff(before, after);

      expect(diff.beforeNet).toBe(-1250);
      expect(diff.afterNet).toBe(1250);
    });
  });

  describe("date fields", () => {
    it("shows a stored date the way the workbench writes dates", () => {
      expect(formatDateInput("2026-09-21")).toBe("21/09/2026");
      expect(formatDateInput(null)).toBe("");
    });

    it("takes a typed date back, and a pasted ISO one", () => {
      expect(parseDateInput("21/09/2026")).toBe("2026-09-21");
      expect(parseDateInput("1/9/2026")).toBe("2026-09-01");
      expect(parseDateInput("21-09-2026")).toBe("2026-09-21");
      expect(parseDateInput("2026-09-21")).toBe("2026-09-21");
      expect(parseDateInput("  ")).toBeNull();
    });

    it("refuses a date that does not exist rather than rolling it forward", () => {
      expect(parseDateInput("31/02/2026")).toBeNull();
      expect(parseDateInput("21/13/2026")).toBeNull();
      expect(parseDateInput("09/21/2026")).toBeNull();
      expect(parseDateInput("not a date")).toBeNull();
    });
  });

  describe("labels", () => {
    it("gives a column role the same name everywhere it appears", () => {
      expect(columnRoleLabel("debit")).toBe("Money out");
      expect(columnRoleLabel("credit")).toBe("Money in");
      expect(columnRoleLabel("transaction-date")).toBe("Transaction date");
      expect(columnRoleLabel("original-currency")).toBe("Original currency");
    });

    it("names a region kind in words", () => {
      expect(regionKindLabel("transactions")).toBe("Transactions");
      expect(regionKindLabel("installments")).toBe("Installments");
    });

    it("names the export after the statement, not after a path", () => {
      expect(csvFileNameFor("march-statement.pdf")).toBe("march-statement.csv");
      expect(csvFileNameFor("folder/statement.PDF")).toBe("folder-statement.csv");
      expect(csvFileNameFor("  ")).toBe("pdf-statement.csv");
    });
  });

  describe("column order", () => {
    const column = (id: string, xStart: number, xEnd: number, referencePageWidth = 700) =>
      ({ id, pageNumber: null, referencePageWidth, xStart, xEnd, role: "ignore" }) as never;

    it("reads the mappings in the order the page prints them", () => {
      const ordered = sortColumnsByPosition([
        column("amount", 480, 560),
        column("date", 20, 90),
        column("description", 120, 400),
      ]);

      expect(ordered.map((entry) => entry.id)).toEqual(["date", "description", "amount"]);
    });

    it("compares columns saved against different page widths on the same scale", () => {
      const ordered = sortColumnsByPosition([
        // Half way across a 1400-unit page.
        column("wide-page-middle", 700, 800, 1400),
        // A third of the way across a 700-unit one.
        column("narrow-page-third", 233, 300, 700),
      ]);

      expect(ordered.map((entry) => entry.id)).toEqual(["narrow-page-third", "wide-page-middle"]);
    });
  });

  describe("columnBoundsAfter", () => {
    const column = (id: string, xStart: number, xEnd: number) =>
      ({ id, pageNumber: null, referencePageWidth: 700, xStart, xEnd, role: "ignore" }) as never;

    it("puts a new column in the gap after the one chosen", () => {
      const bounds = columnBoundsAfter(
        [column("a", 20, 90), column("b", 300, 400)],
        "a",
        1,
        700
      );

      expect(bounds.xStart).toBeGreaterThanOrEqual(90);
      expect(bounds.xEnd).toBeLessThanOrEqual(300);
    });

    it("still lands between the two when they leave no room", () => {
      const bounds = columnBoundsAfter([column("a", 20, 94), column("b", 96, 400)], "a", 1, 700);

      // What decides where it appears in the list is where it starts, so that
      // stays between the two columns even when the gap cannot hold it.
      expect(bounds.xStart).toBeGreaterThan(20);
      expect(bounds.xStart).toBeLessThan(96);
    });

    it("falls back to the end of the row for the last column", () => {
      const bounds = columnBoundsAfter([column("a", 20, 90)], "a", 1, 700);

      expect(bounds.xStart).toBeGreaterThan(90);
    });
  });

  describe("newColumnBounds", () => {
    it("places a new column after the last one when the page has room", () => {
      const bounds = newColumnBounds(
        [{ id: "a", pageNumber: null, referencePageWidth: 700, xStart: 20, xEnd: 100 } as never],
        1,
        700
      );

      expect(bounds.xStart).toBeGreaterThan(100);
      expect(bounds.xEnd).toBeLessThanOrEqual(700);
    });

    it("falls back to the widest gap when the right edge is full", () => {
      const columns = [
        { id: "a", pageNumber: null, referencePageWidth: 700, xStart: 10, xEnd: 200 },
        { id: "b", pageNumber: null, referencePageWidth: 700, xStart: 400, xEnd: 695 },
      ] as never[];

      const bounds = newColumnBounds(columns, 1, 700);

      expect(bounds.xStart).toBeGreaterThanOrEqual(200);
      expect(bounds.xEnd).toBeLessThanOrEqual(400);
    });
  });
});
