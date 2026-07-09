import { classifyDuplicate } from "./duplicateClassifier";
import type { SyncTargetTransactionForDedupe } from "./plannedChanges";

const payload = { date: "2026-07-01", amount: 1250, categoryId: "tc1" };

function target(overrides: Partial<SyncTargetTransactionForDedupe> = {}): SyncTargetTransactionForDedupe {
  return { id: "x1", date: "2026-07-01", amount: 1250, payeeName: "Coffee Bar", categoryId: "tc1", ...overrides };
}

/** Shorthand: assert only on the confidence, ignoring the matched id. */
const confidenceOf = (...args: Parameters<typeof classifyDuplicate>) =>
  classifyDuplicate(...args).confidence;

describe("classifyDuplicate", () => {
  it("returns none when nothing matches date + amount", () => {
    expect(confidenceOf(payload, [target({ amount: 999 })], "Coffee Bar")).toBe("none");
    expect(confidenceOf(payload, [], "Coffee Bar")).toBe("none");
  });

  it("weak when only date + amount match", () => {
    expect(confidenceOf(payload, [target({ payeeName: "Other", categoryId: "zzz" })], "Coffee Bar")).toBe("weak");
  });

  it("strong when payee also matches but category differs", () => {
    expect(confidenceOf(payload, [target({ categoryId: "zzz" })], "Coffee Bar")).toBe("strong");
  });

  it("exact when date, amount, payee, and category all match", () => {
    expect(confidenceOf(payload, [target()], "Coffee Bar")).toBe("exact");
  });

  it("normalizes payee names before comparing", () => {
    expect(confidenceOf(payload, [target({ payeeName: "  coffee  bar " })], "Coffee Bar")).toBe("exact");
  });

  it("returns the strongest confidence across multiple candidates", () => {
    const rows = [target({ payeeName: "Other", categoryId: "zzz" }), target()];
    expect(confidenceOf(payload, rows, "Coffee Bar")).toBe("exact");
  });

  it("treats a null planned payee as not-a-payee-match (weak at best)", () => {
    // No usable payee to compare, even against a target that also has none.
    expect(confidenceOf(payload, [target({ payeeName: null })], null)).toBe("weak");
    expect(confidenceOf(payload, [target({ payeeName: "Coffee Bar" })], null)).toBe("weak");
  });

  it("does not treat two null categories as a category match", () => {
    // payee matches, but null==null must not count as same category → strong, not exact.
    const noCat = { date: "2026-07-01", amount: 1250, categoryId: null };
    expect(confidenceOf(noCat, [target({ categoryId: null })], "Coffee Bar")).toBe("strong");
  });

  it("handles null payee and null category together (weak on date+amount only)", () => {
    const bare = { date: "2026-07-01", amount: 1250, categoryId: null };
    expect(confidenceOf(bare, [target({ payeeName: null, categoryId: null })], null)).toBe("weak");
  });

  it("returns the matched target id for the strongest match", () => {
    const rows = [target({ id: "weak-1", payeeName: "Other", categoryId: "zzz" }), target({ id: "exact-1" })];
    expect(classifyDuplicate(payload, rows, "Coffee Bar")).toEqual({ confidence: "exact", targetTransactionId: "exact-1" });
    expect(classifyDuplicate(payload, [], "Coffee Bar")).toEqual({ confidence: "none", targetTransactionId: null });
  });
});
