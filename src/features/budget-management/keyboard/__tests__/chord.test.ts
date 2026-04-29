import { matchChord, type KeyChord } from "../chord";

function ev(over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  };
}

describe("matchChord", () => {
  describe("key matching", () => {
    it("matches a literal key", () => {
      expect(matchChord(ev({ key: "Enter" }), { key: "Enter" })).toBe(true);
      expect(matchChord(ev({ key: "Escape" }), { key: "Enter" })).toBe(false);
    });

    it("matches a regex key", () => {
      const c: KeyChord = { key: /^[0-9]$/ };
      expect(matchChord(ev({ key: "5" }), c)).toBe(true);
      expect(matchChord(ev({ key: "9" }), c)).toBe(true);
      expect(matchChord(ev({ key: "a" }), c)).toBe(false);
      expect(matchChord(ev({ key: "10" }), c)).toBe(false);
    });

    it("matches the digit-to-edit set", () => {
      const c: KeyChord = { key: /^[0-9.+\-(]$/ };
      for (const k of ["0", "5", "9", ".", "+", "-", "("]) {
        expect(matchChord(ev({ key: k }), c)).toBe(true);
      }
      for (const k of ["a", "Enter", "Tab", " ", "[", "}"]) {
        expect(matchChord(ev({ key: k }), c)).toBe(false);
      }
    });
  });

  describe("modifier exclusivity", () => {
    it("rejects events with extra modifiers", () => {
      // Plain Tab should not match when Shift is held.
      expect(matchChord(ev({ key: "Tab", shiftKey: true }), { key: "Tab" })).toBe(false);
      // Plain Enter should not match when Ctrl is held.
      expect(matchChord(ev({ key: "Enter", ctrlKey: true }), { key: "Enter" })).toBe(false);
      // Plain Enter should not match when Alt is held.
      expect(matchChord(ev({ key: "Enter", altKey: true }), { key: "Enter" })).toBe(false);
    });

    it("rejects events that lack required modifiers", () => {
      // Ctrl+Z should not match when Ctrl is not held.
      expect(matchChord(ev({ key: "z" }), { key: "z", mod: true })).toBe(false);
      // Shift+Tab should not match when Shift is not held.
      expect(matchChord(ev({ key: "Tab" }), { key: "Tab", shift: true })).toBe(false);
    });

    it("requires modifier flags to match exactly", () => {
      // Ctrl+Shift+Z requires both — Ctrl alone doesn't match.
      const ctrlShiftZ: KeyChord = { key: "z", mod: true, shift: true };
      expect(matchChord(ev({ key: "z", ctrlKey: true, shiftKey: true }), ctrlShiftZ)).toBe(true);
      expect(matchChord(ev({ key: "z", ctrlKey: true }), ctrlShiftZ)).toBe(false);
      expect(matchChord(ev({ key: "z", shiftKey: true }), ctrlShiftZ)).toBe(false);
    });
  });

  describe("cross-platform mod (Ctrl ↔ Cmd)", () => {
    it("matches Ctrl on Win/Linux", () => {
      expect(matchChord(ev({ key: "z", ctrlKey: true }), { key: "z", mod: true })).toBe(true);
    });

    it("matches Cmd on macOS", () => {
      expect(matchChord(ev({ key: "z", metaKey: true }), { key: "z", mod: true })).toBe(true);
    });

    it("does not require both — either one is fine", () => {
      // Both pressed simultaneously is unusual but should still match.
      expect(matchChord(ev({ key: "z", ctrlKey: true, metaKey: true }), { key: "z", mod: true })).toBe(true);
    });
  });
});
