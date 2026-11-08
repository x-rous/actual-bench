import { addDays, weekStart, facetFromRows, needsExactRows, emptyPicks, picksWhere, withPicks, buildPickerQuery, dateMatch, buildSearchFilter, emptyFilterState, parsePickerRows, parseSearchTerm, resolveDateRange, rowMatchesState, tagsOf, type PickedTransaction } from "./transactionPickerQuery";

const TODAY = "2026-10-26";
const filter = (state = emptyFilterState(), constraints = {}) => buildSearchFilter(state, constraints, TODAY) as { $and: unknown[] };
const row = (extra: Partial<PickedTransaction> = {}): PickedTransaction => ({ id: "t", accountId: "a", accountName: "Bank", date: "2026-02-01", amountMinor: -1000, payeeId: "p", payeeName: "Shop", categoryId: "c", categoryName: "Food", notes: null, transferId: null, ...extra });

it("builds an unrestricted filter when nothing is chosen, with All time as the default date", () => {
  expect(filter().$and).toEqual([]);
  expect(resolveDateRange({ preset: "all" }, TODAY)).toEqual({});
});
it("resolves each date preset against today", () => {
  expect(resolveDateRange({ preset: "30d" }, TODAY)).toEqual({ from: "2026-09-26", to: TODAY });
  expect(resolveDateRange({ preset: "this-year" }, TODAY)).toEqual({ from: "2026-01-01", to: TODAY });
  expect(resolveDateRange({ preset: "last-year" }, TODAY)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  expect(resolveDateRange({ preset: "custom", from: "2024-03-01" }, TODAY)).toEqual({ from: "2024-03-01" });
});
it("applies every chip and the caller's constraints in one ActualQL query", () => {
  const state = emptyFilterState({ date: { preset: "custom", from: "2025-01-01", to: "2025-12-31" }, accounts: { ids: ["a1"], not: false }, payees: { ids: ["p1"], not: false, none: false }, categories: { ids: ["c1"], not: false, uncategorized: false }, type: "expenses", transfers: "exclude" });
  const and = filter(state, { excludeAccountIds: ["asset"], requireCategory: true }).$and;
  expect(and).toEqual(expect.arrayContaining([{ date: { $gte: "2025-01-01" } }, { date: { $lte: "2025-12-31" } }, { account: { $oneof: ["a1"] } }, { account: { $ne: "asset" } }, { payee: { $oneof: ["p1"] } }, { category: { $oneof: ["c1"] } }, { amount: { $lt: 0 } }, { transfer_id: null }, { category: { $ne: null } }]));
});
it("keeps rows with no payee or category when the filter is 'is not'", () => {
  const and = filter(emptyFilterState({ payees: { ids: ["p1", "p2"], not: true, none: false }, categories: { ids: ["c1"], not: true, uncategorized: true } })).$and;
  expect(and).toContainEqual({ $and: [{ $or: [{ payee: null }, { payee: { $ne: "p1" } }] }, { $or: [{ payee: null }, { payee: { $ne: "p2" } }] }] });
  expect(and).toContainEqual({ category: { $ne: null } });
});
it("compares amounts as absolute values, so a payment and a refund of the same size both match", () => {
  expect(filter(emptyFilterState({ amount: { mode: "equals", a: 6530000 } })).$and).toEqual([{ $or: [{ amount: 6530000 }, { amount: -6530000 }] }]);
  expect(filter(emptyFilterState({ amount: { mode: "more", a: 100 } })).$and).toEqual([{ $or: [{ amount: { $gt: 100 } }, { amount: { $lt: -100 } }] }]);
});
it("lets a caller's sign constraint stand whatever the Type chip says", () => {
  expect(filter(emptyFilterState({ type: "income" }), { amountSign: "negative" }).$and).toEqual([{ amount: { $gt: 0 } }, { amount: { $lt: 0 } }]); // contradictory: nothing matches, never more
});
it("searches payee, category, account and Notes, and also amounts and months", () => {
  expect(parseSearchTerm("65,300.00")).toEqual({ amountMinor: 6530000, signed: false, datePrefix: null });
  expect(parseSearchTerm("-2196.32")).toEqual({ amountMinor: 219632, signed: true, datePrefix: null });
  expect(parseSearchTerm("2026-10")).toMatchObject({ datePrefix: "2026-10" });
  const or = (filter(emptyFilterState({ search: "65300" })).$and[0] as { $or: object[] }).$or;
  expect(or).toEqual(expect.arrayContaining([{ "payee.name": { $like: "%65300%" } }, { "account.name": { $like: "%65300%" } }, { amount: 6530000 }, { amount: -6530000 }]));
  const negative = (filter(emptyFilterState({ search: "-5" })).$and[0] as { $or: object[] }).$or;
  expect(negative).toContainEqual({ amount: -500 }); expect(negative).not.toContainEqual({ amount: 500 });
});
it("narrows by tags on the server (Any / All) and judges exact tags on the rows", () => {
  const any = filter(emptyFilterState({ tags: { names: ["#unit-4", "#rent"], match: "any", none: false, not: false } })).$and[0];
  expect(any).toEqual({ $or: [{ notes: { $like: "%#unit-4%" } }, { notes: { $like: "%#rent%" } }] });
  expect(filter(emptyFilterState({ tags: { names: ["#unit-4", "#rent"], match: "all", none: false, not: false } })).$and[0]).toEqual({ $and: [{ notes: { $like: "%#unit-4%" } }, { notes: { $like: "%#rent%" } }] });
  expect(filter(emptyFilterState({ tags: { names: ["#rent"], match: "any", none: false, not: true } })).$and).toEqual([]); // a negation is judged on the rows
});
it("matches whole tags only, with Any, All, No tags and is-not", () => {
  const tags = (names: string[], extra: Partial<PickedTransaction["notes"] extends never ? never : { match: "any" | "all"; none: boolean; not: boolean }> = {}) => emptyFilterState({ tags: { names, match: "any", none: false, not: false, ...extra } });
  const unit4 = row({ notes: "Rent #Unit-4 #rent" });
  expect(tagsOf("Rent #Unit-4 #rent")).toEqual(["#unit-4", "#rent"]);
  expect(rowMatchesState(unit4, tags(["#unit"]))).toBe(false); // #unit is not #unit-4
  expect(rowMatchesState(unit4, tags(["#unit-4", "#vat"]))).toBe(true);
  expect(rowMatchesState(unit4, tags(["#unit-4", "#vat"], { match: "all" }))).toBe(false);
  expect(rowMatchesState(unit4, tags(["#unit-4", "#rent"], { match: "all" }))).toBe(true);
  expect(rowMatchesState(row({ notes: "plain" }), tags([], { none: true }))).toBe(true);
  expect(rowMatchesState(unit4, tags([], { none: true }))).toBe(false);
  expect(rowMatchesState(unit4, tags(["#rent"], { not: true }))).toBe(false);
  expect(rowMatchesState(row({ notes: "plain" }), tags(["#rent"], { not: true }))).toBe(true);
});
it("applies Advanced conditions on top, ignoring incomplete ones", () => {
  const state = emptyFilterState({ advanced: { match: "all", conditions: [{ field: "notes", operator: "contains", value: "rent" }, { field: "payee", operator: "equals", value: "" }] } });
  expect(rowMatchesState(row({ notes: "Monthly Rent" }), state)).toBe(true);
  expect(rowMatchesState(row({ notes: "Salary" }), state)).toBe(false);
});
it("reads split children inline, newest first, one page at a time", () => {
  const q = buildPickerQuery(emptyFilterState(), {}, TODAY, 500, 500).ActualQLquery;
  expect(q).toMatchObject({ table: "transactions", options: { splits: "inline" }, orderBy: [{ date: "desc" }, { id: "desc" }], limit: 500, offset: 500 });
  expect(buildPickerQuery(emptyFilterState(), {}, TODAY).ActualQLquery).not.toHaveProperty("offset");
});
it("keeps only well-formed integer rows", () => {
  const rows = parsePickerRows({ data: [{ id: "1", date: "2026-01-01", account: "a", "account.name": "Bank", amount: -100 }, { id: "2", date: "2026-01-01", account: "a", amount: 1.5 }, { date: "x" }] });
  expect(rows.map((r) => r.id)).toEqual(["1"]);
  expect(() => parsePickerRows(null)).toThrow(/invalid response/);
});
it("ANDs a caller's extra condition and can ask for transfers only", () => {
  expect(filter(emptyFilterState(), { where: { notes: { $like: "%x%" } } }).$and).toEqual([{ notes: { $like: "%x%" } }]);
  expect(filter(emptyFilterState(), { transfersOnly: true }).$and).toEqual([{ transfer_id: { $ne: null } }]);
});
it("matches a month or a day by date range, never LIKE (Actual dates cannot be matched with it)", () => {
  expect(dateMatch("2026-10")).toEqual({ $and: [{ date: { $gte: "2026-10-01" } }, { date: { $lte: "2026-10-31" } }] });
  expect(dateMatch("2024-02")).toEqual({ $and: [{ date: { $gte: "2024-02-01" } }, { date: { $lte: "2024-02-29" } }] });
  expect(dateMatch("2026-10-05")).toEqual({ date: "2026-10-05" });
  const or = (filter(emptyFilterState({ search: "2026-10" })).$and[0] as { $or: object[] }).$or;
  expect(JSON.stringify(or)).not.toContain('"date":{"$like"');
});
it("offers No payee, and keeps payee-less rows when the payee filter is 'is not'", () => {
  expect(filter(emptyFilterState({ payees: { ids: [], not: false, none: true } })).$and).toEqual([{ payee: null }]);
  expect(filter(emptyFilterState({ payees: { ids: ["p1"], not: false, none: true } })).$and).toEqual([{ $or: [{ payee: { $oneof: ["p1"] } }, { payee: null }] }]);
  expect(filter(emptyFilterState({ payees: { ids: [], not: true, none: true } })).$and).toEqual([{ payee: { $ne: null } }]);
});

it("checks a search containing % or _ against the text, since LIKE would treat them as wildcards", () => {
  const row = (payeeName: string): PickedTransaction => ({ id: "x", accountId: "a", accountName: "Bank", date: "2026-01-01", amountMinor: -100, payeeId: null, payeeName, categoryId: null, categoryName: null, notes: null, transferId: null });
  const state = (search: string) => emptyFilterState({ search });
  expect(rowMatchesState(row("Unit_4 rent"), state("unit_4"))).toBe(true);
  expect(rowMatchesState(row("Unit 4 rent"), state("unit_4"))).toBe(false);
  expect(rowMatchesState(row("Fee 50% off"), state("50%"))).toBe(true);
  expect(rowMatchesState(row("Fee 500"), state("50%"))).toBe(false);
  expect(rowMatchesState(row("Anything"), state("rent"))).toBe(true); // no wildcard characters: the query alone decides
});

it("names starting balances and a few left-out transactions in the query, so aggregates and the list agree", () => {
  const and = filter(emptyFilterState(), { excludeStartingBalance: true, excludeIds: ["x1", "x2"] }).$and;
  expect(and).toEqual(expect.arrayContaining([{ $or: [{ starting_balance_flag: false }, { starting_balance_flag: null }] }, { $or: [{ payee: null }, { "payee.name": { $ne: "Starting Balance" } }] }, { id: { $ne: "x1" } }, { id: { $ne: "x2" } }]));
});
it("turns the chart selections into one condition, and a chart leaves out its own dimension", () => {
  expect(picksWhere(emptyPicks())).toBeUndefined();
  const picks = { categories: ["c1"], uncategorized: true, accounts: ["a1"], payees: [], noPayee: true, months: ["2026-03", "2026-05"], weeks: [] };
  expect(picksWhere(picks)).toEqual({ $and: [
    { $or: [{ category: { $oneof: ["c1"] } }, { category: null }] },
    { account: { $oneof: ["a1"] } },
    { payee: null },
    { $or: [dateMatch("2026-03"), dateMatch("2026-05")] },
  ] });
  expect(picksWhere(picks, "category")).toEqual({ $and: [{ account: { $oneof: ["a1"] } }, { payee: null }, { $or: [dateMatch("2026-03"), dateMatch("2026-05")] }] });
  expect(picksWhere(picks, "month")).not.toEqual(picksWhere(picks));
  expect(withPicks({ where: { notes: "x" } }, { ...emptyPicks(), accounts: ["a1"] }).where).toEqual({ $and: [{ notes: "x" }, { $and: [{ account: { $oneof: ["a1"] } }] }] });
});

it("picks a week by its Monday, and a chart leaves out its own dimension", () => {
  expect(weekStart("2026-07-27")).toBe("2026-07-27");
  expect(weekStart("2026-07-26")).toBe("2026-07-20");
  expect(weekStart("2026-08-02")).toBe("2026-07-27");
  expect(addDays("2026-07-27", 6)).toBe("2026-08-02");
  const week = { $and: [{ date: { $gte: "2026-07-27" } }, { date: { $lte: "2026-08-02" } }] };
  expect(picksWhere({ ...emptyPicks(), weeks: ["2026-07-27"] })).toEqual({ $and: [{ $or: [week] }] });
  expect(picksWhere({ ...emptyPicks(), weeks: ["2026-07-27"] }, "day")).toBeUndefined();
  const rows = [
    { date: "2026-07-27", categoryId: "c", accountId: "a", payeeId: null, amountMinor: -100 },
    { date: "2026-07-28", categoryId: "c", accountId: "a", payeeId: null, amountMinor: -50 },
    { date: "2026-08-03", categoryId: "c", accountId: "a", payeeId: null, amountMinor: -10 },
  ] as never[];
  expect(facetFromRows(rows, { ...emptyPicks(), weeks: ["2026-07-27"] }, "category").map((r) => r.amountMinor)).toEqual([-150]);
  expect(facetFromRows(rows, { ...emptyPicks(), weeks: ["2026-07-27"] }, "day").map((r) => [r.key, r.amountMinor])).toEqual([["2026-07-27", -100], ["2026-07-28", -50], ["2026-08-03", -10]]);
});

it("knows which filters the query cannot test exactly", () => {
  expect(needsExactRows(emptyFilterState())).toBe(false);
  expect(needsExactRows(emptyFilterState({ search: "rent" }))).toBe(false);
  expect(needsExactRows(emptyFilterState({ search: "50%" }))).toBe(true);
  expect(needsExactRows(emptyFilterState({ search: "a_b" }))).toBe(true);
  expect(needsExactRows(emptyFilterState({ tags: { names: ["#rent"], match: "any", none: false, not: false } }))).toBe(true);
  expect(needsExactRows(emptyFilterState({ tags: { names: [], match: "any", none: true, not: false } }))).toBe(true);
});
it("totals rows the way the aggregate query does, applying every selection except the chart's own", () => {
  const rows = [
    row({ id: "1", categoryId: "c1", accountId: "a1", payeeId: "p1", date: "2026-01-05", amountMinor: -100 }),
    row({ id: "2", categoryId: "c1", accountId: "a2", payeeId: null, date: "2026-02-05", amountMinor: -200 }),
    row({ id: "3", categoryId: null, accountId: "a1", payeeId: "p1", date: "2026-02-06", amountMinor: -400 }),
  ];
  expect(facetFromRows(rows, emptyPicks(), "category").map((r) => [r.key, r.month, r.amountMinor])).toEqual([["c1", "2026-01", -100], ["c1", "2026-02", -200], [null, "2026-02", -400]]);
  expect(facetFromRows(rows, { ...emptyPicks(), categories: ["c1"] }, "month")).toEqual([{ key: "2026-01", amountMinor: -100, count: 1 }, { key: "2026-02", amountMinor: -200, count: 1 }]);
  // The category chart ignores the category selection (its other rows stay available) but honours the account selection.
  expect(facetFromRows(rows, { ...emptyPicks(), categories: ["c1"], accounts: ["a1"] }, "category").map((r) => [r.key, r.amountMinor])).toEqual([["c1", -100], [null, -400]]);
  expect(facetFromRows(rows, { ...emptyPicks(), noPayee: true }, "month").reduce((a, r) => a + r.amountMinor, 0)).toBe(-200);
  expect(facetFromRows(rows, { ...emptyPicks(), months: ["2026-02"], uncategorized: true }, "account").map((r) => [r.key, r.amountMinor])).toEqual([["a1", -400]]);
});
