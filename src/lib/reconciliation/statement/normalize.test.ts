import { parseStatementText } from "./parse";
import {
  DEFAULT_MAPPING,
  detectDateFormat,
  fingerprintRow,
  normalizeStatement,
  parseMoneyToMinorUnits,
  parseStatementDate,
  totalsFor,
  type ColumnMapping,
} from "./normalize";

const makeId = (index: number) => `row-${index}`;

function mapping(overrides: Partial<ColumnMapping> = {}): ColumnMapping {
  return { ...DEFAULT_MAPPING, date: 0, description: 1, amount: 2, ...overrides };
}

describe("parseMoneyToMinorUnits — integer minor units, no floating point", () => {
  it("parses a plain decimal", () => {
    expect(parseMoneyToMinorUnits("42.50")).toBe(4250);
  });

  it("preserves an explicit negative sign", () => {
    expect(parseMoneyToMinorUnits("-42.50")).toBe(-4250);
  });

  it("treats parentheses as negative", () => {
    expect(parseMoneyToMinorUnits("(1,234.56)")).toBe(-123456);
  });

  it("strips currency symbols and codes", () => {
    expect(parseMoneyToMinorUnits("AED 1,234.56")).toBe(123456);
    expect(parseMoneyToMinorUnits("$42.50")).toBe(4250);
    expect(parseMoneyToMinorUnits("42.50 USD")).toBe(4250);
  });

  it("honours DR/CR markers", () => {
    expect(parseMoneyToMinorUnits("1,234.56 DR")).toBe(-123456);
    expect(parseMoneyToMinorUnits("1,234.56 CR")).toBe(123456);
  });

  it("handles the comma decimal convention", () => {
    expect(parseMoneyToMinorUnits("1.234,56", ",")).toBe(123456);
    expect(parseMoneyToMinorUnits("-1.234,56", ",")).toBe(-123456);
  });

  it("handles space and apostrophe thousands separators", () => {
    expect(parseMoneyToMinorUnits("1 234.56")).toBe(123456);
    expect(parseMoneyToMinorUnits("1'234.56")).toBe(123456);
  });

  it("rounds nothing away: 1.005 keeps its exact minor units", () => {
    // Math.round(1.005 * 100) is 100 in binary floating point — this must be 100
    // via truncation of the third digit, not via a float multiply.
    expect(parseMoneyToMinorUnits("1.005")).toBe(100);
    expect(parseMoneyToMinorUnits("1.999")).toBe(199);
  });

  it("pads a short fraction", () => {
    expect(parseMoneyToMinorUnits("42.5")).toBe(4250);
    expect(parseMoneyToMinorUnits("42")).toBe(4200);
  });

  it("supports a 3-digit minor unit currency", () => {
    expect(parseMoneyToMinorUnits("1.234", ".", 3)).toBe(1234);
  });

  it("handles very large amounts exactly", () => {
    expect(parseMoneyToMinorUnits("9,999,999.99")).toBe(999999999);
  });

  it("returns null for text with no number", () => {
    expect(parseMoneyToMinorUnits("")).toBeNull();
    expect(parseMoneyToMinorUnits("   ")).toBeNull();
    expect(parseMoneyToMinorUnits("N/A")).toBeNull();
  });

  it("returns zero for an explicit zero", () => {
    expect(parseMoneyToMinorUnits("0.00")).toBe(0);
  });
});

describe("parseStatementDate", () => {
  it("parses ISO", () => {
    expect(parseStatementDate("2026-07-03", "iso")).toBe("2026-07-03");
  });

  it("parses day-first and month-first unambiguously per the declared format", () => {
    expect(parseStatementDate("03/07/2026", "dmy")).toBe("2026-07-03");
    expect(parseStatementDate("07/03/2026", "mdy")).toBe("2026-07-03");
  });

  it("parses named months", () => {
    expect(parseStatementDate("03 Jul 2026", "dmy-name")).toBe("2026-07-03");
    expect(parseStatementDate("03-Jul-26", "dmy-name")).toBe("2026-07-03");
  });

  it("parses compact YYYYMMDD", () => {
    expect(parseStatementDate("20260703", "ymd-compact")).toBe("2026-07-03");
  });

  it("rejects an impossible date rather than rolling it over", () => {
    // JS Date would turn 31 Feb into 3 March; a silent roll-over would put a
    // transaction in the wrong month.
    expect(parseStatementDate("31/02/2026", "dmy")).toBeNull();
  });

  it("handles a leap day correctly", () => {
    expect(parseStatementDate("29/02/2028", "dmy")).toBe("2028-02-29");
    expect(parseStatementDate("29/02/2027", "dmy")).toBeNull();
  });

  it("returns null for junk", () => {
    expect(parseStatementDate("", "iso")).toBeNull();
    expect(parseStatementDate("not a date", "iso")).toBeNull();
  });
});

describe("detectDateFormat", () => {
  it("detects ISO", () => {
    expect(detectDateFormat(["2026-07-03", "2026-07-04"])).toBe("iso");
  });

  it("detects named months", () => {
    expect(detectDateFormat(["03 Jul 2026"])).toBe("dmy-name");
  });

  it("detects compact", () => {
    expect(detectDateFormat(["20260703"])).toBe("ymd-compact");
  });

  it("uses a >12 component to disambiguate month-first", () => {
    expect(detectDateFormat(["07/25/2026", "07/26/2026"])).toBe("mdy");
  });

  it("uses a >12 component to disambiguate day-first", () => {
    expect(detectDateFormat(["25/07/2026", "26/07/2026"])).toBe("dmy");
  });

  it("defaults to day-first when nothing disambiguates", () => {
    // Deliberate: the mapping UI must show this choice rather than trust it.
    expect(detectDateFormat(["03/07/2026"])).toBe("dmy");
  });
});

