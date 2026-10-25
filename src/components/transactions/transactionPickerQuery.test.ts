import { buildPickerFilter, buildPickerQuery, parsePickerRows, PICKER_ROW_LIMIT, type PickerFilters } from "./transactionPickerQuery";

const none: PickerFilters = { dateFrom: "", dateTo: "", accountIds: [], categoryIds: [], payeeIds: [], search: "" };

it("builds an unrestricted filter when nothing is chosen", () => {
  expect(buildPickerFilter(none)).toEqual({ $and: [] });
});
it("applies every filter and the caller's constraints in one ActualQL query", () => {
  const filter = buildPickerFilter(
    { dateFrom: "2026-01-01", dateTo: "2026-03-31", accountIds: ["a"], categoryIds: ["c1", "c2"], payeeIds: ["p"], search: " fuel " },
    { excludeAccountIds: ["book"], amountSign: "negative", excludeTransfers: true, requireCategory: true });
  expect(filter.$and).toEqual([
    { date: { $gte: "2026-01-01" } }, { date: { $lte: "2026-03-31" } }, { account: { $oneof: ["a"] } }, { account: { $ne: "book" } },
    { category: { $oneof: ["c1", "c2"] } }, { payee: { $oneof: ["p"] } }, { amount: { $lt: 0 } }, { transfer_id: null }, { category: { $ne: null } },
    { $or: [{ "payee.name": { $like: "%fuel%" } }, { "category.name": { $like: "%fuel%" } }, { notes: { $like: "%fuel%" } }] },
  ]);
});
it("reads split children inline, newest first, capped", () => {
  const { ActualQLquery: q } = buildPickerQuery(none);
  expect(q).toMatchObject({ table: "transactions", options: { splits: "inline" }, orderBy: [{ date: "desc" }], limit: PICKER_ROW_LIMIT });
});
it("keeps only well-formed integer rows", () => {
  const rows = parsePickerRows({ data: [
    { id: "t1", date: "2026-02-01", amount: -1250, account: "a", "account.name": "Bank", payee: "p", "payee.name": "Shell", category: "c", "category.name": "Fuel", notes: "", transfer_id: null },
    { id: "bad", date: "2026-02-01", amount: 1.5, account: "a" }, { date: "2026-02-01", amount: 1, account: "a" },
  ] });
  expect(rows).toEqual([{ id: "t1", date: "2026-02-01", accountId: "a", accountName: "Bank", amountMinor: -1250, payeeId: "p", payeeName: "Shell", categoryId: "c", categoryName: "Fuel", notes: null, transferId: null }]);
  expect(() => parsePickerRows(null)).toThrow("invalid response");
});
it("ANDs a caller's extra condition", () => {
  expect(buildPickerFilter(none, { where: { $or: [{ amount: 1 }] } }).$and).toEqual([{ $or: [{ amount: 1 }] }]);
});
it("can ask for transfers only", () => {
  expect(buildPickerFilter(none, { transfersOnly: true }).$and).toEqual([{ transfer_id: { $ne: null } }]);
});
