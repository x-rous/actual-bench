/** Ephemeral editor guards, independent of staged Actual edits and Save. */
const drafts = new Set<symbol>();

/** Register only while an editor has unsaved changes; release on cleanup. */
export function registerUnsavedDraft() {
  const draft = Symbol();
  drafts.add(draft);
  return () => { drafts.delete(draft); };
}

/** Read at navigation time so connection actions see every mounted dirty editor. */
export function hasUnsavedDrafts() {
  return drafts.size > 0;
}
