/**
 * Token-aware hashtag handling for Actual notes (RD-071 D3).
 *
 * Nothing else in the repo does this. `src/lib/sync/notesMarker.ts` appends a
 * fixed marker string and is not reusable here.
 *
 * PR-034a ships the **tokenizer** only, because matching's `strip-tags`
 * preprocessing needs it. The mutation operations (add/remove/replace/append,
 * feature spec §26) land in PR-034c on top of these primitives.
 *
 * The token boundary is the critical contract (feature spec §25): a tag ends at
 * whitespace, end-of-string, or sentence punctuation. `#One` must never match
 * inside `#OneDrive`. Every operation here is token-aware; blind substring
 * handling of notes is what silently destroys user data.
 */

/**
 * A tag occurrence within a note.
 *
 * `start`/`end` are indices into the original string, so a caller can splice
 * without re-scanning and without disturbing any other character.
 */
export type NoteTag = {
  /** Tag text including the leading `#`, as written (case preserved). */
  raw: string;
  /** Tag text without the leading `#`. */
  name: string;
  start: number;
  /** Exclusive. */
  end: number;
};

/**
 * Matches a `#tag` that begins at the start of the string or after whitespace,
 * and ends at whitespace, end-of-string, or sentence punctuation.
 *
 * The body accepts letters, digits, underscore and hyphen. `#OneDrive` is a
 * single tag named `OneDrive` — which is exactly why a `#One` replacement must
 * compare whole names rather than prefixes.
 */
const TAG_PATTERN = /(^|\s)(#([\p{L}\p{N}_-]+))(?=$|\s|[.,;:!?])/gu;

/** Find every tag occurrence in a note, in order of appearance. */
export function findNoteTags(notes: string | null | undefined): NoteTag[] {
  if (!notes) return [];
  const found: NoteTag[] = [];
  // The regex is stateful (`g`); use a local copy so concurrent callers cannot
  // interfere with each other through `lastIndex`.
  const pattern = new RegExp(TAG_PATTERN.source, TAG_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(notes)) !== null) {
    const leading = match[1] ?? "";
    const raw = match[2];
    const name = match[3];
    const start = match.index + leading.length;
    found.push({ raw, name, start, end: start + raw.length });
  }
  return found;
}

/** The distinct tag names in a note, lower-cased for comparison. */
export function noteTagNames(notes: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const tag of findNoteTags(notes)) seen.add(tag.name.toLowerCase());
  return [...seen];
}

/**
 * True when `notes` carries `tag`, compared case-insensitively on the whole
 * token. Accepts the tag with or without its leading `#`.
 *
 * `hasNoteTag("Dinner #OneDrive", "#One")` is **false**.
 */
export function hasNoteTag(
  notes: string | null | undefined,
  tag: string
): boolean {
  const wanted = normalizeTagName(tag);
  if (!wanted) return false;
  return noteTagNames(notes).includes(wanted);
}

/**
 * Strip every `#tag` token from a note, leaving all other text intact.
 *
 * Used by matching's `strip-tags` preprocessing: tags are never bank text, so
 * removing them sharpens comparison against the statement description without
 * touching the merchant text or the user's own words.
 *
 * Whitespace left behind by a removed tag is collapsed, and the result trimmed,
 * so `"Imported #One Family dinner"` yields `"Imported Family dinner"`.
 */
export function stripNoteTags(notes: string | null | undefined): string {
  if (!notes) return "";
  const tags = findNoteTags(notes);
  if (tags.length === 0) return notes.trim();

  let out = "";
  let cursor = 0;
  for (const tag of tags) {
    out += notes.slice(cursor, tag.start);
    cursor = tag.end;
  }
  out += notes.slice(cursor);
  return collapseWhitespace(out);
}

/** Collapse runs of whitespace and trim, without touching other characters. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Normalize a tag for comparison: drop a leading `#`, lower-case, trim. */
export function normalizeTagName(tag: string | null | undefined): string {
  if (!tag) return "";
  return tag.trim().replace(/^#/, "").toLowerCase();
}
