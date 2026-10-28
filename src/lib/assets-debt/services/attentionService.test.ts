import { resetAppDbForTests } from "@/lib/app-db/connection";
import { finishDebtWrite, startDebtWrite } from "@/lib/app-db/debtTrackingRepository";
import { directory, saveInput, tempDebtDb } from "../testing/debtFixtures";
import { listNeedsAttention } from "./attentionService";
import { createDebtConfiguration } from "./debtConfigService";

afterEach(() => resetAppDbForTests());

const write = { kind: "split", installmentDueDate: "2024-02-01", targetIds: ["p1"], before: {}, after: {} };

describe("needs attention across loans", () => {
  it("lists a loan only while a write to Actual has an unknown outcome", () => {
    const db = tempDebtDb();
    const { debt } = createDebtConfiguration(db, saveInput(), directory(), "2024-01-01T00:00:00.000Z");
    expect(listNeedsAttention(db, "budget-1")).toEqual([]);

    // A failed write wrote nothing: its installment stays Unrecorded on the Repayments tab.
    const failed = startDebtWrite(db, debt.id, write);
    finishDebtWrite(db, debt.id, failed.id, { status: "failed", error: { message: "refused" } });
    expect(listNeedsAttention(db, "budget-1")).toEqual([]);

    const uncertain = startDebtWrite(db, debt.id, write);
    finishDebtWrite(db, debt.id, uncertain.id, { status: "uncertain", error: { message: "timeout" } });
    expect(listNeedsAttention(db, "budget-1")).toEqual([{ subjectKind: "debt", id: debt.id, name: debt.name, reasons: [{ code: "interrupted", count: 1 }] }]);

    // The user checked Actual and resolved it.
    finishDebtWrite(db, debt.id, uncertain.id, { status: "applied" });
    expect(listNeedsAttention(db, "budget-1")).toEqual([]);
  });

  it("counts a write left applying by a closed page once it is stale", () => {
    const db = tempDebtDb();
    const { debt } = createDebtConfiguration(db, saveInput(), directory(), "2024-01-01T00:00:00.000Z");
    const started = startDebtWrite(db, debt.id, write, "2024-06-01T00:00:00.000Z");
    expect(started.status).toBe("applying");
    expect(listNeedsAttention(db, "budget-1", Date.parse("2024-06-01T00:05:00.000Z"))).toEqual([]);
    expect(listNeedsAttention(db, "budget-1", Date.parse("2024-06-01T00:30:00.000Z"))[0]?.reasons).toEqual([{ code: "interrupted", count: 1 }]);
  });
});
