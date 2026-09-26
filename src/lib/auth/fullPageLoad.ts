/**
 * Go to a page of this app with a full load rather than client-side routing.
 * Signing in and out use it on purpose: a full load starts every part of the
 * app from the new signed-in state, and drops every connection and credential
 * the tab held in memory. One module so tests can stand in for it.
 */
export function fullPageLoad(path: string): void {
  window.location.assign(path);
}
