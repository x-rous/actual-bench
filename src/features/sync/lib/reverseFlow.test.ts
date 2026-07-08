import { buildReverseFlowForm, canCreateReverseFlow } from "./reverseFlow";
import { emptyFlowForm, type SyncFlowFormState } from "./flowForm";
import type { BrowserApiConnection } from "@/store/connection";

const conn1: BrowserApiConnection = { id: "c1", label: "Home", mode: "browser-api", baseUrl: "https://s.example.com", serverPassword: "pw", budgetSyncId: "b-src" };
const conn2: BrowserApiConnection = { id: "c2", label: "Family", mode: "browser-api", baseUrl: "https://t.example.com", serverPassword: "pw", budgetSyncId: "b-tgt" };

function form(): SyncFlowFormState {
  const f = emptyFlowForm();
  f.name = "Card sync";
  f.enabled = true;
  f.source = { connectionId: "c1", budgetSyncId: "b-src", budgetName: "Home", accountId: "acct-src", accountName: "Checking" };
  f.target = { connectionId: "c2", budgetSyncId: "b-tgt", budgetName: "", accountId: "acct-tgt", accountName: "" };
  f.transform.amountDirection = "reverse";
  f.filter.payeeInclude = "Coffee Bar";
  f.filter.startDate = "2026-07-01";
  return f;
}

describe("buildReverseFlowForm", () => {
  it("swaps source and target and preserves the amount direction", () => {
    const reverse = buildReverseFlowForm(form(), [conn1, conn2]);
    expect(reverse.source).toMatchObject({ connectionId: "c2", accountId: "acct-tgt", budgetName: "Family" });
    expect(reverse.target).toMatchObject({ connectionId: "c1", accountId: "acct-src", budgetName: "Home" });
    expect(reverse.transform.amountDirection).toBe("reverse");
  });

  it("names the reverse flow and creates it disabled for review", () => {
    const reverse = buildReverseFlowForm(form(), [conn1, conn2]);
    expect(reverse.name).toBe("Card sync (reverse)");
    expect(reverse.enabled).toBe(false);
  });

  it("resets filters to safe open-ended defaults", () => {
    const reverse = buildReverseFlowForm(form(), [conn1, conn2]);
    expect(reverse.filter.payeeInclude).toBe("");
    expect(reverse.filter.startDate).toBe("");
  });

  it("requires both endpoints before a reverse can be created", () => {
    expect(canCreateReverseFlow(form())).toBe(true);
    const partial = emptyFlowForm();
    partial.source = form().source;
    expect(canCreateReverseFlow(partial)).toBe(false);
  });
});
