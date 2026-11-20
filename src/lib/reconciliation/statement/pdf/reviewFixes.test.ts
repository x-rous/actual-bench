/** Regressions from the 2026-11-16 reconciliation review (PDF parsing). */

import { inferDocumentNumberFormat, moneyCandidates, parseExactDecimal, printedCurrencyOf } from "./candidates";
import { parsePdfDateCandidate } from "./dates";
import { closingBalanceFromPdf, withPrintedPeriod } from "../pdfNormalize";
import type { PdfStatementParseResult } from "./model";

const amount = (value: string, format: Parameters<typeof parseExactDecimal>[1] = "auto") => {
  const decimal = parseExactDecimal(value, format);
  return decimal ? `${decimal.coefficient}e-${decimal.scale}` : null;
};

describe("money in PDF cells", () => {
  it("reads a currency code glued to the digits, so a foreign amount keeps its currency", () => {
    expect(printedCurrencyOf("EUR129.00")).toBe("EUR");
    expect(printedCurrencyOf("129.00 SAR")).toBe("SAR");
    expect(printedCurrencyOf("129.00")).toBeNull();
  });

  it("still flags a space-grouped amount once the document's format is known", () => {
    expect(parseExactDecimal("3 100.00", "us")?.ambiguous).toBe(true);
    expect(parseExactDecimal("3 100,00", "european")?.ambiguous).toBe(false);
    expect(parseExactDecimal("3 100.00", "space")?.ambiguous).toBe(false);
    expect(parseExactDecimal("1,234.00", "us")?.ambiguous).toBe(false);
  });

  it("never joins two numbers separated by a space into one amount", () => {
    expect(moneyCandidates("12 45.00")).toEqual(["12", "45.00"]);
  });

  it("still reads three-digit space grouping, and flags the dot-decimal form", () => {
    expect(amount("1 234,56")).toBe("123456e-2");
    expect(parseExactDecimal("1 234,56", "auto")?.ambiguous).toBe(false);
    expect(parseExactDecimal("3 100.00", "auto")?.ambiguous).toBe(true);
  });

  it("parses a currency code printed against the digits", () => {
    expect(amount("SAR129.00")).toBe("12900e-2");
    expect(amount("AED1,234.00")).toBe("123400e-2");
    expect(amount("-SAR14.29")).toBe("-1429e-2");
  });

  it("settles the decimal convention from the unambiguous amounts in the document", () => {
    expect(inferDocumentNumberFormat(["1.234,56", "12,50", "1.234"])).toBe("european");
    expect(inferDocumentNumberFormat(["1,234.56", "12.50", "1,234"])).toBe("us");
    expect(inferDocumentNumberFormat(["1.234,56", "12.50"])).toBe("auto");
    // A four-decimal rate is dot-decimal evidence too, so the document stays undecided.
    expect(inferDocumentNumberFormat(["1,50", "1.2345"])).toBe("auto");
    expect(amount("1.234", "european")).toBe("1234e-0");
  });
});

describe("dates printed without a year", () => {
  it("puts a December date on a January statement in the previous year", () => {
    const parsed = parsePdfDateCandidate("28/12", "dmy", [], { start: "2026-01-01", end: "2026-01-31" });
    expect(parsed.value).toBe("2025-12-28");
  });

  it("keeps a date inside a single-year period in that year", () => {
    expect(parsePdfDateCandidate("14/01", "dmy", [], { start: "2026-01-01", end: "2026-01-31" }).value).toBe("2026-01-14");
  });

  it("reads a date against a period with only its end known", () => {
    expect(parsePdfDateCandidate("06JUL", "auto", [], { start: null, end: "2019-07-06" }).value).toBe("2019-07-06");
  });
});

describe("the printed statement period", () => {
  it("widens the session period to the dates the bank says it covers", () => {
    expect(withPrintedPeriod({ start: "2026-01-02", end: "2026-01-27" }, { start: "2026-01-01", end: "2026-01-31" }))
      .toEqual({ start: "2026-01-01", end: "2026-01-31" });
  });

  it("never narrows it, and ignores a printed period that is plainly a misread", () => {
    expect(withPrintedPeriod({ start: "2026-01-02", end: "2026-01-27" }, { start: "2026-01-05", end: "2027-01-31" }))
      .toEqual({ start: "2026-01-02", end: "2026-01-27" });
  });
});

describe("the statement's closing balance", () => {
  const proposal = (importDate: string, balance: string, reconciled = true) => ({
    importDate, balance, confidence: { balance: { status: "accepted", score: 1, reasons: reconciled ? ["BALANCE_RECONCILED"] : [], sourceIds: [] } },
  }) as unknown as PdfStatementParseResult["transactions"][number];
  const base = {
    balancePolarity: { direction: "liability", source: "evidence" },
    balanceBehavior: "running",
    transactions: [proposal("2026-01-03", "100.00"), proposal("2026-01-20", "250.00")],
  } as unknown as PdfStatementParseResult;

  it("takes a printed closing line, in Actual's sign for a card", () => {
    const result = { ...base, balanceCheckpoints: [{ kind: "closing", pageNumber: 1, y: 0, coefficient: "123456", scale: 2, sourceIds: [] }] } as PdfStatementParseResult;
    expect(closingBalanceFromPdf(result, "2026-01-31", "2026-01-31")).toEqual({
      amount: -123456, asOf: "2026-01-31", source: "closing-line", polarity: "liability", polarityDetected: false,
    });
  });

  it("does not date a closing line by the last row when no closing date was printed", () => {
    const result = { ...base, balanceBehavior: "statement", balanceCheckpoints: [{ kind: "closing", pageNumber: 1, y: 0, coefficient: "123456", scale: 2, sourceIds: [] }] } as unknown as PdfStatementParseResult;
    expect(closingBalanceFromPdf(result, "2026-01-20")).toBeNull();
    expect(closingBalanceFromPdf(result, "2026-01-20", null)).toBeNull();
  });

  it("withholds the figure when the last row has no balance of its own", () => {
    const unbalanced = { importDate: "2026-01-31", balance: null, confidence: {} } as unknown as PdfStatementParseResult["transactions"][number];
    const result = { ...base, transactions: [...base.transactions, unbalanced] } as PdfStatementParseResult;
    expect(closingBalanceFromPdf(result, "2026-01-31")).toBeNull();
  });

  it("takes the latest-dated row even when printed order is mixed", () => {
    const mixed = {
      ...base,
      transactions: [proposal("2026-01-01", "10.00"), proposal("2026-01-31", "310.00"), proposal("2026-01-15", "150.00")],
    } as PdfStatementParseResult;
    expect(closingBalanceFromPdf(mixed, "2026-01-31")).toMatchObject({ amount: -31000 });
  });

  it("falls back to the last row's reconciled running balance, in either printed order", () => {
    expect(closingBalanceFromPdf(base, "2026-01-31")).toMatchObject({ amount: -25000, source: "last-row" });
    const newestFirst = { ...base, transactions: [...base.transactions].reverse() } as PdfStatementParseResult;
    expect(closingBalanceFromPdf(newestFirst, "2026-01-31")).toMatchObject({ amount: -25000 });
  });

  it("says nothing when the sign or the figure would be a guess", () => {
    expect(closingBalanceFromPdf({ ...base, balancePolarity: null } as PdfStatementParseResult, "2026-01-31")).toBeNull();
    expect(closingBalanceFromPdf({ ...base, transactions: [proposal("2026-01-20", "250.00", false)] } as PdfStatementParseResult, "2026-01-31")).toBeNull();
  });
});
