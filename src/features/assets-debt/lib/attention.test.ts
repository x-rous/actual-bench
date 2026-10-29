import { attentionText, hrefOf } from "./attention";

describe("what a loan needs", () => {
  it("says it in words and opens the loan where it can be acted on", () => {
    expect(attentionText({ code: "interrupted", count: 2 })).toBe("2 writes to Actual not finished: check Actual");
    expect(attentionText({ code: "configuration-blocked", message: "newer version" })).toBe("Settings cannot be used: newer version");
    expect(hrefOf({ subjectKind: "debt", id: "d1", name: "HSBC", reasons: [{ code: "interrupted", count: 1 }] })).toBe("/loans/d1?view=repayments");
    expect(hrefOf({ subjectKind: "debt", id: "d2", name: "Car", reasons: [{ code: "configuration-blocked", message: "x" }] })).toBe("/loans/d2?view=schedule");
  });
});
