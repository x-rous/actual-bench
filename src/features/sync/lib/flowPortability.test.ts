import {
  exportFlowDefinition,
  importFlowDefinition,
  FlowImportError,
} from "./flowPortability";
import { emptyFlowForm } from "./flowForm";

function filledForm() {
  const form = emptyFlowForm();
  form.name = "Joint → Personal";
  form.source = { connectionId: "conn-a", budgetSyncId: "b-src", budgetName: "Home", accountId: "a1", accountName: "Checking" };
  form.target = { connectionId: "conn-b", budgetSyncId: "b-tgt", budgetName: "Family", accountId: "a2", accountName: "Shared" };
  form.automation.updateMappedTargets = true;
  return form;
}

describe("flow export / import (RD-057)", () => {
  it("round-trips a flow, dropping connection ids but keeping names + options", () => {
    const json = exportFlowDefinition(filledForm());
    const back = importFlowDefinition(json);
    expect(back.name).toBe("Joint → Personal");
    expect(back.source.budgetName).toBe("Home");
    expect(back.target.accountName).toBe("Shared");
    expect(back.automation.updateMappedTargets).toBe(true);
    // Connection ids are never carried across - user re-selects.
    expect(back.source.connectionId).toBe("");
    expect(back.target.connectionId).toBe("");
  });

  it("never includes a connection id in the exported JSON", () => {
    const json = exportFlowDefinition(filledForm());
    expect(json).not.toContain("conn-a");
    expect(json).not.toContain("conn-b");
  });

  it("rejects non-JSON and foreign JSON", () => {
    expect(() => importFlowDefinition("not json")).toThrow(FlowImportError);
    expect(() => importFlowDefinition(JSON.stringify({ kind: "something-else" }))).toThrow(FlowImportError);
  });

  it("fills defaults for a partial export", () => {
    const json = JSON.stringify({ kind: "actual-bench-sync-flow", version: 1, flow: { name: "Sparse" } });
    const form = importFlowDefinition(json);
    expect(form.name).toBe("Sparse");
    expect(form.transform.amountDirection).toBe("same"); // default applied
  });
});
