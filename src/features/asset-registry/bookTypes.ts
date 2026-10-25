import { BOOK_TYPES, type BookType } from "@/lib/asset-registry/models";

/** Amount is signed integer minor units. Revaluations and disposal balancing rows can have either sign. */
export function bookTypeChoices(amountMinor: number): BookType[] {
  return (Object.keys(BOOK_TYPES) as BookType[]).filter((type) => {
    if (type === "acquisition" || type === "capital-expenditure") return amountMinor > 0;
    if (type === "depreciation" || type === "impairment") return amountMinor < 0;
    return true;
  });
}
