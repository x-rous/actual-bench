import { mergeOperationResults, summarizeResults } from "./operations";
import type { OperationResult } from "./operations";

const applied = (id: string): OperationResult => ({ operationId: id, status: "applied" });
const failed = (id: string, error = "server said no"): OperationResult => ({
  operationId: id,
  status: "failed",
  error,
});

describe("folding a retry's outcomes into the session's record", () => {
  it("keeps operations the retry did not touch", () => {
    // The bug this exists for: a retry runs only what failed, so storing its
    // results as the whole record erases everything that already worked — and
    // the plan then offers to apply that work all over again.
    const previous = [applied("create:i1"), applied("update:i2"), failed("update:i3")];
    const retry = [applied("update:i3")];

    const merged = mergeOperationResults(previous, retry);

    expect(merged).toHaveLength(3);
    expect(merged.map((entry) => entry.operationId)).toEqual([
      "create:i1",
      "update:i2",
      "update:i3",
    ]);
    expect(merged.every((entry) => entry.status === "applied")).toBe(true);
  });

  it("lets the later outcome win", () => {
    const merged = mergeOperationResults([failed("update:i1")], [applied("update:i1")]);
    expect(merged).toEqual([applied("update:i1")]);
  });

  it("records a retry that failed again", () => {
    const merged = mergeOperationResults(
      [failed("update:i1", "timeout")],
      [failed("update:i1", "still down")]
    );
    expect(merged).toEqual([failed("update:i1", "still down")]);
  });

  it("keeps the original order rather than moving retried rows to the end", () => {
    const merged = mergeOperationResults(
      [applied("a"), failed("b"), applied("c")],
      [applied("b")]
    );
    expect(merged.map((entry) => entry.operationId)).toEqual(["a", "b", "c"]);
  });

  it("appends operations the record has never seen", () => {
    const merged = mergeOperationResults([applied("a")], [applied("b")]);
    expect(merged.map((entry) => entry.operationId)).toEqual(["a", "b"]);
  });

  it("is a no-op against an empty record", () => {
    expect(mergeOperationResults([], [applied("a")])).toEqual([applied("a")]);
    expect(mergeOperationResults([applied("a")], [])).toEqual([applied("a")]);
  });
});

describe("totalling a set of outcomes", () => {
  it("counts each status", () => {
    expect(
      summarizeResults([
        applied("a"),
        applied("b"),
        failed("c"),
        { operationId: "d", status: "skipped", skippedBecause: "already created" },
      ])
    ).toEqual({ applied: 2, failed: 1, skipped: 1, complete: false });
  });

  it("is complete only when nothing failed", () => {
    expect(summarizeResults([applied("a")]).complete).toBe(true);
    // A skip is a success: the write was already made.
    expect(
      summarizeResults([{ operationId: "a", status: "skipped" }]).complete
    ).toBe(true);
    expect(summarizeResults([]).complete).toBe(true);
  });
});
