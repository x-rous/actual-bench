import { resolveCategory, resolvePayee } from "./entityResolution";

const payees = [
  { id: "tp1", name: "Coffee Bar" },
  { id: "tp2", name: "Market" },
];
const categories = [
  { id: "tc1", name: "Dining" },
  { id: "tc2", name: "Groceries" },
];

describe("resolvePayee", () => {
  it("matches an existing payee by normalized name", () => {
    expect(resolvePayee({ payeeName: "  coffee   BAR " }, { missingPayee: "create" }, payees)).toEqual({
      payeeId: "tp1",
      payeeName: null,
      willCreateOnApply: false,
      leftEmpty: false,
    });
  });

  it("plans to create a missing payee when policy is create", () => {
    expect(resolvePayee({ payeeName: "New Vendor" }, { missingPayee: "create" }, payees)).toEqual({
      payeeId: null,
      payeeName: "New Vendor",
      willCreateOnApply: true,
      leftEmpty: false,
    });
  });

  it("leaves a missing payee empty when policy is leave_empty", () => {
    expect(resolvePayee({ payeeName: "New Vendor" }, { missingPayee: "leave_empty" }, payees)).toEqual({
      payeeId: null,
      payeeName: null,
      willCreateOnApply: false,
      leftEmpty: true,
    });
  });

  it("treats no source payee as neither missing nor left-empty", () => {
    expect(resolvePayee({ payeeName: null }, { missingPayee: "create" }, payees)).toEqual({
      payeeId: null,
      payeeName: null,
      willCreateOnApply: false,
      leftEmpty: false,
    });
  });
});

describe("resolveCategory", () => {
  it("matches an existing category by normalized name", () => {
    expect(resolveCategory({ categoryName: "dining" }, categories)).toEqual({
      categoryId: "tc1",
      leftEmpty: false,
    });
  });

  it("leaves an unmatched category empty without blocking", () => {
    expect(resolveCategory({ categoryName: "Travel" }, categories)).toEqual({
      categoryId: null,
      leftEmpty: true,
    });
  });

  it("treats no source category as empty (not missing)", () => {
    expect(resolveCategory({ categoryName: null }, categories)).toEqual({
      categoryId: null,
      leftEmpty: false,
    });
  });
});
