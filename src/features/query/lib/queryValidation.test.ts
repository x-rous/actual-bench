import { lintQuery } from "./queryValidation";
import type { ActualQLQuery } from "../types";

const ids = (query: ActualQLQuery) => lintQuery(query).map((w) => w.id);

describe("lintQuery - empty $or / $and", () => {
  it("warns on a top-level empty $or", () => {
    expect(
      ids({ table: "transactions", filter: { $or: [] } } as ActualQLQuery),
    ).toContain("empty-compound");
  });

  it("warns on a top-level empty $and", () => {
    expect(
      ids({ table: "transactions", filter: { $and: [] } } as ActualQLQuery),
    ).toContain("empty-compound");
  });

  it("warns on an empty compound nested inside a populated one", () => {
    expect(
      ids({
        table: "transactions",
        filter: { $and: [{ payee: "p-1" }, { $or: [] }] },
      } as ActualQLQuery),
    ).toContain("empty-compound");
  });

  it("warns on an empty compound nested under a field's sub-object", () => {
    expect(
      ids({
        table: "transactions",
        filter: { account: { $and: [] } },
      } as ActualQLQuery),
    ).toContain("empty-compound");
  });

  it("does not warn when every compound is populated", () => {
    expect(
      ids({
        table: "transactions",
        filter: { $or: [{ payee: "p-1" }, { $and: [{ amount: { $gt: 0 } }] }] },
      } as ActualQLQuery),
    ).not.toContain("empty-compound");
  });

  it("does not warn on a plain filter with no compound operators", () => {
    expect(
      ids({
        table: "transactions",
        filter: { date: { $gte: "2026-01-01" } },
      } as ActualQLQuery),
    ).not.toContain("empty-compound");
  });

  it("is reported independently of the empty-$oneof warning", () => {
    // Opposite failure modes: $oneof:[] matches nothing, $or:[] matches everything.
    const warnings = ids({
      table: "transactions",
      filter: { $or: [], account: { $oneof: [] } },
    } as ActualQLQuery);
    expect(warnings).toContain("empty-compound");
    expect(warnings).toContain("empty-oneof");
  });

  it("still finds an empty $oneof sitting beside a compound operator", () => {
    expect(
      ids({
        table: "transactions",
        filter: { $or: [{ payee: "p-1" }], account: { $oneof: [] } },
      } as ActualQLQuery),
    ).toContain("empty-oneof");
  });

  it("catches the case the unbounded-scan warning misses", () => {
    // `{ $or: [] }` is a non-empty object, so the query counts as "filtered"
    // and unbounded-transactions stays silent - this warning is the only signal.
    const warnings = ids({
      table: "transactions",
      filter: { $or: [] },
    } as ActualQLQuery);
    expect(warnings).not.toContain("unbounded-transactions");
    expect(warnings).toContain("empty-compound");
  });
});
