import { parseStatementText } from "./parse";
import {
  DEFAULT_COLUMN_MAPPING,
  DEFAULT_PARSE_CONFIG,
  detectDateFormat,
  detectDelimitedConfig,
  normalizeParseConfig,
  fingerprintRow,
  fingerprintStatement,
  normalizeStatement,
  parseMoneyToMinorUnits,
  parseStatementDate,
  totalsFor,
  type ColumnMapping,
  type StatementParseConfig,
} from "./normalize";

const makeId = (index: number) => `row-${index}`;

/**
 * A parse config for the fixtures' usual shape: date, text, amount.
 *
 * Column overrides are accepted flat, because that is how these tests read —
 * `mapping({ notes: 3 })` says which column, not how a value is interpreted.
 */
function mapping(
  overrides: Partial<ColumnMapping> & Partial<Omit<StatementParseConfig, "columns">> = {}
): StatementParseConfig {
  const { date, importedPayee, notes, amount, debit, credit, reference, ...config } = overrides;
  return {
    ...DEFAULT_PARSE_CONFIG,
    ...config,
    columns: {
      date: date ?? 0,
      importedPayee:
        importedPayee === undefined && "importedPayee" in overrides ? undefined : importedPayee ?? 1,
      amount: amount === undefined && "amount" in overrides ? undefined : amount ?? 2,
      notes,
      debit,
      credit,
      reference,
    },
  };
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

describe("fingerprintStatement", () => {
  const rows = (...ids: string[]) => ids.map((fingerprint) => ({ fingerprint }));

  it("is stable for the same statement", () => {
    expect(fingerprintStatement(rows("a", "b", "c"))).toBe(fingerprintStatement(rows("a", "b", "c")));
  });

  it("ignores the order the rows arrived in", () => {
    // The same export sorted the other way round is the same statement.
    expect(fingerprintStatement(rows("a", "b", "c"))).toBe(fingerprintStatement(rows("c", "a", "b")));
  });

  it("changes when a row changes", () => {
    expect(fingerprintStatement(rows("a", "b"))).not.toBe(fingerprintStatement(rows("a", "z")));
  });

  it("changes when a row is added", () => {
    // Next month's statement contains last month's rows plus more, and must
    // not be mistaken for a re-import of it.
    expect(fingerprintStatement(rows("a", "b"))).not.toBe(fingerprintStatement(rows("a", "b", "c")));
  });

  it("distinguishes a repeated row from a single one", () => {
    // Two identical charges on the same day are two rows, not one.
    expect(fingerprintStatement(rows("a"))).not.toBe(fingerprintStatement(rows("a", "a")));
  });

  it("has no fingerprint for an empty statement", () => {
    expect(fingerprintStatement([])).toBeNull();
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
    expect(result.rows[0].bankReference).toBe("88721");
  });

  it("leaves reference undefined when the column is blank", () => {
    const table = parseStatementText(
      ["Date,Description,Amount,Ref", "2026-07-01,TALABAT,-86.40,"].join("\n")
    );
    const result = normalizeStatement(table, mapping({ reference: 3 }), makeId);
    expect(result.rows[0].bankReference).toBeUndefined();
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

describe("two text channels (RD-072 §2.1)", () => {
  it("maps a merchant column and a memo column to their own fields", () => {
    const table = parseStatementText(
      ["Date,Merchant,Memo,Amount", "2026-08-01,AMAZON AE,Online purchase,-125.50"].join("\n")
    );
    const result = normalizeStatement(
      table,
      mapping({ importedPayee: 1, notes: 2, amount: 3 }),
      makeId
    );

    expect(result.rows[0]).toMatchObject({
      importedPayee: "AMAZON AE",
      bankNotes: "Online purchase",
    });
  });

  it("leaves the bank notes undefined when the statement has one text column", () => {
    const table = parseStatementText(
      ["Date,Description,Amount", "2026-08-01,AMAZON AE,-125.50"].join("\n")
    );
    const result = normalizeStatement(table, mapping(), makeId);

    expect(result.rows[0].importedPayee).toBe("AMAZON AE");
    // Not a copy of the description: duplicating it here is a workflow choice
    // made at Apply, not something the parser decides (RD-072 §2.3).
    expect(result.rows[0].bankNotes).toBeUndefined();
  });

  it("leaves the merchant channel empty when no column is mapped to it", () => {
    // A statement whose one text column is genuinely a memo: it goes to the
    // notes alone rather than being duplicated into the provenance field.
    const table = parseStatementText(
      ["Date,Memo,Amount", "2026-08-01,Transfer to savings,-125.50"].join("\n")
    );
    const result = normalizeStatement(
      table,
      mapping({ importedPayee: undefined, notes: 1 }),
      makeId
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0].importedPayee).toBe("");
    expect(result.rows[0].bankNotes).toBe("Transfer to savings");
  });

  it("recovers a foreign amount printed in the memo rather than the merchant text", () => {
    const table = parseStatementText(
      ["Date,Merchant,Memo,Amount", "2026-08-01,CARD PURCHASE,AIRALO AMSTERDAM NH USD24.50,-90.00"].join("\n")
    );
    const result = normalizeStatement(
      table,
      mapping({ importedPayee: 1, notes: 2, amount: 3 }),
      makeId
    );

    expect(result.rows[0].originalAmount).toBe(-2450);
    expect(result.rows[0].originalCurrency).toBe("USD");
  });
});

describe("detectDelimitedConfig — the two text channels", () => {
  it("separates a memo column from the merchant column", () => {
    const config = detectDelimitedConfig(
      parseStatementText(
        ["Date,Merchant,Memo,Amount", "2026-08-01,AMAZON AE,Online purchase,-125.50"].join("\n")
      )
    );

    expect(config.columns.importedPayee).toBe(1);
    expect(config.columns.notes).toBe(2);
  });

  it("gives a lone text column to the merchant channel, not the memo", () => {
    const config = detectDelimitedConfig(
      parseStatementText(["Date,Narrative,Amount", "2026-08-01,AMAZON AE,-125.50"].join("\n"))
    );

    // `narrative` and `details` are used for the merchant at least as often as
    // for a memo, so they belong to the channel that always has to be filled.
    expect(config.columns.importedPayee).toBe(1);
    expect(config.columns.notes).toBeUndefined();
  });

  it("reads an ambiguous label as the merchant when a real memo column follows it", () => {
    const config = detectDelimitedConfig(
      parseStatementText(
        [
          "Date,Transaction Details,Memo,Amount",
          "2026-08-01,AMAZON AE,Online purchase,-125.50",
        ].join("\n")
      )
    );

    expect(config.columns.importedPayee).toBe(1);
    expect(config.columns.notes).toBe(2);
  });

  it("prefers an exact header name over a substring hit", () => {
    const config = detectDelimitedConfig(
      parseStatementText(
        [
          "Date,Additional Information,Description,Amount",
          "2026-08-01,Online purchase,AMAZON AE,-125.50",
        ].join("\n")
      )
    );

    expect(config.columns.importedPayee).toBe(2);
    expect(config.columns.notes).toBe(1);
  });

  it("never claims one column as both channels", () => {
    const config = detectDelimitedConfig(
      parseStatementText(
        ["Date,Transaction Details,Amount", "2026-08-01,AMAZON AE,-125.50"].join("\n")
      )
    );

    expect(config.columns.notes).not.toBe(config.columns.importedPayee);
    expect(config.columns.importedPayee).toBe(1);
  });

  it("treats a column named Reference Text as the memo, not the reference", () => {
    // `reference` matches inside `reference text`, so the reference detector
    // used to claim it — and since the reference is barred from both text
    // channels, the bank's memo was lost outright.
    const config = detectDelimitedConfig(
      parseStatementText(
        [
          "Date,Description,Reference Text,Amount",
          "2026-08-01,AMAZON AE,Online purchase,-125.50",
        ].join("\n")
      )
    );

    expect(config.columns.notes).toBe(2);
    expect(config.columns.reference).toBeUndefined();
    expect(config.columns.importedPayee).toBe(1);
  });

  it("picks up a reference column and keeps it out of the text channels", () => {
    const config = detectDelimitedConfig(
      parseStatementText(
        ["Date,Description,Reference,Amount", "2026-08-01,TALABAT,88721,-86.40"].join("\n")
      )
    );

    expect(config.columns.reference).toBe(2);
    expect(config.columns.importedPayee).toBe(1);
  });

  it("reads a tab-separated paste with a merchant and a memo column", () => {
    const table = parseStatementText(
      [
        "Date\tDescription\tMemo\tDebit\tCredit",
        "01/08/2026\tAMAZON AE\tOnline purchase\t125.50\t",
        "05/08/2026\tSALARY\t\t\t5000.00",
      ].join("\n")
    );
    const config = detectDelimitedConfig(table);
    const result = normalizeStatement(table, config, makeId);

    expect(table.delimiter).toBe("\t");
    expect(config.signConvention).toBe("debit-credit");
    expect(result.rows.map((row) => [row.importedPayee, row.bankNotes, row.amount])).toEqual([
      ["AMAZON AE", "Online purchase", -12550],
      ["SALARY", undefined, 500000],
    ]);
  });
});

describe("normalizeParseConfig", () => {
  it("fills in a configuration that is missing everything", () => {
    // What a saved profile written by an older version — or one whose migration
    // was skipped over a JSON error — can look like on the way back in.
    expect(normalizeParseConfig({})).toEqual(DEFAULT_PARSE_CONFIG);
  });

  it("survives values that are not objects at all", () => {
    for (const value of [null, undefined, 42, "config", []]) {
      expect(normalizeParseConfig(value)).toEqual(DEFAULT_PARSE_CONFIG);
    }
  });

  it("gives a profile with no columns the default mapping rather than an empty one", () => {
    // An unmapped date column parses nothing, so an empty mapping is worse than
    // a wrong one the user can see and correct.
    const config = normalizeParseConfig({ format: "delimited", dateFormat: "dmy" });
    expect(config.columns).toEqual(DEFAULT_COLUMN_MAPPING);
    expect(config.dateFormat).toBe("dmy");
  });

  it("keeps the values a real profile carries", () => {
    const saved = {
      format: "qif",
      columns: { date: 2, importedPayee: 0, notes: 3, amount: 4, reference: 5 },
      dateFormat: "mdy",
      signConvention: "debit-credit",
      decimalSeparator: ",",
      minorUnitDigits: 3,
      detectOriginalCurrencyAmount: false,
      swapPayeeAndMemo: true,
      fallbackPayeeToMemo: false,
    };

    expect(normalizeParseConfig(saved)).toEqual(saved);
  });

  it("preserves a deliberately unmapped merchant column", () => {
    const config = normalizeParseConfig({ columns: { date: 0, notes: 1, amount: 2 } });
    expect(config.columns.importedPayee).toBeUndefined();
    expect(config.columns.notes).toBe(1);
  });

  it("rejects values of the wrong shape rather than trusting them", () => {
    const config = normalizeParseConfig({
      format: "spreadsheet",
      columns: { date: "first", importedPayee: -1, notes: 1.5 },
      dateFormat: "yyyy",
      signConvention: "reversed",
      minorUnitDigits: 99,
      swapPayeeAndMemo: "yes",
    });

    expect(config.format).toBe("delimited");
    expect(config.columns.date).toBe(DEFAULT_COLUMN_MAPPING.date);
    expect(config.columns.importedPayee).toBeUndefined();
    expect(config.columns.notes).toBeUndefined();
    expect(config.dateFormat).toBe("iso");
    expect(config.signConvention).toBe("signed");
    expect(config.minorUnitDigits).toBe(2);
    expect(config.swapPayeeAndMemo).toBe(false);
  });
});

describe("totalsFor", () => {
  it("is zero for an empty statement", () => {
    expect(totalsFor([])).toEqual({ debits: 0, credits: 0, net: 0, rowCount: 0 });
  });
});
