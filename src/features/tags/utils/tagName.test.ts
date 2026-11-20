import { normalizeTagName } from "./tagName";

it("keeps tag names usable in notes: no whitespace, no leading #", () => {
  expect(normalizeTagName("  my tag ")).toBe("mytag");
  expect(normalizeTagName("##food")).toBe("food");
  expect(normalizeTagName("a\tb")).toBe("ab");
  expect(normalizeTagName("ok-1")).toBe("ok-1");
});
