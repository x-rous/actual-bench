import { buildPlan, describePlan, emptyPurchase, pickReason, planProblem, planValueDelta, planWritesToActual, type PurchaseDraft } from "./wizardPlan";
import type { PickedTransaction } from "@/components/transactions/transactionPickerQuery";

const row = (extra: Partial<PickedTransaction> = {}): PickedTransaction => ({ id: "r", accountId: "bank", accountName: "Bank", date: "2026-02-01", amountMinor: -8000000, payeeId: null, payeeName: "Dealer", categoryId: "c", categoryName: "Cars", notes: null, transferId: null, ...extra });
const draft = (extra: Partial<PurchaseDraft>): PurchaseDraft => ({ ...emptyPurchase(), ...extra });
const name = (id: string) => id === "bank" ? "Bank" : "";

it("lets the picked transaction decide the plan: an expense is capitalized, rows in the asset's account become its start", () => {
  expect(buildPlan(draft({}), "", name)).toBeNull();
  expect(buildPlan(draft({ path: "skip" }), "", name)).toEqual({ kind: "skip" });
  expect(buildPlan(draft({ path: "existing" }), "", name)).toBeNull(); // nothing picked yet
  expect(buildPlan(draft({ path: "existing", pick: row() }), "", name)).toEqual({ kind: "expense", source: row() });
  expect(buildPlan(draft({ path: "existing", pick: row() }), "asset-acct", name)).toMatchObject({ kind: "expense" }); // in another account
  expect(buildPlan(draft({ path: "existing", pick: row({ accountId: "asset-acct", amountMinor: 8000000, transferId: "t" }) }), "asset-acct", name)).toMatchObject({ kind: "transfer" });
  expect(buildPlan(draft({ path: "existing", pick: row({ accountId: "asset-acct", amountMinor: 25000000 }) }), "asset-acct", name)).toMatchObject({ kind: "opening-existing" });
});
it("builds a manual value and a not-yet-recorded payment from what was typed", () => {
  expect(buildPlan(draft({ path: "manual", amount: "250000", date: "2026-01-10" }), "", name)).toMatchObject({ kind: "opening-new", amountMinor: 25000000, date: "2026-01-10" });
  expect(buildPlan(draft({ path: "new", fromAccountId: "bank", categoryId: "c", amount: "80,000.50" }), "", name)).toMatchObject({ kind: "new-purchase", amountMinor: 8000050, fromAccountName: "Bank" });
});
it("says why a transaction cannot be picked, in plain words", () => {
  const none = new Set<string>();
  expect(pickReason(row(), "", none)).toBeNull();
  expect(pickReason(row({ categoryId: null }), "", none)).toMatch(/category/);
  expect(pickReason(row({ amountMinor: 100 }), "", none)).toMatch(/paid out/);
  expect(pickReason(row({ transferId: "t" }), "asset-acct", none)).toMatch(/matching transaction in the asset's account/);
  expect(pickReason(row({ accountId: "asset-acct", amountMinor: -5 }), "asset-acct", none)).toMatch(/money in/);
  expect(pickReason(row({ accountId: "asset-acct", amountMinor: 5 }), "asset-acct", none)).toBeNull();
  expect(pickReason(row(), "", new Set(["r"]))).toMatch(/Already used/);
});
it("says what is missing, what changes the value and what writes to Actual", () => {
  expect(planProblem({ kind: "new-purchase", fromAccountId: "", fromAccountName: "", categoryId: "", amountMinor: 0, date: "2026-02-01", notes: "" })).toMatch(/account you paid from/);
  expect(planProblem({ kind: "opening-new", amountMinor: 0, date: "2026-02-01", notes: "" })).toMatch(/starting value/);
  expect(planValueDelta({ kind: "expense", source: row() })).toBe(8000000); // the expense is money out; the asset gains its value
  expect(planValueDelta({ kind: "transfer", row: row() })).toBe(0);
  expect(planWritesToActual({ kind: "expense", source: row() })).toBe(true); expect(planWritesToActual({ kind: "transfer", row: row() })).toBe(false);
  expect(describePlan({ kind: "expense", source: row() })).toMatch(/expense and its category stay exactly as they are/);
});
