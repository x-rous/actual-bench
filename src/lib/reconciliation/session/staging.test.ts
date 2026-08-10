import type { ReconciliationGuards, StagedPatch } from "../types";
import {
  canStageDelete,
  canStageField,
  effectiveValue,
  hasStagedChanges,
  outranks,
  stageField,
  stagedFields,
  unstageField,
} from "./staging";

function guards(overrides: Partial<ReconciliationGuards> = {}): { guards: ReconciliationGuards } {
  return {
    guards: {
      protectedReconciled: false,
      splitParent: false,
      transfer: "no",
      ...overrides,
    },
  };
}

describe("precedence (feature spec §33)", () => {
  it("ranks a manual edit above everything", () => {
    expect(outranks("manual", "transform")).toBe(true);
    expect(outranks("transform", "manual")).toBe(false);
    expect(outranks("suggestion", "manual")).toBe(false);
  });

  it("lets a source replace its own kind", () => {
    expect(outranks("transform", "transform")).toBe(true);
  });
});

describe("stageField", () => {
  it("records the original, the staged value, and where it came from", () => {
    const { patch, applied } = stageField({
      patch: undefined,
      field: "categoryId",
      original: "cat-old",
      next: "cat-new",
      source: "manual",
    });

    expect(applied).toBe(true);
    expect(patch.categoryId).toEqual({
      original: "cat-old",
      staged: "cat-new",
      source: "manual",
    });
  });

  it("refuses to let a transformation overwrite a manual edit", () => {
    const first = stageField({
      patch: undefined,
      field: "notes",
      original: "Imported #One",
      next: "My own words",
      source: "manual",
    });

    const second = stageField({
      patch: first.patch,
      field: "notes",
      original: "Imported #One",
      next: "Imported #Two",
      source: "transform",
    });

    expect(second.applied).toBe(false);
    expect(second.skippedBecause).toBe("outranked-by-manual");
    expect(second.patch.notes?.staged).toBe("My own words");
  });

  it("allows the override when the user explicitly asks for it", () => {
    const first = stageField({
      patch: undefined,
      field: "notes",
      original: "Imported #One",
      next: "My own words",
      source: "manual",
    });

    const second = stageField({
      patch: first.patch,
      field: "notes",
      original: "Imported #One",
      next: "Imported #Two",
      source: "transform",
      overrideManual: true,
    });

    expect(second.applied).toBe(true);
    expect(second.patch.notes?.staged).toBe("Imported #Two");
  });

  it("keeps the server value as the baseline across repeated staging", () => {
    // `original` must still answer "what is in Actual today" after any number of
    // transformations, or drift detection has nothing to compare against.
    const first = stageField({
      patch: undefined,
      field: "notes",
      original: "#One Dinner",
      next: "#Two Dinner",
      source: "transform",
    });
    const second = stageField({
      patch: first.patch,
      field: "notes",
      original: "#One Dinner",
      next: "#Two Dinner | Reviewed",
      source: "transform",
    });

    expect(second.patch.notes).toEqual({
      original: "#One Dinner",
      staged: "#Two Dinner | Reviewed",
      source: "transform",
    });
  });

  it("clears the entry when a value is set back to its original", () => {
    // A staged change that changes nothing would become a write that does
    // nothing, and inflate the count of updates shown before Apply.
    const first = stageField({
      patch: undefined,
      field: "categoryId",
      original: "cat-old",
      next: "cat-new",
      source: "manual",
    });
    const second = stageField({
      patch: first.patch,
      field: "categoryId",
      original: "cat-old",
      next: "cat-old",
      source: "manual",
    });

    expect(second.patch.categoryId).toBeUndefined();
    expect(hasStagedChanges(second.patch)).toBe(false);
  });

  it("handles a null original", () => {
    const { patch } = stageField({
      patch: undefined,
      field: "notes",
      original: null,
      next: "Added a note",
      source: "manual",
    });
    expect(patch.notes).toEqual({ original: null, staged: "Added a note", source: "manual" });
  });

  it("does not disturb other fields", () => {
    const first = stageField({
      patch: undefined,
      field: "notes",
      original: "a",
      next: "b",
      source: "manual",
    });
    const second = stageField({
      patch: first.patch,
      field: "categoryId",
      original: "c1",
      next: "c2",
      source: "transform",
    });

    expect(stagedFields(second.patch).sort()).toEqual(["categoryId", "notes"]);
  });
});

describe("unstageField", () => {
  it("removes one field and leaves the rest", () => {
    const patch: StagedPatch = {
      notes: { original: "a", staged: "b", source: "manual" },
      categoryId: { original: "c1", staged: "c2", source: "manual" },
    };
    expect(stagedFields(unstageField(patch, "notes"))).toEqual(["categoryId"]);
  });

  it("is a no-op for a field that was never staged", () => {
    expect(hasStagedChanges(unstageField(undefined, "notes"))).toBe(false);
  });
});

describe("effectiveValue", () => {
  it("returns the staged value when there is one", () => {
    const patch: StagedPatch = { notes: { original: "a", staged: "b", source: "manual" } };
    expect(effectiveValue(patch, "notes", "a")).toBe("b");
  });

  it("falls back to what Actual holds", () => {
    expect(effectiveValue(undefined, "notes", "a")).toBe("a");
  });
});

describe("guardrails — field edits (RD-071 D11–D13)", () => {
  it("blocks every edit on a reconciled transaction", () => {
    for (const field of ["date", "payeeId", "categoryId", "notes"] as const) {
      expect(canStageField(guards({ protectedReconciled: true }), field).allowed).toBe(false);
    }
  });

  it("blocks a category on a split parent but allows notes", () => {
    expect(canStageField(guards({ splitParent: true }), "categoryId").allowed).toBe(false);
    expect(canStageField(guards({ splitParent: true }), "notes").allowed).toBe(true);
  });

  it("blocks a payee change on a transfer leg but allows the category", () => {
    expect(canStageField(guards({ transfer: "yes" }), "payeeId").allowed).toBe(false);
    expect(canStageField(guards({ transfer: "yes" }), "categoryId").allowed).toBe(true);
  });

  it("treats unknown transfer status as a transfer for the payee", () => {
    expect(canStageField(guards({ transfer: "unknown" }), "payeeId").allowed).toBe(false);
  });

  it("allows ordinary edits on an ordinary transaction", () => {
    expect(canStageField(guards(), "categoryId").allowed).toBe(true);
    expect(canStageField(guards(), "notes").allowed).toBe(true);
  });

  it("explains why, rather than just refusing", () => {
    const verdict = canStageField(guards({ protectedReconciled: true }), "notes");
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/reconciled/i);
  });
});

describe("guardrails — delete", () => {
  it("blocks deleting a reconciled transaction", () => {
    expect(canStageDelete(guards({ protectedReconciled: true })).allowed).toBe(false);
  });

  it("blocks deleting a transfer leg", () => {
    expect(canStageDelete(guards({ transfer: "yes" })).allowed).toBe(false);
  });

  it("blocks deleting when transfer status is unknown", () => {
    // The conservative branch. A transport that cannot report transfers cannot
    // tell an ordinary transaction from one leg of a transfer, and deleting a
    // leg silently changes an account the user never selected.
    expect(canStageDelete(guards({ transfer: "unknown" })).allowed).toBe(false);
  });

  it("allows deleting an ordinary transaction", () => {
    expect(canStageDelete(guards()).allowed).toBe(true);
  });

  it("allows deleting a split parent, which is a whole transaction", () => {
    expect(canStageDelete(guards({ splitParent: true })).allowed).toBe(true);
  });
});
