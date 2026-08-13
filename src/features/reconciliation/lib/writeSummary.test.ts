import type {
  ApplyPlan,
  UpdateOperation,
} from "@/lib/reconciliation/apply/operations";
import {
  describeWrites,
  withoutOperations,
  writeActionLabel,
} from "./writeSummary";

function update(
  id: string,
  options: { importedPayee?: string; notes?: boolean } = {}
): UpdateOperation {
  return {
    id,
    kind: "update",
    itemId: id,
    transactionId: id,
    accountId: "a1",
    date: "2025-08-07",
    amount: -12550,
    patch: options.notes
      ? {
          notes: {
            original: "Amazon",
            staged: "#2025-08 Amazon",
            source: "manual",
          },
        }
      : {},
    ...(options.importedPayee ? { importedPayee: options.importedPayee } : {}),
  };
}

function plan(operations: UpdateOperation[]): ApplyPlan {
  return {
    operations,
    alreadyApplied: 0,
    noWriteMatches: 0,
    unresolved: 0,
    blocked: [],
  };
}

describe("reconciliation write summaries", () => {
  it("names provenance-only writes as bank details rather than changes", () => {
    const input = plan([
      update("one", { importedPayee: "AMAZON" }),
      update("two", { importedPayee: "TALABAT" }),
    ]);

    expect(writeActionLabel("Review", input)).toBe("Review 2 bank details");
    expect(describeWrites({ userChanges: 0, enrichments: 1 })).toBe("1 bank detail");
  });

  it("keeps staged changes and pure provenance writes separately visible", () => {
    const input = plan([
      update("change", { notes: true, importedPayee: "AMAZON" }),
      update("bank", { importedPayee: "TALABAT" }),
    ]);

    expect(writeActionLabel("Apply", input)).toBe("Apply 1 change · 1 bank detail");
  });

  it("classifies the exact operations left after drift withholds a row", () => {
    const input = plan([
      update("change", { notes: true }),
      update("bank", { importedPayee: "TALABAT" }),
    ]);

    const remaining = withoutOperations(input, new Set(["change"]));
    expect(writeActionLabel("Apply", remaining, { other: true })).toBe(
      "Apply the other 1 bank detail"
    );
  });
});
