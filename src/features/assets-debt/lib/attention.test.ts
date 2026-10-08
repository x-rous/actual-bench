import { attentionText, hrefOf } from "./attention";

describe("what a loan needs (T293, rev 4)", () => {
  it("says it in words and opens the loan where it can be acted on", () => {
    expect(attentionText({ code: "review", count: 4 })).toBe("4 changes to review");
    expect(attentionText({ code: "blocked", count: 1 })).toBe("1 change blocked");
    expect(hrefOf({ subjectKind: "debt", id: "d1", name: "HSBC", filter: "action", reasons: [{ code: "review", count: 4 }] })).toBe("/loans/d1?view=repayments&filter=action");
    expect(hrefOf({ subjectKind: "debt", id: "d2", name: "Car", filter: "all", reasons: [{ code: "matching-not-enabled" }] })).toBe("/loans/d2?view=link");
  });
});
