import { chargeCategory, drawWriteSide, openingAdjustmentCategory, paymentChildCategory, transferLegCategory } from "./representation";

const on = { offBudget: false };
const off = { offBudget: true };

describe("account-status representation (T117)", () => {
  it("on-budget payment to an off-budget loan: the payment side carries the loan payment category, the loan side none", () => {
    expect(transferLegCategory(on, off, "cat-loan", "loan payment")).toEqual({ ok: true, categoryId: "cat-loan" });
    expect(transferLegCategory(off, on, "cat-loan", "loan payment")).toEqual({ ok: true, categoryId: null });
    expect(transferLegCategory(on, off, null, "loan payment")).toMatchObject({ ok: false, code: "missing-category", text: "Choose a loan payment category for this debt." });
  });

  it("off-budget interest charge is uncategorized; never a synthetic on-budget row", () => {
    expect(chargeCategory(off, "cat-interest", "interest")).toEqual({ ok: true, categoryId: null });
  });

  it("off-budget capitalized fee is uncategorized", () => {
    expect(chargeCategory(off, "cat-fee", "fee")).toEqual({ ok: true, categoryId: null });
  });

  it("on-budget liability: charges carry the configured category and both-on transfers carry none", () => {
    expect(chargeCategory(on, "cat-interest", "interest")).toEqual({ ok: true, categoryId: "cat-interest" });
    expect(chargeCategory(on, null, "interest")).toMatchObject({ ok: false });
    expect(transferLegCategory(on, on, "cat-loan", "loan payment")).toEqual({ ok: true, categoryId: null });
    expect(paymentChildCategory(on, "cat-interest", "interest")).toEqual({ ok: true, categoryId: "cat-interest" });
    expect(paymentChildCategory(off, "cat-interest", "interest")).toEqual({ ok: true, categoryId: null });
  });

  it("a draw crossing the boundary is written from the on-budget side with the draw category", () => {
    const liability = { id: "loan", offBudget: true };
    const cash = { id: "chk", offBudget: false };
    expect(drawWriteSide(liability, cash)).toBe(cash);
    expect(transferLegCategory(cash, liability, "cat-draw", "draw")).toEqual({ ok: true, categoryId: "cat-draw" });
    expect(drawWriteSide({ id: "loan", offBudget: false }, cash).id).toBe("loan");
  });

  it("opening adjustment: off-budget uncategorized; on-budget only with the user's explicit category", () => {
    expect(openingAdjustmentCategory(off, null)).toEqual({ ok: true, categoryId: null });
    expect(openingAdjustmentCategory(on, null)).toMatchObject({ ok: false, code: "missing-category" });
    expect(openingAdjustmentCategory(on, "cat-adj")).toEqual({ ok: true, categoryId: "cat-adj" });
  });
});
