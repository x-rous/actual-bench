import { BOOK_TYPES, type BookType } from "@/lib/asset-registry/models";

/** Amount is signed integer minor units. */
export function bookTypeChoices(amountMinor: number): BookType[] {
  return (Object.keys(BOOK_TYPES) as BookType[]).filter((type) => {
    if (type === "acquisition" || type === "added-capital") return amountMinor > 0;
    if (type === "depreciation" || type === "impairment") return amountMinor < 0;
    return true;
  });
}
