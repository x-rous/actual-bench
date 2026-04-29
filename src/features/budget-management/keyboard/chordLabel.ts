import type { KeyChord } from "./chord";

/**
 * Map raw `event.key` values to user-friendly labels for the cheatsheet.
 * Anything not in the table is rendered as-is (uppercased for letters).
 */
const KEY_LABEL: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "Enter",
  Escape: "Esc",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Home: "Home",
  End: "End",
  " ": "Space",
};

function labelKey(key: string | RegExp): string {
  if (key instanceof RegExp) return "0–9 . + − (";
  if (KEY_LABEL[key] !== undefined) return KEY_LABEL[key]!;
  // Letters: keep the case the chord was authored in (e.g. "E" stays "E"
  // since that's literally what `event.key` delivers under Shift).
  return key.length === 1 ? key.toUpperCase() : key;
}

/**
 * Render a chord as a human-readable string. `mod` resolves to ⌘ on macOS
 * and Ctrl elsewhere — auto-detected via the `userAgent` when available.
 */
export function chordToLabel(chord: KeyChord, isMac = detectMac()): string {
  const parts: string[] = [];
  if (chord.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (chord.alt) parts.push(isMac ? "⌥" : "Alt");
  // Shift comes after the meta keys but before the letter, mirroring the
  // common "Ctrl+Shift+Z" convention.
  if (chord.shift) parts.push(isMac ? "⇧" : "Shift");
  parts.push(labelKey(chord.key));
  // Use a thin separator on macOS (no `+`), spaced `+` elsewhere.
  return isMac ? parts.join("") : parts.join("+");
}

function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // navigator.platform is deprecated but still the most reliable signal in
  // jsdom + browsers without a `userAgentData.platform` value.
  const platform =
    typeof navigator.platform === "string" ? navigator.platform : "";
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}
