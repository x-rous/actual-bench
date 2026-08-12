/**
 * Format detection and dispatch (RD-072 §2.5).
 *
 * The contract these tests hold to: whatever the file, what comes out is the
 * same `StatementRow` shape, so nothing downstream has to know which parser ran.
 */

import {
  detectParseConfig,
  detectStatementFormat,
  hasAmbiguousDates,
  parseStatement,
} from "./source";

const makeId = (index: number) => `row-${index}`;

const CSV = ["Date,Merchant,Memo,Amount", "2026-08-01,AMAZON AE,Online purchase,-125.50"].join("\n");
const OFX = "OFXHEADER:100\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><DTPOSTED>20260801<TRNAMT>-125.50<FITID>A1<NAME>AMAZON AE<MEMO>Online purchase</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";
const QIF = ["!Type:Bank", "D01/08/2026", "T-125.50", "PAMAZON AE", "MOnline purchase", "^"].join("\n");

describe("detectStatementFormat", () => {
  it("recognises OFX by its content, whatever the file is called", () => {
    expect(detectStatementFormat({ text: OFX, fileName: "statement.txt" })).toBe("ofx");
  });

  it("recognises QIF by its type header", () => {
    expect(detectStatementFormat({ text: QIF, fileName: "export" })).toBe("qif");
  });

  it("routes .qfx through the OFX path", () => {
    expect(detectStatementFormat({ text: OFX, fileName: "march.qfx" })).toBe("ofx");
  });

  it("treats anything else — including a paste — as delimited", () => {
    expect(detectStatementFormat({ text: CSV, fileName: "march.csv" })).toBe("delimited");
    expect(detectStatementFormat({ text: CSV })).toBe("delimited");
  });
});

describe("parseStatement", () => {
  it("produces the same normalized shape from all three formats", () => {
    const results = [CSV, OFX, QIF].map((text) => {
      const source = { text };
      const config = detectParseConfig(source);
      return parseStatement(
        source,
        // The CSV fixture writes its date ISO; the QIF one is day-first.
        config.format === "qif" ? { ...config, dateFormat: "dmy" } : config,
        makeId
      );
    });

    for (const result of results) {
      expect(result.errors).toEqual([]);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        postedDate: "2026-08-01",
        amount: -12550,
        importedPayee: "AMAZON AE",
        bankNotes: "Online purchase",
      });
      expect(result.totals).toMatchObject({ debits: -12550, credits: 0, rowCount: 1 });
      expect(result.period).toEqual({ start: "2026-08-01", end: "2026-08-01" });
    }
  });

  it("exposes the tokenized table only for delimited files, since only they map columns", () => {
    expect(parseStatement({ text: CSV }, detectParseConfig({ text: CSV }), makeId).table).not.toBeNull();
    expect(parseStatement({ text: OFX }, detectParseConfig({ text: OFX }), makeId).table).toBeNull();
  });

  it("carries the bank's transaction id through as statement metadata only", () => {
    const source = { text: OFX };
    const { rows } = parseStatement(source, detectParseConfig(source), makeId);
    // Evidence for matching; never written as Actual's imported_id, which holds
    // the deterministic retry marker (RD-072 §2.6).
    expect(rows[0].externalId).toBe("A1");
  });
});

/**
 * QIF states no date convention of its own, so its dates get the same detection
 * a CSV column gets (PR-035f). Before this, every QIF import inherited the
 * `"iso"` default — which matches almost no QIF file — and the user had to pick
 * the format by hand.
 */
describe("QIF date detection", () => {
  const qif = (...dates: string[]) =>
    ["!Type:Bank", ...dates.flatMap((date) => [`D${date}`, "T-10.00", "PSHOP", "^"])].join("\n");

  it("detects day-first dates from the file", () => {
    const source = { text: qif("13/08/2026", "01/08/2026") };
    expect(detectParseConfig(source).dateFormat).toBe("dmy");
  });

  it("detects month-first dates from the file", () => {
    const source = { text: qif("08/13/2026", "08/01/2026") };
    expect(detectParseConfig(source).dateFormat).toBe("mdy");
  });

  it("parses Quicken's apostrophe form under the detected format", () => {
    const source = { text: qif("8/13'26", "8/1'26") };
    const config = detectParseConfig(source);
    const { rows, errors } = parseStatement(source, config, makeId);

    expect(config.dateFormat).toBe("mdy");
    expect(errors).toEqual([]);
    expect(rows.map((row) => row.postedDate)).toEqual(["2026-08-13", "2026-08-01"]);
  });

  it("reads an ISO-dated QIF without being told", () => {
    const source = { text: qif("2026-08-01") };
    const config = detectParseConfig(source);

    expect(config.dateFormat).toBe("iso");
    expect(parseStatement(source, config, makeId).rows[0].postedDate).toBe("2026-08-01");
  });

  it("still parses when the order is unresolvable, and says that it is", () => {
    // Every component is 12 or under, so nothing in the file settles it.
    const source = { text: qif("03/07/2026", "05/08/2026") };
    const config = detectParseConfig(source);

    expect(parseStatement(source, config, makeId).errors).toEqual([]);
    expect(hasAmbiguousDates(source, config)).toBe(true);
  });
});

describe("hasAmbiguousDates", () => {
  it("is false when the file settles the order itself", () => {
    const source = { text: ["Date,Description,Amount", "13/08/2026,SHOP,-10.00"].join("\n") };
    expect(hasAmbiguousDates(source, detectParseConfig(source))).toBe(false);
  });

  it("is true for a delimited file whose dates could be read either way", () => {
    const source = {
      text: ["Date,Description,Amount", "03/07/2026,SHOP,-10.00", "05/08/2026,SHOP,-20.00"].join("\n"),
    };
    expect(hasAmbiguousDates(source, detectParseConfig(source))).toBe(true);
  });

  it("is false for ISO dates, which carry no ambiguity", () => {
    const source = { text: ["Date,Description,Amount", "2026-08-01,SHOP,-10.00"].join("\n") };
    expect(hasAmbiguousDates(source, detectParseConfig(source))).toBe(false);
  });

  it("is never true for OFX, whose dates are already unambiguous", () => {
    const source = { text: OFX };
    expect(hasAmbiguousDates(source, detectParseConfig(source))).toBe(false);
  });
});
