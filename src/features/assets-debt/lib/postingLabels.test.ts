import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { postingBasisLabel, postingStatusLabel, postingTitle } from "./postingLabels";

const base = { appliedAt: null, decidedAt: null, error: null, configRevision: 3, reversalOf: null, basis: { allocation: null, dueDate: null, paidDate: null, assumedEarlier: 0 } };

describe("plain posting labels (T287)", () => {
  it("names what a posting does, never a raw kind", () => {
    expect(postingTitle({ postingKind: "repayment-split", output: { kind: "restructure" } } as unknown as PostingView)).toBe("Repayment split");
    expect(postingTitle({ postingKind: "reversal", output: { kind: "restore-split" } } as unknown as PostingView)).toBe("Undo of repayment split");
    expect(postingTitle({ postingKind: "repayment-link", output: { kind: "convert" } } as unknown as PostingView)).toBe("Make the repayment a loan transfer");
  });

  it("says why a proposal was superseded", () => {
    const superseded = (cause?: string) => postingStatusLabel({ ...base, status: "superseded", error: cause ? { superseded: cause } : null } as unknown as PostingView);
    expect(superseded("newer-preview")).toBe("Replaced by a newer preview");
    expect(superseded("newer-undo")).toBe("Replaced by a newer undo request");
    expect(superseded("actual-changed")).toBe("Not applied: Actual changed before apply");
    expect(superseded()).toBe("Replaced by a newer proposal");
    expect(postingStatusLabel({ ...base, status: "reversed" } as unknown as PostingView)).toBe("Undone");
  });

  it("explains the calculation basis in words, never an engine version", () => {
    const label = postingBasisLabel({ ...base, output: { kind: "restructure" }, basis: { allocation: "accrued-to-due-date", dueDate: "2024-01-02", paidDate: "2023-12-22", assumedEarlier: 1 } } as unknown as PostingView);
    expect(label).toMatch(/interest to the due date .*early-payment benefit next time/);
    expect(label).toMatch(/1 earlier repayment was not found/);
    expect(label).not.toMatch(/projection@|loan-daily@/);
    expect(postingBasisLabel({ ...base, reversalOf: "x", output: { kind: "restore-split" } } as unknown as PostingView)).toMatch(/Restores the rows/);
  });
});
