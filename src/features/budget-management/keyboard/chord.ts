/**
 * Key chord descriptor — a portable, declarative shape for matching a
 * single keypress. The keymap table is built from these.
 *
 * `mod` matches **either** Ctrl (Win/Linux) or Cmd (macOS) — never have
 * separate bindings for the two platforms. `key` may be a literal string
 * (`"Enter"`, `"ArrowUp"`, `"z"`, `" "`) or a `RegExp` for character-class
 * bindings (e.g. digit-to-edit).
 *
 * Modifier flags are **exclusive** by default: a chord without `shift: true`
 * does NOT match an event where Shift is held. This prevents `Tab` from
 * accidentally firing for `Shift+Tab`. Set the flag explicitly if you want
 * Shift held; leave it out (or `false`) if you want it forbidden.
 *
 * ## Alt chords and `event.key`
 *
 * On macOS, holding Option rewrites the character the browser reports:
 * Option+A arrives as `key: "å"`, Option+L as `"¬"`, Option+C as `"ç"`. A
 * chord written as `{ key: "a", alt: true }` therefore never matched there,
 * which silently disabled every Alt shortcut on a Mac.
 *
 * For **single-letter chords that require Alt**, fall back to the physical
 * `event.code` (`"KeyA"`). The fallback is deliberately limited to Alt chords:
 * bare-letter bindings must keep matching the character the user actually
 * typed, or a non-QWERTY layout would fire the wrong action.
 */
export type KeyChord = {
  key: string | RegExp;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

type EventLike = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
> & {
  /** Physical key. Optional so synthetic events without it still match by `key`. */
  code?: string;
};

const SINGLE_LETTER = /^[a-zA-Z]$/;

/** `"a"` / `"A"` -> `"KeyA"`; null for anything that is not one letter. */
function physicalCodeFor(key: string): string | null {
  return SINGLE_LETTER.test(key) ? `Key${key.toUpperCase()}` : null;
}

function keyMatchesChord(e: EventLike, c: KeyChord): boolean {
  if (typeof c.key !== "string") return c.key.test(e.key);
  if (e.key === c.key) return true;
  // See the Alt note above: only Alt chords consult the physical key.
  if (!c.alt || !e.code) return false;
  const code = physicalCodeFor(c.key);
  return code !== null && e.code === code;
}

export function matchChord(e: EventLike, c: KeyChord): boolean {
  if (!keyMatchesChord(e, c)) return false;
  const mod = e.ctrlKey || e.metaKey;
  return (
    !!mod === !!c.mod &&
    !!e.shiftKey === !!c.shift &&
    !!e.altKey === !!c.alt
  );
}