describe("fingerprintRow", () => {
  it("is stable for identical cells", () => {
    expect(fingerprintRow(["a", "b"], 1)).toBe(fingerprintRow(["a", "b"], 1));
  });

  it("distinguishes two identical rows at different positions", () => {
    // A statement can legitimately contain the same transaction twice.
    expect(fingerprintRow(["a", "b"], 1)).not.toBe(fingerprintRow(["a", "b"], 2));
  });

  it("changes when the cells change", () => {
    expect(fingerprintRow(["a", "b"], 1)).not.toBe(fingerprintRow(["a", "c"], 1));
  });
});

describe("normalizeStatement", () => {
  const csv = [
    "Date,Description,Amount",
    "2026-07-01,CARREFOUR MARKET,-342.85",
    "2026-07-02,AMAZON.AE,-128.00",
    "2026-07-03,PAYMENT RECEIVED,5000.00",
  ].join("\n");

  it("normalizes rows to integer minor units and ISO dates", () => {
    const result = normalizeStatement(parseStatementText(csv), mapping(), makeId);

    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => [r.postedDate, r.amount])).toEqual([
      ["2026-07-01", -34285],
      ["2026-07-02", -12800],
      ["2026-07-03", 500000],
    ]);
  });

  it("retains the raw source row keyed by header", () => {
    const result = normalizeStatement(parseStatementText(csv), mapping(), makeId);
    expect(result.rows[0].raw).toEqual({
      Date: "2026-07-01",
      Description: "CARREFOUR MARKET",
      Amount: "-342.85",
    });
  });

  it("numbers rows against the source file, counting the header", () => {
    const result = normalizeStatement(parseStatementText(csv), mapping(), makeId);
    expect(result.rows.map((r) => r.sourceRowNumber)).toEqual([2, 3, 4]);
  });

  it("computes totals and the statement period for the parse preview", () => {
    const result = normalizeStatement(parseStatementText(csv), mapping(), makeId);
    expect(result.totals).toEqual({
      debits: -47085,
      credits: 500000,
      net: 452915,
      rowCount: 3,
    });
    expect(result.period).toEqual({ start: "2026-07-01", end: "2026-07-03" });
  });

  it("reports unparseable rows without discarding the good ones", () => {
    const withJunk = [
      "Date,Description,Amount",
      "2026-07-01,GOOD ROW,-10.00",
      "not-a-date,BAD DATE,-10.00",
      "2026-07-02,BAD AMOUNT,N/A",
    ].join("\n");

    const result = normalizeStatement(parseStatementText(withJunk), mapping(), makeId);
    expect(result.rows).toHaveLength(1);
    expect(result.errors.map((e) => [e.sourceRowNumber, e.reason])).toEqual([
      [3, "unparseable-date"],
      [4, "unparseable-amount"],
    ]);
  });

  it("maps separate debit and credit columns, making debits negative", () => {
    const table = parseStatementText(
      [
        "Date,Description,Debit,Credit",
        "2026-07-01,CARREFOUR,342.85,",
        "2026-07-03,SALARY,,5000.00",
      ].join("\n")
    );

    const result = normalizeStatement(
      table,
      mapping({ amount: undefined, debit: 2, credit: 3, signConvention: "debit-credit" }),
      makeId
    );

    expect(result.rows.map((r) => r.amount)).toEqual([-34285, 500000]);
  });

  it("inverts the sign when the statement reports spend as positive", () => {
    const table = parseStatementText(["Date,Description,Amount", "2026-07-01,SHOP,342.85"].join("\n"));
    const result = normalizeStatement(table, mapping({ signConvention: "signed-inverted" }), makeId);
    expect(result.rows[0].amount).toBe(-34285);
  });

  it("captures an optional reference column", () => {
    const table = parseStatementText(
      ["Date,Description,Amount,Ref", "2026-07-01,TALABAT,-86.40,88721"].join("\n")
    );
    const result = normalizeStatement(table, mapping({ reference: 3 }), makeId);
    expect(result.rows[0].reference).toBe("88721");
  });

  it("leaves reference undefined when the column is blank", () => {
    const table = parseStatementText(
      ["Date,Description,Amount,Ref", "2026-07-01,TALABAT,-86.40,"].join("\n")
    );
    const result = normalizeStatement(table, mapping({ reference: 3 }), makeId);
    expect(result.rows[0].reference).toBeUndefined();
  });

  it("parses a tab-separated clipboard paste with no header", () => {
    const pasted = "01/07/2026\tCARREFOUR MARKET\t-342.85\n02/07/2026\tAMAZON.AE\t-128.00";
    const table = parseStatementText(pasted);

    expect(table.delimiter).toBe("\t");
    expect(table.headers).toBeNull();

    const result = normalizeStatement(table, mapping({ dateFormat: "dmy" }), makeId);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].sourceRowNumber).toBe(1);
    expect(result.rows[0].amount).toBe(-34285);
  });

  it("preserves raw cells as an array when there is no header", () => {
    const table = parseStatementText("2026-07-01\tSHOP\t-10.00");
    const result = normalizeStatement(table, mapping(), makeId);
    expect(result.rows[0].raw).toEqual(["2026-07-01", "SHOP", "-10.00"]);
  });
});

describe("totalsFor", () => {
  it("is zero for an empty statement", () => {
    expect(totalsFor([])).toEqual({ debits: 0, credits: 0, net: 0, rowCount: 0 });
  });
});
