import { BOOK_TYPES, type BookType } from "./models";

/**
 * Each book transaction type has a readable hashtag. Bench writes it into the Notes only of rows Bench itself creates in
 * Actual; it never edits the Notes of a transaction made elsewhere.
 */
export const BOOK_TYPE_TAGS: Record<BookType, string> = {
  "opening-balance": "#opening-balance", acquisition: "#acquisition", "added-capital": "#added-capital", revaluation: "#revaluation",
  depreciation: "#depreciation", impairment: "#impairment", disposal: "#disposal", "other-adjustment": "#adjustment",
};
export const DEPRECIATION_TAG = BOOK_TYPE_TAGS.depreciation;
const TYPE_BY_TAG = new Map((Object.keys(BOOK_TYPES) as BookType[]).map((type) => [BOOK_TYPE_TAGS[type], type]));
const TAG_PATTERN = /(?<![\p{L}\p{N}_#])#[\p{L}\p{N}_-]+/gu;
/** The one book type a Notes text is tagged with (case-insensitive); none or conflicting tags yield null. */
export function typeFromNotes(notes: string | null | undefined): BookType | null {
  const found = new Set((notes ?? "").match(TAG_PATTERN)?.map((tag) => TYPE_BY_TAG.get(tag.toLowerCase())).filter((t): t is BookType => !!t));
  return found.size === 1 ? [...found][0] : null;
}
/** Notes with every Bench type tag removed and, for a type, its tag appended. Other text and tags are untouched. */
export function withTypeTag(notes: string | null | undefined, type: BookType | null): string {
  // Only the removed tag and the space before it go; every other part of the Notes is left exactly as written.
  const kept = (notes ?? "").replace(/[ \t]*(?<![\p{L}\p{N}_#])#[\p{L}\p{N}_-]+/gu, (match) => TYPE_BY_TAG.has(match.trim().toLowerCase()) ? "" : match).trim();
  return type ? `${kept} ${BOOK_TYPE_TAGS[type]}`.trim() : kept;
}
/** Prefix of the imported ID Bench gives every row it creates in Actual; it is how Bench knows it wrote the row's Notes. */
export const BENCH_ROW_MARKER = "asset-action:";
export const isBenchCreated = (importedId: string | null | undefined): boolean => !!importedId?.startsWith(BENCH_ROW_MARKER);
