import type { StatementRow } from "../types";
import { statementText } from "./text";

/**
 * One definition of "what this row says", shared by the matcher and every screen
 * that shows a statement row.
 *
 * The regression worth naming: when a statement's only text column is mapped to
 * the notes, the merchant channel is legitimately empty — and reading it alone
 * left the workbench's statement column blank for rows that plainly had text.
 */
function row(overrides: Partial<StatementRow> = {}): StatementRow {
  return {
    id: "s1",
    sourceRowNumber: 1,
    postedDate: "2026-08-01",
    amount: -12550,
    importedPayee: "AMZN Mktp AE*23981",
    raw: {},
    fingerprint: "fp-1",
    ...overrides,
  };
}

describe("statementText", () => {
  it("is the bank's merchant text when there is one", () => {
    expect(statementText(row({ bankNotes: "ONLINE CARD PURCHASE" }))).toBe("AMZN Mktp AE*23981");
  });

  it("falls back to the memo when no merchant column was mapped", () => {
    expect(statementText(row({ importedPayee: "", bankNotes: "Transfer to savings" }))).toBe(
      "Transfer to savings"
    );
  });

  it("ignores a merchant channel that is only whitespace", () => {
    expect(statementText(row({ importedPayee: "   ", bankNotes: "Fee" }))).toBe("Fee");
  });

  it("is empty when the row carries no text at all", () => {
    expect(statementText(row({ importedPayee: "" }))).toBe("");
  });

  it("tolerates a missing row, so callers need no guard of their own", () => {
    expect(statementText(undefined)).toBe("");
  });
});
