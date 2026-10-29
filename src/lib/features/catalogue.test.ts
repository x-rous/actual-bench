import { FEATURES, FEATURE_SECTIONS, getFeatureForPath } from "./catalogue";

describe("feature presentation contracts", () => {
  it("keeps implemented features complete and uniquely registered", () => {
    expect(FEATURES).toHaveLength(20);
    expect(new Set(FEATURES.map((feature) => feature.id)).size).toBe(20);
    expect(new Set(FEATURES.map((feature) => feature.href)).size).toBe(20);
    expect(FEATURE_SECTIONS.flatMap((section) => section.items)).toEqual(FEATURES);
    expect(FEATURES.filter((feature) => feature.maturity === "experimental")).toHaveLength(5);
    expect(FEATURES.filter((feature) => feature.groupId === "financial-management").map((feature) => feature.id)).toEqual([
      "budget-management", "reconciliation", "credit-cards", "assets", "loans", "fx-rates",
    ]);
    expect(getFeatureForPath("/reconciliation")?.maturity).toBe("stable");
    expect(getFeatureForPath("/assets")?.id).toBe("assets");
    expect(getFeatureForPath("/overview")).toBeUndefined();
    expect(getFeatureForPath("/app-health")).toBeUndefined();
  });

  it.each([
    ["/rules/diagnostics", "rules-diagnostics"],
    ["/rules/diagnostics/report", "rules-diagnostics"],
    ["/payees/cleanup", "payees-cleanup"],
    ["/payees/cleanup/review", "payees-cleanup"],
    ["/loans/new", "loans"],
    ["/loans/a-loan", "loans"],
    ["/automations/connections", "automations"],
    ["/automations/runs", "automations"],
    ["/rules-old", undefined],
    ["/payees-cleanup", undefined],
    [null, undefined],
  ])("resolves standalone tools and child routes: %s", (path, expected) => {
    expect(getFeatureForPath(path)?.id).toBe(expected);
  });

  it("exposes staged actions only where existing entity or budget edits use them", () => {
    expect(FEATURES.filter((feature) => feature.usesStagedActions).map((feature) => feature.href)).toEqual([
      "/accounts", "/categories", "/payees", "/tags", "/rules", "/schedules",
      "/budget-management", "/payees/cleanup", "/rules/diagnostics",
    ]);
  });

  it("uses the consolidated feedback destinations and preserves intentional omissions", () => {
    for (const path of ["/accounts", "/categories", "/payees", "/tags", "/schedules"]) {
      expect(getFeatureForPath(path)?.feedbackUrl).toBe("https://github.com/x-rous/actual-bench/issues/393");
    }
    expect(getFeatureForPath("/budget-diagnostics")?.feedbackUrl).toBeUndefined();
    expect(getFeatureForPath("/rules")?.feedbackUrl).toBe(getFeatureForPath("/rules/diagnostics")?.feedbackUrl);
    expect(getFeatureForPath("/sync")?.feedbackUrl).toBe(getFeatureForPath("/fx-rates")?.feedbackUrl);
    expect(new Set(FEATURES.flatMap((feature) => feature.feedbackUrl ? [feature.feedbackUrl] : [])).size).toBe(13);
    expect(getFeatureForPath("/assets")?.feedbackUrl).toBe("https://github.com/x-rous/actual-bench/issues/417");
  });
});
