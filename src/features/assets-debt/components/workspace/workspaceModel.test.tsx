import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { bulkSteps, bulkSummary, runBulk } from "./bulkApply";
import { buildChangeRows, bulkOrder, countByFilter, rowsFor } from "./changeRows";
import { setupChecklist } from "./LoanSetup";
import { stepsOf } from "./steps";
import { stripState } from "./LoanStatusStrip";
import { invalidateCachedStatus, loanStatusKey, readCachedStatus } from "./useBackgroundRefresh";

const row = (id: string, amountMinor = -100000) => ({ id, accountId: "chk", date: "2024-02-01", amountMinor, payeeId: null, payeeName: null, categoryId: null, notes: null, cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, childCount: 0 });
const split = { kind: "restructure", before: row("bank"), components: [{ kind: "principal", amountMinor: 60000 }, { kind: "interest", amountMinor: 40000 }], operations: [{ economicKind: "principal", amountMinor: -60000, categoryId: null, payeeId: null, transferAccountId: null, notes: "Principal" }, { economicKind: "interest", amountMinor: -40000, categoryId: null, payeeId: null, transferAccountId: null, notes: "Interest" }], expectedPostState: { parentId: "bank", parentAmountMinor: -100000, children: [] }, accountBudgetStatus: {}, closing: null };

function posting(id: string, patch: Partial<PostingView> = {}): PostingView {
  return {
    id, budgetSyncId: "b", subjectKind: "debt", subjectId: "d", postingKind: "repayment-split", periodKey: "2024-02-01", generation: 1, configRevision: 1, inputFormatVersion: 2, inputHash: "h",
    engineVersions: {}, classification: "review", reasons: [{ code: "r", text: "Review it." }], idempotencyMarker: null, status: "proposed", decidedAt: null, appliedAt: null, actualIds: null,
    reversalOf: null, error: null, createdAt: "2024-06-01T00:00:00Z", updatedAt: "2024-06-01T00:00:00Z", output: split as never, basis: { allocation: null, dueDate: null, paidDate: null, assumedEarlier: 0 }, ...patch,
  } as PostingView;
}

describe("the Activity list model (T289)", () => {
  it("one row per change: an Undo sits on the row it reverses, superseded versions are earlier versions, newest due date first", () => {
    const rows = buildChangeRows([
      posting("old", { status: "superseded", error: { superseded: "newer-preview" } as never, output: { ...split, components: [{ kind: "principal", amountMinor: 59000 }, { kind: "interest", amountMinor: 41000 }] } as never }),
      // Recalculated to the same change (an earlier month was applied): not a version the user sees.
      posting("same", { status: "superseded", error: { superseded: "newer-preview" } as never }),
      posting("p1"),
      posting("a1", { periodKey: "2024-03-01", status: "applied", appliedAt: "2024-06-02T00:00:00Z" }),
      posting("u1", { postingKind: "reversal", periodKey: "a1", reversalOf: "a1" }),
      posting("b1", { periodKey: "2024-01-01", classification: "blocked" }),
      posting("s1", { periodKey: "2023-12-01", classification: "safe" }),
    ]);
    expect(rows.map((r) => r.key)).toEqual(["a1", "p1", "b1", "s1"]);
    const applied = rows.find((r) => r.key === "a1")!;
    expect(applied).toMatchObject({ state: "undo-pending", group: "action", selectable: "undo" });
    expect(applied.undo?.id).toBe("u1");
    expect(rows.find((r) => r.key === "p1")!.earlier.map((p) => p.id)).toEqual(["old"]);
    expect(rows.find((r) => r.key === "b1")).toMatchObject({ state: "blocked", selectable: null });
    expect(rows.find((r) => r.key === "s1")).toMatchObject({ state: "recommended", selectable: "apply" });
  });

  it("notices are Waiting rows unless a change for the period has a row; counts and filters follow the groups", () => {
    const rows = buildChangeRows([posting("p1"), posting("r1", { periodKey: "2024-04-01", status: "reversed" })], [
      { code: "repayment-missing", periodKey: "2024-05-01", text: "The repayment has not been found in Actual yet." },
      { code: "waiting-for-lender", periodKey: "2024-02-01", text: "Waiting for the lender's row." },
    ]);
    expect(rows.find((r) => r.key === "p1")!.notice?.code).toBe("waiting-for-lender");
    expect(countByFilter(rows)).toEqual({ action: 1, waiting: 1, applied: 0, undone: 1, all: 3 });
    expect(rowsFor(rows, "waiting").map((r) => r.state)).toEqual(["waiting"]);
  });

  it("bulk order: changes oldest first, undos newest first (owner refinement 1)", () => {
    const rows = buildChangeRows([
      posting("feb"), posting("jan", { periodKey: "2024-01-01" }), posting("mar", { periodKey: "2024-03-01" }),
      posting("a1", { periodKey: "2023-11-01", status: "applied" }), posting("u1", { postingKind: "reversal", periodKey: "a1", reversalOf: "a1" }),
      posting("a2", { periodKey: "2023-12-01", status: "applied" }), posting("u2", { postingKind: "reversal", periodKey: "a2", reversalOf: "a2" }),
    ]);
    expect(bulkOrder(rows).map((r) => r.key)).toEqual(["a2", "a1", "jan", "feb", "mar"]);
    expect(bulkSteps(rows).map((s) => [s.action, s.target.id])).toEqual([["undo", "u2"], ["undo", "u1"], ["apply", "jan"], ["apply", "feb"], ["apply", "mar"]]);
  });
});

