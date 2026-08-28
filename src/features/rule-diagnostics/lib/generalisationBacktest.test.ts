import type { ImportedTextRow } from "@/features/payee-cleanup/lib/ruleCandidates";
import { collectGeneralisations } from "./overSpecificImportMatch";
import { assessGeneralisation, assessGeneralisations } from "./generalisationBacktest";

const CURRENT = [
  "MARKET BOYS PTY LTD Melbourne VI AUS Card xx4534 Value Date: 12/03/2024",
  "MARKET BOYS PTY LTD Sydney Value Date: 10/11/2025",
];

function row(partial: Partial<ImportedTextRow> & { text: string }): ImportedTextRow {
  return {
    field: partial.field ?? "imported_payee",
    text: partial.text,
    payeeId: partial.payeeId ?? null,
    payeeName: partial.payeeName ?? null,
    transactionCount: partial.transactionCount ?? 1,
  };
}

const CONTAINS = {
  stem: "MARKET BOYS PTY LTD",
  candidate: {
    field: "imported_payee" as const,
    op: "contains" as const,
    value: "MARKET BOYS PTY LTD",
    description: 'contains "MARKET BOYS PTY LTD"',
  },
};

function input(rows: ImportedTextRow[]) {
  return {
    field: "imported_payee" as const,
    currentValues: CURRENT,
    targetPayeeIds: new Set(["p-market"]),
    targetPayeeNames: new Set(["MARKET BOYS"]),
    rows,
  };
}

describe("assessGeneralisation", () => {
  it("does not count what the rule already matches as newly caught", () => {
    const impact = assessGeneralisation(
      CONTAINS,
      input(CURRENT.map((text) => row({ text, payeeId: "p-market" })))
    );

    expect(impact.coveredToday).toBe(2);
    expect(impact.newAgreeing).toBe(0);
    expect(impact.clean).toBe(true);
  });

  it("counts a variant already going to the rule's own payee as agreeing", () => {
    const impact = assessGeneralisation(
      CONTAINS,
      input([
        ...CURRENT.map((text) => row({ text, payeeId: "p-market" })),
        row({
          text: "MARKET BOYS PTY LTD Perth Card xx7781 Value Date: 03/01/2026",
          payeeId: "p-market",
        }),
      ])
    );

    expect(impact.newAgreeing).toBe(1);
    expect(impact.clean).toBe(true);
  });

  it("counts text nobody has claimed as unassigned, not as a conflict", () => {
    const impact = assessGeneralisation(
      CONTAINS,
      input([row({ text: "MARKET BOYS PTY LTD Darwin Value Date: 04/01/2026" })])
    );

    expect(impact.newUnassigned).toBe(1);
    expect(impact.newConflicting).toBe(0);
    expect(impact.clean).toBe(true);
  });

  it("reports another payee's transactions, with examples and their owner", () => {
    const impact = assessGeneralisation(
      CONTAINS,
      input([
        row({
          text: "MARKET BOYS PTY LTD WHOLESALE Brisbane",
          payeeId: "p-wholesale",
          payeeName: "Market Boys Wholesale",
          transactionCount: 6,
        }),
      ])
    );

    expect(impact.clean).toBe(false);
    expect(impact.newConflicting).toBe(1);
    expect(impact.conflictingTransactions).toBe(6);
    expect(impact.conflictingExamples[0].payeeName).toBe("Market Boys Wholesale");
  });

  it("attributes by name as well as by id", () => {
    // A grouped query can return either, and mis-attributing the rule's own
    // transactions makes a safe rewrite look dangerous.
    const impact = assessGeneralisation(
      CONTAINS,
      input([row({ text: "MARKET BOYS PTY LTD Perth", payeeName: "Market Boys" })])
    );

    expect(impact.newAgreeing).toBe(1);
    expect(impact.clean).toBe(true);
  });

  it("ignores rows from the other text field", () => {
    const impact = assessGeneralisation(
      CONTAINS,
      input([
        row({ field: "notes", text: "MARKET BOYS PTY LTD Cairns", payeeId: "p-other", payeeName: "Someone Else" }),
      ])
    );

    expect(impact.newConflicting).toBe(0);
  });
});

describe("assessGeneralisations", () => {
  it("puts a safe rewrite ahead of a broader one that takes another payee's text", () => {
    const entries = collectGeneralisations(CURRENT, "imported_payee");
    const impacts = assessGeneralisations(
      entries,
      input([
        row({
          text: "MARKET BOYS Brisbane",
          payeeId: "p-other",
          payeeName: "Market Boys Wholesale",
        }),
      ])
    );

    expect(impacts.length).toBeGreaterThan(1);
    expect(impacts[0].clean).toBe(true);
    // The unsafe ones are kept: someone shown nothing is left with a rule that
    // does not work and no explanation of why.
    expect(impacts.some((impact) => !impact.clean)).toBe(true);
  });
});
