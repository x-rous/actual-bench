/**
 * OFX/QFX parsing and its normalization into the canonical statement model
 * (RD-072 §2.5).
 *
 * The fixtures are deliberately in both dialects, because a bank's OFX 1.x SGML
 * export — unclosed leaf tags and all — is the common case, and a parser that
 * only handles the tidy XML form would fail on most real files.
 */

import { parseOfx, parseOfxDate, unescapeOfx } from "./ofx";
import { normalizeStructuredStatement } from "./structured";
import { DEFAULT_PARSE_CONFIG, type StatementParseConfig } from "./normalize";

const config = (overrides: Partial<StatementParseConfig> = {}): StatementParseConfig => ({
  ...DEFAULT_PARSE_CONFIG,
  format: "ofx",
  ...overrides,
});

const makeId = (index: number) => `row-${index}`;

/** OFX 1.x: SGML headers, aggregates closed, leaf elements not. */
const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260801120000.000[-4:GST]
<TRNAMT>-125.50
<FITID>2026080100001
<NAME>AMZN Mktp AE*82K39
<MEMO>ONLINE CARD PURCHASE
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260805
<TRNAMT>5000.00
<FITID>2026080500007
<NAME>SALARY &amp; ALLOWANCES
<CHECKNUM>88721
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

/** OFX 2.x: XML, everything closed. */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220"?>
<OFX>
  <CREDITCARDMSGSRSV1>
    <CCSTMTTRNRS>
      <CCSTMTRS>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260803</DTPOSTED>
            <TRNAMT>-42.50</TRNAMT>
            <FITID>CC-778</FITID>
            <NAME>STARBUCKS 3849</NAME>
            <MEMO>CARD PURCHASE</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </CCSTMTRS>
    </CCSTMTTRNRS>
  </CREDITCARDMSGSRSV1>
</OFX>`;

describe("parseOfxDate", () => {
  it("takes the date part of a timestamped value", () => {
    expect(parseOfxDate("20260801120000.000[-4:GST]")).toBe("2026-08-01");
  });

  it("reads a bare date", () => {
    expect(parseOfxDate("20260801")).toBe("2026-08-01");
  });

  it("rejects an impossible month", () => {
    expect(parseOfxDate("20261301")).toBeNull();
  });

  it("returns null for nothing", () => {
    expect(parseOfxDate(undefined)).toBeNull();
  });
});

describe("unescapeOfx", () => {
  it("decodes the entities banks actually emit", () => {
    expect(unescapeOfx("SALARY &amp; ALLOWANCES &#39;26")).toBe("SALARY & ALLOWANCES '26");
  });
});

describe("parseOfx", () => {
  it("reads the SGML dialect, headers and all", () => {
    const { headers, transactions } = parseOfx(SGML);

    expect(headers.OFXHEADER).toBe("100");
    expect(headers.VERSION).toBe("102");
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      date: "2026-08-01",
      amount: "-125.50",
      payeeText: "AMZN Mktp AE*82K39",
      memoText: "ONLINE CARD PURCHASE",
      externalId: "2026080100001",
      type: "DEBIT",
    });
    expect(transactions[1]).toMatchObject({
      payeeText: "SALARY & ALLOWANCES",
      reference: "88721",
      memoText: null,
    });
  });

  it("reads the XML dialect, including a credit-card statement", () => {
    const { transactions } = parseOfx(XML);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      date: "2026-08-03",
      amount: "-42.50",
      payeeText: "STARBUCKS 3849",
      memoText: "CARD PURCHASE",
      externalId: "CC-778",
    });
  });
});

describe("OFX → StatementRow", () => {
  it("keeps the bank's payee and memo in separate channels", () => {
    const { rows } = normalizeStructuredStatement(parseOfx(SGML).transactions, config(), makeId);

    expect(rows[0]).toMatchObject({
      postedDate: "2026-08-01",
      amount: -12550,
      importedPayee: "AMZN Mktp AE*82K39",
      bankNotes: "ONLINE CARD PURCHASE",
      externalId: "2026080100001",
    });
    expect(rows[1]).toMatchObject({
      amount: 500000,
      importedPayee: "SALARY & ALLOWANCES",
      bankReference: "88721",
    });
    expect(rows[1].bankNotes).toBeUndefined();
  });

  it("promotes the memo when NAME is missing, and does not repeat it in the notes", () => {
    const file = SGML.replace("<NAME>AMZN Mktp AE*82K39\n", "");
    const { rows } = normalizeStructuredStatement(
      parseOfx(file).transactions,
      config({ fallbackPayeeToMemo: true }),
      makeId
    );

    expect(rows[0].importedPayee).toBe("ONLINE CARD PURCHASE");
    // The whole point of the fallback rule: one text, one field.
    expect(rows[0].bankNotes).toBeUndefined();
  });

  it("leaves the payee empty when the fallback is off", () => {
    const file = SGML.replace("<NAME>AMZN Mktp AE*82K39\n", "");
    const { rows } = normalizeStructuredStatement(
      parseOfx(file).transactions,
      config({ fallbackPayeeToMemo: false }),
      makeId
    );

    expect(rows[0].importedPayee).toBe("");
    expect(rows[0].bankNotes).toBe("ONLINE CARD PURCHASE");
  });

  it("swaps the channels for a bank that fills them the wrong way round", () => {
    const { rows } = normalizeStructuredStatement(
      parseOfx(SGML).transactions,
      config({ swapPayeeAndMemo: true }),
      makeId
    );

    expect(rows[0].importedPayee).toBe("ONLINE CARD PURCHASE");
    expect(rows[0].bankNotes).toBe("AMZN Mktp AE*82K39");
  });

  it("gives a row the same fingerprint whatever the payee/memo options are", () => {
    const plain = normalizeStructuredStatement(parseOfx(SGML).transactions, config(), makeId);
    const swapped = normalizeStructuredStatement(
      parseOfx(SGML).transactions,
      config({ swapPayeeAndMemo: true }),
      makeId
    );

    // Identity comes from what the file said, not from how it is being read —
    // otherwise toggling an option would make a retry create the transaction
    // for a second time.
    expect(swapped.rows.map((row) => row.fingerprint)).toEqual(
      plain.rows.map((row) => row.fingerprint)
    );
  });

  it("reports a transaction it cannot read rather than dropping it silently", () => {
    const file = SGML.replace("<TRNAMT>-125.50", "<TRNAMT>");
    const { rows, errors } = normalizeStructuredStatement(
      parseOfx(file).transactions,
      config(),
      makeId
    );

    expect(rows).toHaveLength(1);
    expect(errors).toEqual([
      expect.objectContaining({ sourceRowNumber: 1, reason: "unparseable-amount" }),
    ]);
  });
});