describe("bulk apply runner (T290)", () => {
  const rows = buildChangeRows([posting("jan", { periodKey: "2024-01-01" }), posting("feb"), posting("mar", { periodKey: "2024-03-01" })]);
  const steps = bulkSteps(rows);

  it("applies in order and reports every row applied", async () => {
    const apply = jest.fn(async (step: (typeof steps)[number]) => ({ ...step.target, status: "applied" }) as PostingView);
    const result = await runBulk(steps, apply);
    expect(apply.mock.calls.map(([s]) => s.target.id)).toEqual(["jan", "feb", "mar"]);
    expect(bulkSummary(result)).toBe("3 applied");
  });

  it("stops at the first failure and never attempts the later months", async () => {
    const apply = jest.fn(async (step: (typeof steps)[number]) => ({ ...step.target, status: step.target.id === "feb" ? "failed" : "applied", error: { issues: [{ detail: "The interest line does not hold the previewed values." }] } }) as PostingView);
    const result = await runBulk(steps, apply);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(result.applied.map((r) => r.key)).toEqual(["jan"]);
    expect(result.notAttempted.map((r) => r.key)).toEqual(["mar"]);
    expect(bulkSummary(result)).toMatch(/^1 applied · stopped at 2024-02-01: The interest line does not hold the previewed values\. The remaining change was not applied and has been recalculated/);
  });

  it("stops when the server refuses the preflight (Actual changed)", async () => {
    const result = await runBulk(steps, async (step) => {
      if (step.target.id === "jan") throw new Error("Preflight refused: amountMinor of bank");
      return { ...step.target, status: "applied" } as PostingView;
    });
    expect(result.applied).toEqual([]);
    expect(result.stopped?.reason).toMatch(/^Actual changed before apply/);
    expect(result.notAttempted).toHaveLength(2);
  });
});

