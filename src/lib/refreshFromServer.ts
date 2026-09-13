/**
 * Refreshing what is on screen, in the order that actually works.
 *
 * Two different caches sit between a user and their budget, and only one of them
 * was ever being cleared:
 *
 * ```text
 * server  ──sync()──►  the budget the app holds  ──queries──►  what is on screen
 * ```
 *
 * In Direct mode the middle step is a copy of the budget living in the browser.
 * The toolbar's Refresh invalidated the query cache alone, so it discarded the
 * right-hand layer and re-read the middle one — which is why it appeared to work
 * whenever nothing had changed elsewhere, and could not help whenever something
 * had.
 *
 * **The order is the fix, not the sync.** Invalidating first refetches every
 * query from the budget as it stands, and only then does the sync update it, so
 * the screens settle on what was there a moment before the refresh — exactly
 * what the button is pressed to escape. Extracted here so that ordering is a
 * thing a test can hold, rather than a comment someone reorders past.
 */

export type RefreshFromServerInput = {
  /** Pull the budget from the server. A no-op where reads already go there. */
  sync: () => Promise<void>;
  /** Drop the query caches sitting in front of it. */
  invalidate: () => Promise<unknown>;
  /** Told when the budget could not be pulled, so the press is not silent. */
  onSyncFailed?: (error: unknown) => void;
};

export async function refreshFromServer(input: RefreshFromServerInput): Promise<void> {
  try {
    await input.sync();
  } catch (error) {
    input.onSyncFailed?.(error);
  }

  // Invalidated even when the sync failed: the caches may still be older than
  // the budget the app holds, so refreshing them is worth doing either way.
  await input.invalidate();
}
