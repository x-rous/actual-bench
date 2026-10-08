/**
 * Where the loan pages live (rev 4 page split, owner decision 2026-10-05): Loans & Debt and Assets
 * are separate pages. The old `/assets-debt/...` addresses redirect here.
 */
export const LOANS_PATH = "/loans";
export const NEW_LOAN_PATH = "/loans/new";
export const ASSETS_PATH = "/assets";

export function loanPath(id: string, query?: string): string {
  return `${LOANS_PATH}/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
}