describe("two-step lender flow labels (T278)", () => {
  it("names the split and the link as steps 1 and 2; no lender feed means no steps", () => {
    const link = posting("link", { postingKind: "repayment-link", output: { kind: "link", sourceBefore: row("child"), counterpartBefore: row("lender", 60000), transferPayeeId: "tp", expectedPairState: { sourceTransferId: "lender", counterpartTransferId: "child", counterpartAmountMinor: 60000 }, closing: null } as never });
    const steps = stepsOf([posting("split"), link]);
    expect(steps.get("split")).toMatchObject({ index: 1, title: "Split the payment" });
    expect(steps.get("link")).toMatchObject({ index: 2, title: "Link the lender's row" });
    expect(stepsOf([posting("split", { status: "applied" })]).get("split")?.note).toMatch(/Step 2 appears when the lender's row arrives/);
    const noFeed = posting("nf", { output: { ...split, operations: [{ ...split.operations[0], transferAccountId: "loan" }, split.operations[1]] } as never });
    expect(stepsOf([noFeed]).size).toBe(0);
  });
});

describe("Setup checklist (T292)", () => {
  it("lists what is still missing, including matching once the loan is saved", () => {
    const sim = { shape: "term-loan" } as never;
    const tracking = { direction: "owed-by-me", liabilityAccountId: "loan", paymentAccountId: "chk", loanPaymentCategoryId: null, lenderPattern: null } as never;
    const directory = { budgetSyncId: "b", categories: [], accounts: [{ id: "loan", name: "Loan", offBudget: true, closed: false }, { id: "chk", name: "Everyday", offBudget: false, closed: false }] };
    expect(setupChecklist({ sim, tracking, directory, matchingEnabled: false }).map((i) => [i.id, i.done])).toEqual([["liability", true], ["payment", true], ["category", false], ["pattern", false], ["matching", false]]);
    expect(setupChecklist({ sim, tracking, directory, matchingEnabled: null }).some((i) => i.id === "matching")).toBe(false);
  });
});

describe("display-only status cache (owner refinement 4)", () => {
  it("is scoped by server, budget, loan and revision, and an apply or undo drops every revision of the loan", () => {
    const key = (revision: number, debtId = "d1") => loanStatusKey({ baseUrl: "https://a", budgetSyncId: "b", debtId, revision });
    expect(key(1)).not.toBe(key(2));
    expect(loanStatusKey({ baseUrl: "https://other", budgetSyncId: "b", debtId: "d1", revision: 1 })).not.toBe(key(1));
    localStorage.setItem(key(1), JSON.stringify({ at: "2024-01-01T00:00:00Z" }));
    localStorage.setItem(key(2), JSON.stringify({ at: "2024-01-02T00:00:00Z" }));
    localStorage.setItem(key(1, "d2"), JSON.stringify({ at: "x" }));
    expect(readCachedStatus(key(2))?.at).toBe("2024-01-02T00:00:00Z");
    expect(readCachedStatus(key(3))).toBeNull();
    invalidateCachedStatus({ baseUrl: "https://a", budgetSyncId: "b", debtId: "d1" });
    expect(readCachedStatus(key(1))).toBeNull();
    expect(readCachedStatus(key(2))).toBeNull();
    expect(readCachedStatus(key(1, "d2"))).not.toBeNull();
  });
});

describe("the status strip's gap wording (FR-170c)", () => {
  const status = { at: "2026-10-05T00:00:00Z", comparisonDate: "2026-10-05", actualMinor: 6505632, modelMinor: 10523611, lenderMinor: null, lenderDate: null, modelVsActualMinor: -4017979, actualVsLenderMinor: null, drift: "material", reconciliationOverdue: false };
  it("says the pending changes close the gap only when the preview found that they do", () => {
    expect(stripState(status, { review: 31, notApplied: 31 }, 2, true).hint).toBe("Applying the 31 pending changes closes this gap.");
    expect(stripState(status, { review: 31, notApplied: 31 }, 2, false).hint).toMatch(/do not close the whole gap/);
  });
});

describe("missed months shown as one row", () => {
  it("consecutive due dates with no payment read as one row, oldest first; anything between breaks the run", async () => {
    const { buildChangeRows, groupMissedRows } = await import("./changeRows");
    const notice = (periodKey: string) => ({ code: "repayment-missing", periodKey, text: `No payment for ${periodKey}.` });
    const rows = buildChangeRows([], [notice("2024-01-01"), notice("2024-02-01"), notice("2024-03-01"), { code: "payment-side-not-visible", periodKey: "2024-04-01", text: "x" }, notice("2024-05-01")]);
    const shown = groupMissedRows(rows);
    expect(shown.map((r) => r.missedDates ?? [r.dueDate])).toEqual([["2024-05-01"], ["2024-04-01"], ["2024-01-01", "2024-02-01", "2024-03-01"]]);
  });
});
