import { planPrune } from "./prune";
import type { Registry } from "./models";

const disposal = { version: 1 as const, data: { kind: "disposal" as const, representation: "external-receipt" as const, carryingRemovedMinor: 100, bookAdjustmentTransactionId: null, proceedsBasis: "net" as const } };
const registry: Registry = {
  assets: [], metadata: [{ actualTransactionId: "typed", actualAccountId: "vehicles", assetId: null, classification: "revaluation", revision: 1 }],
  cashflows: [
    { actualTransactionId: "rent", actualAccountId: "bank", assetId: "a", classification: null, revision: 1 },
    { actualTransactionId: "sale", actualAccountId: "bank", assetId: "a", classification: "disposal-proceeds", context: disposal, revision: 1 },
    { actualTransactionId: "fee", actualAccountId: "bank", assetId: "a", classification: "other-excluded", context: { version: 1, data: { kind: "selling-cost", disposalTransactionId: "sale" } }, revision: 1 },
  ],
};
it("drops what Actual no longer has, but never in an account that was not read completely", () => {
  const read = { directory: ["vehicles", "bank"], accounts: [{ accountId: "vehicles", ids: [] }, { accountId: "bank", ids: ["rent", "sale", "fee"] }] };
  expect(planPrune(registry, read)).toEqual({ removeBook: ["typed"], removeCashflow: [] });
  expect(planPrune(registry, { directory: ["vehicles", "bank"], accounts: [{ accountId: "bank", ids: ["rent", "sale", "fee"] }] }).removeBook).toEqual([]); // vehicles was not read
});
it("drops a selling cost whose sale is gone, and anything in an account that no longer exists", () => {
  expect(planPrune(registry, { directory: ["vehicles", "bank"], accounts: [{ accountId: "vehicles", ids: ["typed"] }, { accountId: "bank", ids: ["rent", "fee"] }] }).removeCashflow.sort()).toEqual(["fee", "sale"]);
  expect(planPrune(registry, { directory: ["vehicles"], accounts: [] }).removeCashflow.sort()).toEqual(["fee", "rent", "sale"]);
});
