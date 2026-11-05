import { ruleAccounts } from "./trackingReads";

const rule = (...accounts: string[]) => ({ conditions: accounts.map((value) => ({ field: "account", operator: "equals", value })) }) as never;

describe("the accounts a payment rule can find payments in", () => {
  it("is every open account when a rule names none", () => {
    expect(ruleAccounts([rule()], ["a", "b", "loan"], "loan").sort()).toEqual(["a", "b"]);
  });

  it("keeps the accounts other rules name, even when they are not open, next to the open ones", () => {
    expect(ruleAccounts([rule(), rule("closed")], ["a", "loan"], "loan").sort()).toEqual(["a", "closed"]);
  });

  it("is only the named accounts when every rule names some, never the loan's own account, and none without rules", () => {
    expect(ruleAccounts([rule("x"), rule("y", "loan")], ["a"], "loan").sort()).toEqual(["x", "y"]);
    expect(ruleAccounts([], ["a"], "loan")).toEqual([]);
  });
});
