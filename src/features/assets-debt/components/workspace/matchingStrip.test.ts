import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import type { DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import { buildChangeRows } from "./changeRows";
import { matchingFacts, repaymentTimeline } from "./matchingStrip";

const event = (date: string): DebtProjectionEvent => ({ date, eventType: "repayment", cashMovementMinor: -100_000, principalMovementMinor: -90_000, interestMinor: 10_000, feesMinor: 0, balanceBeforeMinor: 1, balanceAfterMinor: 0 } as never);
const row = (o: Record<string, unknown> = {}) => ({ id: "bank", accountId: "chk", date: "2024-01-29", amountMinor: -100_000, payeeId: null, payeeName: null, categoryId: null, notes: null, cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, childCount: 0, ...o });
function split(id: string, due: string, paid: string, patch: Partial<PostingView> = {}, override = false): PostingView {
  return {
    id, budgetSyncId: "b", subjectKind: "debt", subjectId: "d", postingKind: "repayment-split", periodKey: due, generation: 1, configRevision: 1, inputFormatVersion: 2, inputHash: "h",
    engineVersions: {}, classification: "safe", reasons: [], idempotencyMarker: null, status: "applied", decidedAt: null, appliedAt: "2026-10-05T00:00:00Z", actualIds: [], reversalOf: null, error: null,
    createdAt: "t", updatedAt: "t", basis: { allocation: "accrued-to-due-date", dueDate: due, paidDate: paid, assumedEarlier: 0 },
    output: { kind: "restructure", before: row({ date: paid }), operations: [], components: [], expectedPostState: { parentId: "bank", parentAmountMinor: -100_000, children: [] }, accountBudgetStatus: {}, closing: null, ...(override ? { override: { interestMinor: 1, calculatedInterestMinor: 0, reason: null } } : {}) } as never,
    ...patch,
  } as PostingView;
}

describe("the Transactions strip's repayment timeline (T305)", () => {
  const events = ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01", "2024-05-01", "2024-06-01"].map(event);
  const rows = buildChangeRows(
    [split("a", "2024-01-01", "2023-12-27"), split("e", "2024-02-01", "2024-01-29", {}, true), split("p", "2024-03-01", "2024-02-26", { status: "proposed" })],
    [{ code: "repayment-missing", periodKey: "2024-04-01", text: "Not found" }],
  );

  it("one cell per due date: applied, applied with an edit, found, not found, next and upcoming", () => {
    expect(repaymentTimeline(events, rows, "2024-04-15").map((c) => c.state)).toEqual(["applied", "edited", "found", "missing", "next", "upcoming"]);
  });

  it("facts: counts, the next expected payment, the last match and how early payments arrive", () => {
    const cells = repaymentTimeline(events, rows, "2024-04-15");
    expect(matchingFacts(events, rows, cells, "2024-04-15")).toEqual({
      due: 4, done: 2, upcoming: 2, edited: 1, missing: 1, notApplied: 1,
      next: { date: "2024-05-01", amountMinor: 100_000 },
      lastMatched: { paidDate: "2024-02-26", dueDate: "2024-03-01" },
      averageEarlyDays: 4,
    });
  });
});
