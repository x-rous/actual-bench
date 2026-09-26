/**
 * Go to a page of this app with a full load rather than client-side routing.
 * Signing out, and a session that ended mid-use, use it on purpose: a full
 * load drops every connection and credential the tab held in memory. (Signing
 * in doesn't need one; it has nothing to drop.) One module so tests can stand
 * in for it.
 */
export function fullPageLoad(path: string): void {
  window.location.assign(path);
}
