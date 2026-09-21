import type { PdfTransactionProposal } from "@/lib/reconciliation/statement/pdf";
import { groupRowReasons, isActionableReason, reasonText } from "./pdfReasonText";

type Field = { status: "accepted" | "review" | "rejected"; reasons: string[] };

function row(fields: Record<string, Field | Field[] | null>): PdfTransactionProposal {
  const issueCodes = [...new Set(
    Object.values(fields)
      .flatMap((field) => (field == null ? [] : Array.isArray(field) ? field : [field]))
      .flatMap((field) => field.reasons)
  )];
  return {
    sourceRowNumber: 1,
    status: "review",
    issueCodes,
    confidence: Object.fromEntries(Object.entries(fields).map(([key, field]) => [
      key,
      field == null
        ? null
        : Array.isArray(field)
          ? field.map((entry) => ({ ...entry, score: 0.5, sourceIds: [] }))
          : { ...field, score: 0.5, sourceIds: [] },
    ])),
  } as unknown as PdfTransactionProposal;
}

describe("groupRowReasons", () => {
  it("gives the row's line to the reason that blocks it, not to the first one listed", () => {
    // The date reason is raised first, but the amount is why the row cannot
    // be imported.
    const grouped = groupRowReasons(row({
      transactionDate: { status: "review", reasons: ["DATE_INHERITED_FROM_PREVIOUS_ROW"] },
      accountAmount: { status: "rejected", reasons: ["AMOUNT_MISSING"] },
    }));

    expect(grouped.primary).toBe("Amount is missing");
    expect(grouped.blocking).toEqual(["AMOUNT_MISSING"]);
    expect(grouped.attention).toEqual(["DATE_INHERITED_FROM_PREVIOUS_ROW"]);
    expect(grouped.extraCount).toBe(1);
  });

  it("separates how a value was read from what the row is waiting on", () => {
    const grouped = groupRowReasons(row({
      direction: { status: "review", reasons: ["DIRECTION_FROM_BALANCE", "BALANCE_RECONCILED", "ACCOUNT_TYPE_UNCONFIRMED"] },
    }));

    expect(grouped.blocking).toEqual([]);
    expect(grouped.attention).toEqual(["ACCOUNT_TYPE_UNCONFIRMED"]);
    expect(grouped.evidence).toEqual(["DIRECTION_FROM_BALANCE", "BALANCE_RECONCILED"]);
    expect(grouped.primary).toBe("Confirm the account type: the balance column was read using a detected type");
    // The two evidence notes are still counted: they are there to be read.
    expect(grouped.extraCount).toBe(2);
  });

  it("takes the worse status when one reason sits on two fields", () => {
    const grouped = groupRowReasons(row({
      accountAmount: { status: "review", reasons: ["CURRENCY_AMBIGUOUS"] },
      currency: { status: "rejected", reasons: ["CURRENCY_AMBIGUOUS"] },
    }));

    expect(grouped.blocking).toEqual(["CURRENCY_AMBIGUOUS"]);
  });

  it("reads reasons out of fields that hold several confidences", () => {
    const grouped = groupRowReasons(row({
      fees: [{ status: "review", reasons: ["AMOUNT_MULTIPLE_CANDIDATES"] }],
      vat: [],
      balance: null,
    }));

    expect(grouped.attention).toEqual(["AMOUNT_MULTIPLE_CANDIDATES"]);
    expect(grouped.primary).toBe("More than one amount could apply");
  });

  it("has nothing to say about a row with only explanatory notes", () => {
    const grouped = groupRowReasons(row({
      accountAmount: { status: "accepted", reasons: ["AMOUNT_FROM_MAPPED_COLUMN"] },
    }));

    expect(grouped.primary).toBeNull();
    expect(grouped.extraCount).toBe(1);
  });
});

describe("reasonText", () => {
  it("joins the reasons a row carries", () => {
    expect(reasonText(["AMOUNT_MISSING", "POSSIBLE_DUPLICATE"]))
      .toBe("Amount is missing; Possible duplicate");
  });

  it("knows which reasons are an instruction and which are an explanation", () => {
    expect(isActionableReason("BALANCE_MISMATCH")).toBe(true);
    expect(isActionableReason("BALANCE_RECONCILED")).toBe(false);
  });
});
