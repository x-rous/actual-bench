import {
  looksLikeHeader,
  parseStatementText,
  sniffDelimiter,
  splitLine,
  splitLines,
} from "./parse";

describe("sniffDelimiter", () => {
  it("detects commas", () => {
    expect(sniffDelimiter("Date,Description,Amount\n2026-07-01,SHOP,-10.00")).toBe(",");
  });

  it("detects tabs from an Excel paste", () => {
    expect(sniffDelimiter("2026-07-01\tSHOP\t-10.00\n2026-07-02\tSHOP2\t-11.00")).toBe("\t");
  });

  it("detects semicolons", () => {
    expect(sniffDelimiter("2026-07-01;SHOP;-10,00\n2026-07-02;SHOP2;-11,00")).toBe(";");
  });

  it("prefers the tab when descriptions are full of commas", () => {
    // Raw comma frequency would win here; consistency of field count is the
    // signal that actually identifies the separator.
    const pasted = [
      "2026-07-01\tSHOP, BRANCH 1, DUBAI\t-10.00",
      "2026-07-02\tCAFE, MALL\t-11.00",
      "2026-07-03\tSTORE, A, B, C\t-12.00",
    ].join("\n");
    expect(sniffDelimiter(pasted)).toBe("\t");
  });

  it("falls back to comma for single-column text", () => {
    expect(sniffDelimiter("just one column\nand another line")).toBe(",");
  });

  it("handles empty input", () => {
    expect(sniffDelimiter("")).toBe(",");
  });
});

describe("splitLines", () => {
  it("tolerates CRLF and drops blank lines", () => {
    expect(splitLines("a\r\n\r\nb\n")).toEqual(["a", "b"]);
  });
});

describe("splitLine", () => {
  it("respects RFC 4180 quoting for comma-delimited lines", () => {
    expect(splitLine('2026-07-01,"SHOP, BRANCH 1",-10.00', ",")).toEqual([
      "2026-07-01",
      "SHOP, BRANCH 1",
      "-10.00",
    ]);
  });

  it("unquotes and trims other delimiters", () => {
    expect(splitLine('2026-07-01\t"SHOP"\t -10.00 ', "\t")).toEqual([
      "2026-07-01",
      "SHOP",
      "-10.00",
    ]);
  });
});

describe("looksLikeHeader", () => {
  it("is true for label-only cells", () => {
    expect(looksLikeHeader(["Date", "Description", "Amount"])).toBe(true);
  });

  it("is false when any cell parses as a date or amount", () => {
    expect(looksLikeHeader(["2026-07-01", "SHOP", "-10.00"])).toBe(false);
    expect(looksLikeHeader(["Transaction", "SHOP", "-10.00"])).toBe(false);
  });

  it("is false for an all-empty row", () => {
    expect(looksLikeHeader(["", "", ""])).toBe(false);
  });
});

describe("parseStatementText", () => {
  it("separates a detected header from the data rows", () => {
    const table = parseStatementText("Date,Description,Amount\n2026-07-01,SHOP,-10.00");
    expect(table.headers).toEqual(["Date", "Description", "Amount"]);
    expect(table.rows).toEqual([["2026-07-01", "SHOP", "-10.00"]]);
    expect(table.sourceRowNumbers).toEqual([2]);
  });

  it("keeps every line when there is no header", () => {
    const table = parseStatementText("2026-07-01,SHOP,-10.00\n2026-07-02,CAFE,-11.00");
    expect(table.headers).toBeNull();
    expect(table.rows).toHaveLength(2);
    expect(table.sourceRowNumbers).toEqual([1, 2]);
  });

  it("honours an explicitly supplied delimiter", () => {
    const table = parseStatementText("a;b;c\n1;2;3", { delimiter: ";" });
    expect(table.delimiter).toBe(";");
  });

  it("returns an empty table for empty input", () => {
    const table = parseStatementText("   \n\n");
    expect(table.rows).toEqual([]);
    expect(table.headers).toBeNull();
  });
});
