import { FEATURES, getFeatureForPath } from "./catalogue";
import { getFeatureEntryState } from "./pendingChanges";

it.each(["/credit-cards", "/credit-cards/card", "/loans", "/loans/new", "/loans/a-loan", "/reconciliation", "/reconciliation/session"])("requires clean global drafts on %s", path => {
  const feature = getFeatureForPath(path)!;
  expect(feature.pendingChangesPanel).toBe("none");
  expect(feature.requiresSavedData).toBe(true);
  expect(getFeatureEntryState(feature, false, false)).toEqual({ blocked: false, usesBudgetActions: false, showStagedActions: false });
  expect(getFeatureEntryState(feature, true, false)).toEqual({ blocked: true, usesBudgetActions: false, showStagedActions: true });
  expect(getFeatureEntryState(feature, false, true)).toEqual({ blocked: true, usesBudgetActions: true, showStagedActions: true });
  expect(getFeatureEntryState(feature, true, true).usesBudgetActions).toBe(false);
});

it("keeps the budget's own edits accessible, but resolves entity drafts first", () => {
  const feature = getFeatureForPath("/budget-management");
  expect(getFeatureEntryState(feature, false, true)).toEqual({ blocked: false, usesBudgetActions: true, showStagedActions: true });
  expect(getFeatureEntryState(feature, true, true)).toEqual({ blocked: true, usesBudgetActions: false, showStagedActions: true });
});

it("requires saved data wherever the global panel is hidden", () => {
  for (const feature of FEATURES.filter(f => f.pendingChangesPanel === "none")) {
    expect(feature.requiresSavedData).toBe(true);
  }
  expect(getFeatureEntryState(getFeatureForPath("/accounts"), true, true).blocked).toBe(false);
  expect(getFeatureEntryState(getFeatureForPath("/query"), true, true).blocked).toBe(false);
  expect(getFeatureForPath("/loans-unrelated")).toBeUndefined();
});
