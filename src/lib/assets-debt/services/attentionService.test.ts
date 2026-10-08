import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { readMatchingHistory } from "../actual/ledgerPort";
import { listDebtMatchRules } from "@/lib/app-db/debtMatchRuleRepository";
import { getFinancialPosting } from "@/lib/app-db/financialPostingRepository";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { listNeedsAttention } from "./attentionService";
import { runDebtBacktest } from "./backtestService";
import { closeSettledFailures } from "./actualBinding";
import { approveAndBeginApply, proposeReversal, recordApplyOutcome } from "./postingWorkflowService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
afterEach(() => resetAppDbForTests());

describe("needs attention across loans (T293)", () => {
  it("lists a loan with changes to review, worst state first; nothing when there is nothing to do", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    expect(listNeedsAttention(s.db, "budget-1")).toEqual([]);
    s.seedPayment("2024-02-01");
    await s.preview({ from: "2024-02-01", to: "2024-02-29" });
    const [item] = listNeedsAttention(s.db, "budget-1");
    expect(item).toMatchObject({ subjectKind: "debt", id: s.debtId, filter: "action", reasons: [{ code: "review", count: 1 }] });
  });

  it("flags an active loan whose repayment matching is not enabled", () => {
    const s = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    s.db.prepare("UPDATE debt_match_rules SET enabled = 0 WHERE debt_id = ?").run(s.debtId);
    const items = listNeedsAttention(s.db, "budget-1");
    expect(items[0]?.reasons).toEqual([{ code: "matching-not-enabled" }]);
  });

  it("retires an old failed Undo after a replacement Undo succeeds, retaining the error history", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    const window = { from: "2024-02-01", to: "2024-02-29" };
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    await s.apply(split);
    const input = { accountDirectory: s.directory, transferPayees: s.transferPayees, today: "2024-06-02" };
    const failedUndo = proposeReversal(s.db, split.id, input, "2024-06-02T00:00:00.000Z");
    approveAndBeginApply(s.db, failedUndo.id, { fresh: await s.fresh(failedUndo), decidedAt: "2024-06-02T00:00:00.000Z" });
    recordApplyOutcome(s.db, failedUndo.id, { status: "failed", error: { stage: "preflight", message: "old failure", written: false } }, "2024-06-02T00:00:01.000Z");
    expect(listNeedsAttention(s.db, "budget-1")[0]?.reasons).toContainEqual({ code: "failed", count: 1 });

    const replacement = proposeReversal(s.db, split.id, input, "2024-06-02T00:00:01.500Z");
    expect((await s.apply(replacement, "2024-06-02T00:00:01.500Z")).posting.status).toBe("applied");
    await s.preview(window);

    expect(getFinancialPosting(s.db, failedUndo.id)).toMatchObject({ status: "superseded", error: { message: "old failure", written: false, superseded: "replaced-by-applied" } });
    expect(listNeedsAttention(s.db, "budget-1").flatMap((item) => item.reasons)).not.toContainEqual(expect.objectContaining({ code: "failed" }));
  });

  it("keeps a failed Undo unresolved when only the original repayment is applied", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    await s.apply(split);
    const undo = s.undo(split);
    approveAndBeginApply(s.db, undo.id, { fresh: await s.fresh(undo), decidedAt: "2024-06-02T00:00:03.000Z" });
    recordApplyOutcome(s.db, undo.id, { status: "failed", error: { stage: "preflight", written: false } }, "2024-06-02T00:00:04.000Z");
    expect(closeSettledFailures(s.db, s.debtId)).toBe(0);
    expect(listNeedsAttention(s.db, "budget-1")[0]?.reasons).toContainEqual({ code: "failed", count: 1 });
  });

  it("retires a failed repayment by payment identity after its due date is realigned", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    const window = { from: "2024-02-01", to: "2024-02-29" };
    const [failed] = byKind((await s.preview(window)).postings, "repayment-split");
    approveAndBeginApply(s.db, failed.id, { fresh: await s.fresh(failed), decidedAt: "2024-06-01T00:00:00.000Z" });
    recordApplyOutcome(s.db, failed.id, { status: "failed", error: { stage: "preflight", written: false } }, "2024-06-01T00:00:01.000Z");
    s.db.prepare("UPDATE financial_postings SET period_key = ? WHERE id = ?").run("2024-03-01", failed.id);
    const [replacement] = byKind((await s.preview(window)).postings, "repayment-split");
    expect((await s.apply(replacement)).posting.status).toBe("applied");
    await s.preview(window);
    expect(getFinancialPosting(s.db, failed.id)?.status).toBe("superseded");
  });
});

describe("backtest uses the same actual-date split as Activity (T292)", () => {
  it("an early payment's expected interest equals the proposal's, not the scheduled calculation", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    const [split] = byKind((await s.preview({ from: "2024-01-01", to: "2024-02-29" })).postings, "repayment-split");
    const proposalInterest = Math.abs((split.output as unknown as { operations: { economicKind: string; amountMinor: number }[] }).operations.find((c) => c.economicKind === "interest")!.amountMinor);
    const rule = listDebtMatchRules(s.db, s.debtId).find((r) => r.purpose === "repayment")!;
    const snapshots = await readMatchingHistory(s.transport, { accountIds: [ACCOUNTS.checking], from: "2024-01-01", to: "2024-02-29" });
    const result = runDebtBacktest(s.db, s.debtId, { ...rule, purpose: "repayment" } as never, { from: "2024-01-01", to: "2024-02-29", snapshots });
    const period = result.periods.find((p) => p.expected.date === "2024-02-01")!;
    expect(period.status).toBe("unique");
    expect(period.expected.interestMinor).toBe(proposalInterest);
  });
});
