import { createPlanDocument, createRow, setCells } from "@/lib/cashflow-planning/document";
import type { PlanRecord } from "@/lib/cashflow-planning/types";
import { useCashflowStore } from "./store";

const record = (): PlanRecord => ({
  id: "p1", budgetSyncId: "b1", name: "Plan", revision: 1, createdAt: "t", updatedAt: "t",
  document: { ...createPlanDocument({ name: "Plan", startMonth: "2026-01", years: 1 }), rows: [createRow({ name: "Salary", section: "income" })] },
});

describe("cashflow plan save status", () => {
  beforeEach(() => {
    useCashflowStore.setState({ budgetSyncId: null, sessions: {}, order: [], activeId: null, unreadable: [] });
    useCashflowStore.getState().hydrate("b1", [record()]);
  });
  const status = () => useCashflowStore.getState().sessions.p1.status;

  it("is saved whenever the working copy is the saved document, so a quick undo does not leave it saving", () => {
    const { edit, undo, redo } = useCashflowStore.getState();
    edit("p1", (d) => setCells(d, [{ rowId: d.rows[0].id, month: "2026-02", amount: 100 }]));
    expect(status()).toBe("dirty");
    undo("p1");
    expect(status()).toBe("saved");
    redo("p1");
    expect(status()).toBe("dirty");
  });

  it("stays in conflict through edits and undo", () => {
    const { edit, undo, failed } = useCashflowStore.getState();
    failed("p1", "conflict", "changed elsewhere");
    edit("p1", (d) => setCells(d, [{ rowId: d.rows[0].id, month: "2026-02", amount: 100 }]));
    undo("p1");
    expect(status()).toBe("conflict");
  });
});
