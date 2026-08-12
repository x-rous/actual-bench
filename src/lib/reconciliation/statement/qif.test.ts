/**
 * QIF parsing and its normalization into the canonical statement model
 * (RD-072 §2.5).
 *
 * The awkward parts of QIF are all here on purpose: Quicken's `8/12'26` dates,
 * repeated tags, split detail that must not become a row of its own, and files
 * that end without a final `^`.
 */

import { looksLikeQif, parseQif } from "./qif";
import { normalizeStructuredStatement } from "./structured";
import { DEFAULT_PARSE_CONFIG, type StatementParseConfig } from "./normalize";

const config = (overrides: Partial<StatementParseConfig> = {}): StatementParseConfig => ({
  ...DEFAULT_PARSE_CONFIG,
  format: "qif",
  dateFormat: "dmy",
  ...overrides,
});

const makeId = (index: number) => `row-${index}`;

const FILE = [
  "!Type:Bank",
  "D01/08/2026",
  "T-125.50",
  "PAMZN Mktp AE*82K39",
  "MONLINE CARD PURCHASE",
  "N88721",
  "LShopping:Household",
  "^",
  "D05/08/2026",
  "T5000.00",
  "PSALARY &amp; ALLOWANCES",
  "^",
].join("\n");

describe("looksLikeQif", () => {
  it("recognises a file by its type header", () => {
    expect(looksLikeQif(FILE)).toBe(true);
  });

  it("does not claim a CSV", () => {
    expect(looksLikeQif("Date,Description,Amount\n2026-08-01,SHOP,-10.00")).toBe(false);
  });
});

describe("parseQif", () => {
  it("reads the declared type and the transaction tags", () => {
    const { type, transactions } = parseQif(FILE);

    expect(type).toBe("Bank");
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      date: "01/08/2026",
      amount: "-125.50",
      payeeText: "AMZN Mktp AE*82K39",
      memoText: "ONLINE CARD PURCHASE",
      reference: "88721",
    });
    // Parsed but deliberately not carried into a statement row: reconciliation
    // never categorises.
    expect(transactions[0].raw.L).toBe("Shopping:Household");
  });

  it("decodes the escaped ampersand Quicken writes in payees", () => {
    expect(parseQif(FILE).transactions[1].payeeText).toBe("SALARY & ALLOWANCES");
  });

  it("keeps a record that ends without a final terminator", () => {
    const truncated = ["!Type:Bank", "D01/08/2026", "T-10.00", "PSHOP"].join("\n");
    expect(parseQif(truncated).transactions).toHaveLength(1);
  });

  it("joins repeated tags rather than keeping only one", () => {
    const multiline = ["!Type:Bank", "D01/08/2026", "T-10.00", "PSHOP", "MFIRST", "MSECOND", "^"].join("\n");
    expect(parseQif(multiline).transactions[0].memoText).toBe("FIRST SECOND");
  });

  it("does not turn split detail into transactions of its own", () => {
    const split = [
      "!Type:Bank",
      "D01/08/2026",
      "T-100.00",
      "PSUPERMARKET",
      "SGroceries",
      "EFood",
      "$-60.00",
      "SHousehold",
      "$-40.00",
      "^",
    ].join("\n");

    const { transactions } = parseQif(split);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].amount).toBe("-100.00");
  });

  it("ignores account and option sections", () => {
    const withSections = ["!Account", "NChecking", "TBank", "^", FILE].join("\n");
    expect(parseQif(withSections).transactions).toHaveLength(2);
  });
});

describe("QIF → StatementRow", () => {
  it("maps P to the imported payee and M to the bank notes", () => {
    const { rows } = normalizeStructuredStatement(parseQif(FILE).transactions, config(), makeId);

    expect(rows[0]).toMatchObject({
      postedDate: "2026-08-01",
      amount: -12550,
      importedPayee: "AMZN Mktp AE*82K39",
      bankNotes: "ONLINE CARD PURCHASE",
      bankReference: "88721",
    });
    expect(rows[0].externalId).toBeUndefined();
  });

  it("swaps the channels when the profile says the bank reverses them", () => {
    const { rows } = normalizeStructuredStatement(
      parseQif(FILE).transactions,
      config({ swapPayeeAndMemo: true }),
      makeId
    );

    expect(rows[0].importedPayee).toBe("ONLINE CARD PURCHASE");
    expect(rows[0].bankNotes).toBe("AMZN Mktp AE*82K39");
  });

  it("reads Quicken's apostrophe and padded date forms", () => {
    const quicken = ["!Type:Bank", "D 8/ 1/26", "T-10.00", "PSHOP", "^", "D8/12'26", "T-20.00", "PSHOP", "^"].join("\n");
    const { rows, errors } = normalizeStructuredStatement(
      parseQif(quicken).transactions,
      config({ dateFormat: "mdy" }),
      makeId
    );

    expect(errors).toEqual([]);
    expect(rows.map((row) => row.postedDate)).toEqual(["2026-08-01", "2026-08-12"]);
  });

  it("honours a comma decimal separator", () => {
    const european = ["!Type:Bank", "D01/08/2026", "T-1.234,56", "PSHOP", "^"].join("\n");
    const { rows } = normalizeStructuredStatement(
      parseQif(european).transactions,
      config({ decimalSeparator: "," }),
      makeId
    );

    expect(rows[0].amount).toBe(-123456);
  });
});
