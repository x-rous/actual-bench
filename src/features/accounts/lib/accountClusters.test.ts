import type { EffectiveAccountClass } from "@/lib/account-class";
import { NO_CLUSTER, buildClusters, formatCents, sumBalancesCents } from "./accountClusters";

const row = (id: string, groupId: string | null = null, isDeleted = false) => ({ entity: { id, groupId }, isDeleted });
const groups = [
  { id: "g2", name: "Savings" },
  { id: "g1", name: "Everyday" },
];
const eff = (entries: Record<string, EffectiveAccountClass["accountClass"]>) =>
  new Map(Object.entries(entries).map(([id, c]) => [id, { accountClass: c, source: c ? ("account" as const) : ("none" as const) }]));

describe("sumBalancesCents", () => {
  it("adds whole-unit balances exactly, as integer cents", () => {
    // 0.1 + 0.2 would be 0.30000000000000004 as floats.
    expect(sumBalancesCents(["a", "b"], new Map([["a", 0.1], ["b", 0.2]]))).toBe(30);
  });

  it("keeps the sign of debts", () => {
    expect(sumBalancesCents(["a", "b"], new Map([["a", 1000], ["b", -250.5]]))).toBe(74950);
  });

  it("is null when no account has a balance, so an empty total is not shown as zero", () => {
    expect(sumBalancesCents(["a"], new Map())).toBeNull();
    expect(sumBalancesCents(["a"], undefined)).toBeNull();
  });
});

describe("buildClusters by group", () => {
  const rows = [row("a1", "g2"), row("a2", "g1"), row("a3", null), row("a4", "g2"), row("a5", "gone")];
  const clusters = buildClusters(rows, "group", { groups, effective: new Map(), balances: new Map([["a1", 10], ["a4", 5.5]]) });

  it("orders groups by name and puts accounts with no group (or a deleted group) last", () => {
    expect(clusters.map((c) => c.label)).toEqual(["Everyday", "Savings", "No group"]);
    expect(clusters[2]).toMatchObject({ key: NO_CLUSTER, groupId: null });
    expect(clusters[2].rows.map((r) => r.entity.id)).toEqual(["a3", "a5"]);
  });

  it("keeps the incoming row order inside a cluster", () => {
    expect(clusters[1].rows.map((r) => r.entity.id)).toEqual(["a1", "a4"]);
  });

  it("subtotals each cluster, null where there are no balances", () => {
    expect(clusters.map((c) => c.subtotalCents)).toEqual([null, 1550, null]);
  });
});

describe("buildClusters by class", () => {
  const rows = [row("a1"), row("a2"), row("a3"), row("a4", null, true)];
  const effective = eff({ a1: "loan", a2: "cash", a3: null, a4: "cash" });
  const clusters = buildClusters(rows, "class", {
    groups: undefined,
    effective,
    balances: new Map([["a1", -5000], ["a2", 100], ["a4", 999]]),
  });

  it("lists assets before liabilities and unclassified last", () => {
    expect(clusters.map((c) => c.label)).toEqual(["Cash", "Loan", "Unclassified"]);
    expect(clusters.map((c) => c.accountClass)).toEqual(["cash", "loan", null]);
  });

  it("leaves accounts staged for deletion out of the subtotal", () => {
    expect(clusters[0].subtotalCents).toBe(10000);
    expect(clusters[1].subtotalCents).toBe(-500000);
  });
});

describe("formatCents", () => {
  it("formats like the Balance column", () => {
    expect(formatCents(123450)).toBe("1,234.50");
    expect(formatCents(-5)).toBe("-0.05");
  });
});
