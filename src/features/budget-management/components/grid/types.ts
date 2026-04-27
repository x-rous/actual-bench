/** Bounds (in category × month index space) of the active rectangular selection. */
export type SelectionBounds = {
  minCatIdx: number;
  maxCatIdx: number;
  minMonthIdx: number;
  maxMonthIdx: number;
};

/** Returns true when the given (catIdx, monthIdx) lies within `bounds`. */
export function isCellSelected(
  catIdx: number,
  monthIdx: number,
  bounds: SelectionBounds | null
): boolean {
  if (!bounds || catIdx === -1 || monthIdx === -1) return false;
  return (
    catIdx >= bounds.minCatIdx &&
    catIdx <= bounds.maxCatIdx &&
    monthIdx >= bounds.minMonthIdx &&
    monthIdx <= bounds.maxMonthIdx
  );
}
