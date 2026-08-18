import { isTractablePattern } from "./core";

/**
 * A `matches` value can be typed by the user and is then run against every row
 * of the budget's history, inside a memo, on the render thread. A pattern that
 * fails to compile was already handled; one that compiles and never finishes
 * looks like the tab has hung.
 */
describe("isTractablePattern", () => {
  it("accepts the patterns this feature generates", () => {
    expect(isTractablePattern("^snack.*shack")).toBe(true);
    expect(isTractablePattern("etihad credit bureau")).toBe(true);
  });

  it("refuses a quantified group that is itself quantified", () => {
    expect(isTractablePattern("(a+)+$")).toBe(false);
    expect(isTractablePattern("(x*)*y")).toBe(false);
    expect(isTractablePattern("(ab+){2,}")).toBe(false);
  });

  it("refuses a quantified alternation whose branches overlap", () => {
    // The one that looks harmless. `(a|aa)+$` carries no nested quantifier at
    // all, and a forty-character near-miss against it takes about ten seconds.
    expect(isTractablePattern("(a|aa)+$")).toBe(false);
    expect(isTractablePattern("(x|xy)*z")).toBe(false);
    expect(isTractablePattern("(uber|ubr){2,}")).toBe(false);
  });

  it("still allows an ordinary group", () => {
    expect(isTractablePattern("(uber)eats")).toBe(true);
    expect(isTractablePattern("^(snack) shack")).toBe(true);
  });

  it("refuses a pattern long enough to be a paste rather than a rule", () => {
    expect(isTractablePattern("a".repeat(201))).toBe(false);
  });
});
