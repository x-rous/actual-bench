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
 */
export type KeyChord = {
  key: string | RegExp;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

type EventLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

export function matchChord(e: EventLike, c: KeyChord): boolean {
  const keyMatches = typeof c.key === "string" ? e.key === c.key : c.key.test(e.key);
  if (!keyMatches) return false;
  const mod = e.ctrlKey || e.metaKey;
  return (
    !!mod === !!c.mod &&
    !!e.shiftKey === !!c.shift &&
    !!e.altKey === !!c.alt
  );
}
