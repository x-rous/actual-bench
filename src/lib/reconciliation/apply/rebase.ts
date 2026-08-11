/**
 * Rebasing a staged note onto one that changed underneath it (feature spec §42).
 *
 * A reconciliation session is long-lived. Someone can stage a tag rename, go and
 * edit that same note in Actual, and come back an hour later. Writing the staged
 * string then would silently delete what they wrote in between — the exact
 * data loss this feature spends most of its effort avoiding.
 *
 * Three versions exist at that point:
 *
 *   base    what the note said when the session read it
 *   ours    what the session staged
 *   theirs  what the note says now
 *
 * The staged change is recovered as the difference between `base` and `ours` —
 * which words left and which arrived — and that difference is replayed onto
 * `theirs`. Note edits in this feature are token-level by construction (rename a
 * tag, drop a tag, append a remark), so a token-level replay reproduces them
 * exactly while leaving everything else the user wrote alone.
 *
 * When the replay cannot be trusted, this says so rather than guessing. Refusing
 * costs a review; guessing costs the user's words.
 */

export type RebaseResult =
  | { status: "unchanged"; notes: string | null }
  | { status: "rebased"; notes: string | null }
  | { status: "conflict"; reason: string };

function tokensOf(value: string | null | undefined): string[] {
  return (value ?? "").split(/\s+/).filter(Boolean);
}

/** Tokens in `from` that are absent from `to`, kept in order and with repeats. */
function missingFrom(from: string[], to: string[]): string[] {
  const remaining = [...to];
  const result: string[] = [];
  for (const token of from) {
    const index = remaining.indexOf(token);
    if (index === -1) result.push(token);
    else remaining.splice(index, 1);
  }
  return result;
}

export function rebaseNotes(
  base: string | null,
  ours: string | null,
  theirs: string | null
): RebaseResult {
  const baseText = base ?? "";
  const oursText = ours ?? "";
  const theirsText = theirs ?? "";

  // Nothing was staged, so whatever the note says now simply stands.
  if (oursText === baseText) return { status: "unchanged", notes: theirs };

  // The note did not move under us; the staged value applies as it is.
  if (theirsText === baseText) return { status: "unchanged", notes: ours };

  // Someone else arrived at the same text. Nothing to do and nothing at risk.
  if (theirsText === oursText) return { status: "unchanged", notes: ours };

  const baseTokens = tokensOf(baseText);
  const oursTokens = tokensOf(oursText);
  const theirsTokens = tokensOf(theirsText);

  const removed = missingFrom(baseTokens, oursTokens);
  const added = missingFrom(oursTokens, baseTokens);

  // Every word the staged change removed has to still be there, or the note has
  // moved in a way this cannot reason about — the user edited the same words.
  const stillPresent = missingFrom(removed, theirsTokens);
  if (stillPresent.length > 0) {
    return {
      status: "conflict",
      reason:
        "The note changed in Actual in a way that overlaps this change, so it needs a look before applying.",
    };
  }

  // Replay in place: each removed word is substituted by the corresponding new
  // one where it stood, which is what makes a renamed tag keep its position
  // rather than migrating to the end of the note.
  const substitutions = new Map<string, string[]>();
  removed.forEach((token, index) => {
    const replacement = added[index];
    const queue = substitutions.get(token) ?? [];
    queue.push(replacement ?? "");
    substitutions.set(token, queue);
  });

  const rebuilt: string[] = [];
  for (const token of theirsTokens) {
    const queue = substitutions.get(token);
    if (queue && queue.length > 0) {
      const replacement = queue.shift();
      if (replacement) rebuilt.push(replacement);
      continue;
    }
    rebuilt.push(token);
  }

  // Anything the staged change added beyond the substitutions is appended, so an
  // appended remark stays appended.
  for (const token of added.slice(removed.length)) {
    if (!rebuilt.includes(token)) rebuilt.push(token);
  }

  const merged = rebuilt.join(" ").trim();
  if (merged === theirsText) return { status: "unchanged", notes: theirs };
  return { status: "rebased", notes: merged || null };
}
