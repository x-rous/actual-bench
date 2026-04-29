import { chordToLabel } from "../chordLabel";

describe("chordToLabel", () => {
  describe("non-macOS rendering", () => {
    const isMac = false;

    it("renders Ctrl+letter", () => {
      expect(chordToLabel({ key: "z", mod: true }, isMac)).toBe("Ctrl+Z");
    });

    it("renders Ctrl+Shift+letter in canonical order", () => {
      expect(chordToLabel({ key: "z", mod: true, shift: true }, isMac)).toBe("Ctrl+Shift+Z");
    });

    it("renders Alt+letter", () => {
      expect(chordToLabel({ key: "l", alt: true }, isMac)).toBe("Alt+L");
    });

    it("renders bare keys", () => {
      expect(chordToLabel({ key: "Enter" }, isMac)).toBe("Enter");
      expect(chordToLabel({ key: "F2" }, isMac)).toBe("F2");
      expect(chordToLabel({ key: "v" }, isMac)).toBe("V");
    });

    it("renders arrow keys with arrow glyphs", () => {
      expect(chordToLabel({ key: "ArrowUp" }, isMac)).toBe("↑");
      expect(chordToLabel({ key: "ArrowDown" }, isMac)).toBe("↓");
      expect(chordToLabel({ key: "ArrowLeft" }, isMac)).toBe("←");
      expect(chordToLabel({ key: "ArrowRight" }, isMac)).toBe("→");
    });

    it("renders Space", () => {
      expect(chordToLabel({ key: " " }, isMac)).toBe("Space");
    });

    it("renders Page/Home/End shorthand", () => {
      expect(chordToLabel({ key: "PageUp" }, isMac)).toBe("PgUp");
      expect(chordToLabel({ key: "PageDown" }, isMac)).toBe("PgDn");
      expect(chordToLabel({ key: "Home" }, isMac)).toBe("Home");
      expect(chordToLabel({ key: "End" }, isMac)).toBe("End");
    });

    it("renders Shift+E (uppercase E from event.key under shift)", () => {
      expect(chordToLabel({ key: "E", shift: true }, isMac)).toBe("Shift+E");
    });

    it("renders the digit-to-edit regex as a friendly hint", () => {
      expect(chordToLabel({ key: /^[0-9.+\-(]$/ }, isMac)).toBe("0–9 . + − (");
    });

    it("renders punctuation literals", () => {
      expect(chordToLabel({ key: "[" }, isMac)).toBe("[");
      expect(chordToLabel({ key: "]" }, isMac)).toBe("]");
      expect(chordToLabel({ key: "?", shift: true }, isMac)).toBe("Shift+?");
    });

    it("renders Ctrl+/ for the help binding", () => {
      expect(chordToLabel({ key: "/", mod: true }, isMac)).toBe("Ctrl+/");
    });
  });

  describe("macOS rendering", () => {
    const isMac = true;

    it("uses ⌘ instead of Ctrl", () => {
      expect(chordToLabel({ key: "z", mod: true }, isMac)).toBe("⌘Z");
    });

    it("uses ⌥ for Alt and ⇧ for Shift, no separator", () => {
      expect(chordToLabel({ key: "l", alt: true }, isMac)).toBe("⌥L");
      expect(chordToLabel({ key: "z", mod: true, shift: true }, isMac)).toBe("⌘⇧Z");
    });
  });
});
