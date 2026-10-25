import { BOOK_TYPES, type BookType } from "./models";

/**
 * Each book transaction type has a readable hashtag that Bench writes into the row's Notes in Actual, so the
 * classification is visible and searchable in Actual itself and survives without Bench's saved metadata.
 */
export const BOOK_TYPE_TAGS: Record<BookType, string> = {
  "opening-balance": "#opening-balance", acquisition: "#acquisition", "capital-expenditure": "#capex", revaluation: "#revaluation",
  depreciation: "#depreciation", impairment: "#impairment", "ownership-adjustment": "#ownership-adjustment", disposal: "#disposal", "other-adjustment": "#adjustment",
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
