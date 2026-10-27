import { BOOK_TYPE_TAGS, typeFromNotes, withTypeTag } from "./tags";

it("reads exactly one type tag, case-insensitively, and ignores other hashtags", () => {
  expect(typeFromNotes("Depreciation 2026-01 #depreciation")).toBe("depreciation");
  expect(typeFromNotes("#Depreciation #asset_byd")).toBe("depreciation");
  expect(typeFromNotes("#asset_byd only")).toBeNull();
  expect(typeFromNotes("#acquisition #revaluation")).toBeNull(); // conflicting tags classify nothing
  expect(typeFromNotes("not#capex")).toBeNull(); // a tag must be a whole token
  expect(typeFromNotes(null)).toBeNull();
});
it("replaces the type tag and keeps the rest of the Notes", () => {
  expect(withTypeTag("Appraisal #asset_byd", "revaluation")).toBe("Appraisal #asset_byd #revaluation");
  expect(withTypeTag("Appraisal #revaluation #asset_byd", "impairment")).toBe("Appraisal #asset_byd #impairment");
  expect(withTypeTag("Appraisal #impairment", null)).toBe("Appraisal");
  expect(withTypeTag(null, "depreciation")).toBe(BOOK_TYPE_TAGS.depreciation);
  expect(withTypeTag("x #depreciation", "depreciation")).toBe("x #depreciation");
});

test("replacing a type tag leaves the rest of the Notes untouched", () => {
  expect(withTypeTag("Line one\n\n  indented   text #revaluation", "impairment")).toBe("Line one\n\n  indented   text #impairment");
  expect(withTypeTag("Keep   spacing #revaluation", null)).toBe("Keep   spacing");
});
