/** Remove only the feature's legacy financial drafts/statuses, retaining unrelated preferences. */
export function purgeLegacyLoanStorage(): void {
  if (typeof window === "undefined") return;
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = window[name];
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (key?.startsWith("ab:loan-status:") || key?.startsWith("assets-debt:new-loan:") || key?.startsWith("assets-debt:currency:")) storage.removeItem(key);
      }
    } catch { /* A disabled browser storage area must not prevent opening the feature. */ }
  }
}
