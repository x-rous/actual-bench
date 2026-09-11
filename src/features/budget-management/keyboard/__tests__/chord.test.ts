import { matchChord, type KeyChord } from "../chord";

function ev(over: Partial<{ key: string; code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) {
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

describe("Alt chords and the macOS key rewrite", () => {
  // Option+A on macOS reports key "å"; matching on `key` alone silently
  // disabled every Alt shortcut there.
  it("matches an Alt letter chord via the physical key", () => {
    const chord: KeyChord = { key: "a", alt: true };
    expect(matchChord(ev({ key: "å", code: "KeyA", altKey: true }), chord)).toBe(true);
  });

  it("still matches an Alt letter chord by key when the layout is unchanged", () => {
    const chord: KeyChord = { key: "a", alt: true };
    expect(matchChord(ev({ key: "a", code: "KeyA", altKey: true }), chord)).toBe(true);
  });

  it("keeps modifier exclusivity when matching by physical key", () => {
    const chord: KeyChord = { key: "a", alt: true };
    // Shift held, chord does not ask for it.
    expect(
      matchChord(ev({ key: "Å", code: "KeyA", altKey: true, shiftKey: true }), chord)
    ).toBe(false);
    // Alt not held at all.
    expect(matchChord(ev({ key: "a", code: "KeyA" }), chord)).toBe(false);
  });

  it("distinguishes Alt+Shift from Alt on the same physical key", () => {
    const alt: KeyChord = { key: "a", alt: true };
    const altShift: KeyChord = { key: "A", alt: true, shift: true };
    const shifted = ev({ key: "Å", code: "KeyA", altKey: true, shiftKey: true });
    expect(matchChord(shifted, alt)).toBe(false);
    expect(matchChord(shifted, altShift)).toBe(true);
  });

  it("does NOT consult the physical key for bare-letter chords", () => {
    // A non-QWERTY layout must keep firing the action for the character the
    // user typed, not for the key in the QWERTY "V" position.
    const chord: KeyChord = { key: "v" };
    expect(matchChord(ev({ key: "d", code: "KeyV" }), chord)).toBe(false);
    expect(matchChord(ev({ key: "v", code: "KeyD" }), chord)).toBe(true);
  });

  it("ignores the physical key for multi-character chords", () => {
    const chord: KeyChord = { key: "Enter", alt: true };
    expect(matchChord(ev({ key: "Enter", code: "Enter", altKey: true }), chord)).toBe(true);
    expect(matchChord(ev({ key: "x", code: "Enter", altKey: true }), chord)).toBe(false);
  });
});
