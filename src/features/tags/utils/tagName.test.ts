import { normalizeTagName } from "./tagName";

it("keeps tag names usable in notes: no whitespace, no leading #", () => {
  expect(normalizeTagName("  my tag ")).toBe("mytag");
  expect(normalizeTagName("##food")).toBe("food");
  expect(normalizeTagName("a\tb")).toBe("ab");
  expect(normalizeTagName("ok-1")).toBe("ok-1");
  // "#food#rent" in a note is two tags, so one tag cannot be named that way.
  expect(normalizeTagName("food#rent")).toBe("foodrent");
  expect(normalizeTagName("# #")).toBe("");
});
