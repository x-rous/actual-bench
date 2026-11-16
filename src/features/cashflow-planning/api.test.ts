import { PlanConflictError, PlanLockedError, savePlan } from "./api";
import { createPlanDocument } from "@/lib/cashflow-planning/document";

const document = createPlanDocument({ name: "Test", startMonth: "2026-01", months: 12 });

function respond(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("savePlan", () => {
  it("reports a revision conflict as one, with the server's message", async () => {
    respond(409, { error: "Changed elsewhere" });
    await expect(savePlan({ budgetSyncId: "b", id: "p", baseRevision: 1, document })).rejects.toThrow(new PlanConflictError("Changed elsewhere"));
    await expect(savePlan({ budgetSyncId: "b", id: "p", baseRevision: 1, document })).rejects.toBeInstanceOf(PlanConflictError);
  });

  it("reports a locked app database as locked, not as a conflict", async () => {
    respond(409, { error: "Unlock the vault", code: "VAULT_LOCKED" });
    await expect(savePlan({ budgetSyncId: "b", id: "p", baseRevision: 1, document })).rejects.toBeInstanceOf(PlanLockedError);
  });
});
