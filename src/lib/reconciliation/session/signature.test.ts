import { DEFAULT_APPLY_CONFIG } from "./plan";
import { decisionSignature } from "./signature";

it("canonicalizes item IDs and nested keys without consulting the runtime locale", () => {
  const items = ["é", "a", "Z"].map((id) => ({
    id, disposition: "matched", statementRowIds: ["s1"], actualTransactionIds: ["t1"],
    stagedChanges: { notes: { é: "accent", a: "lowercase", Z: "uppercase", absent: undefined } },
  }));
  const localeCompare = jest.spyOn(String.prototype, "localeCompare").mockImplementation(() => {
    throw new Error("Canonical signatures must not depend on locale");
  });
  try {
    const signature = decisionSignature(items, DEFAULT_APPLY_CONFIG);
    const reordered = items.toReversed().map((item) => ({
      ...item, stagedChanges: { notes: { Z: "uppercase", a: "lowercase", é: "accent" } },
    }));
    expect(decisionSignature(reordered, DEFAULT_APPLY_CONFIG)).toBe(signature);
    const parsed = JSON.parse(signature);
    expect(parsed.items.map((item: { id: string }) => item.id)).toEqual(["Z", "a", "é"]);
    expect(Object.keys(parsed.items[0].stagedChanges.notes)).toEqual(["Z", "a", "é"]);
    expect(decisionSignature(items.map((item) => ({ ...item, disposition: "ignored" })), DEFAULT_APPLY_CONFIG))
      .not.toBe(signature);
  } finally {
    localeCompare.mockRestore();
  }
});
