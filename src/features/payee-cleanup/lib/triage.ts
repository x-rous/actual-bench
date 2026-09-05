/**
 * What a user needs to triage a suggestion, and what makes one safe to accept
 * in bulk (RD-078 §11; F-096 follow-up).
 *
 * The main screen is for *decisions*, not investigation. Everything here answers
 * one question — "do I agree these payees should become this payee?" — and
 * everything that answers "why does Bench think so?" belongs in the review
 * drawer.
 */

import type { CleanupSuggestion } from "./scan";

export type TriageBadge = {
  id: string;
  label: string;
  tone: "neutral" | "positive" | "warning";
};

/**
 * The badges shown on a compact card.
 *
 * Normal is compressed, exceptional is expanded: a clean result collapses to a
 * couple of quiet chips, while a genuine conflict gets a warning tone and stays
 * visible. Wording stays literal — a rule *referencing* these payees is not a
 * conflict, because merging does not rewrite rules, so the badge says how many
 * rules there are rather than implying a problem that does not exist.
 */
export function triageBadges(suggestion: CleanupSuggestion): TriageBadge[] {
  const badges: TriageBadge[] = [];
  const impact = suggestion.impact;

  if (impact) {
    const total = impact.transactionTotal;
    badges.push({
      id: "transactions",
      tone: total === undefined && !impact.transactionsLoading ? "warning" : "neutral",
      label:
        total !== undefined
          ? `${total.toLocaleString("en-US")} ${total === 1 ? "transaction" : "transactions"}`
          : impact.transactionsLoading
            ? "counting transactions…"
            : // Not loading and still unknown means the read failed or never
              // ran. Saying "counting…" forever would describe work that is not
              // happening.
              "transaction count unavailable",
    });

    const activeRules = impact.rules.regular + impact.rules.activeSchedule;
    badges.push(
      activeRules === 0
        ? { id: "rules", tone: "positive", label: "No rules affected" }
        : {
            id: "rules",
            tone: "neutral",
            label: `${activeRules} ${activeRules === 1 ? "rule" : "rules"} reference these`,
          }
    );

    const settingsDiffer =
      impact.behavior.favoriteDiffers || impact.behavior.learnCategoriesDiffers;
    badges.push(
      settingsDiffer
        ? {
            id: "settings",
            tone: "warning",
            label: "Payee settings differ - the one you keep decides",
          }
        : { id: "settings", tone: "positive", label: "Settings match" }
    );
  }

  const future = suggestion.futureResolution;
  if (future?.recommended) {
    badges.push(
      future.recommended.unexpectedMatches === 0
        ? { id: "rule", tone: "positive", label: "Safe future-import rule" }
        : {
            id: "rule",
            tone: "warning",
            label: `Future rule would also catch ${future.recommended.unexpectedMatches} other transactions`,
          }
    );
  } else if (future?.skipReason === "already-resolved-by-name") {
    badges.push({
      id: "rule",
      tone: "positive",
      label: "Future imports resolve by name",
    });
  }

  if (future?.relatedRules.some((r) => r.interaction === "potential-conflict")) {
    badges.push({
      id: "rule-overlap",
      tone: "warning",
      label: "An existing rule may conflict",
    });
  }

  return badges;
}

/**
 * Whether a suggestion can be accepted without opening it.
 *
 * Deliberately stricter than "the score is high". A bulk action that means
 * "accept everything above 90%" would sweep up the cases this feature exists to
 * catch — an interpreted reduction, a settings conflict, a rule that steals
 * another payee's transactions. Every clause below is a reason a human should
 * look:
 *
 * - the match must be **structural**, not inferred from corpus repetition or
 *   spelling similarity;
 * - the payees must agree on Favorite and Category learning, since the merge
 *   silently resolves that by whichever payee survives;
 * - no proposed rule may catch a transaction belonging to anyone else;
 * - no existing rule may be flagged as potentially conflicting.
 *
 * Bulk-accepted suggestions are still only *staged*: the plan, its validation
 * and an explicit Save all still stand between this and the budget.
 */
export function isSafeForBulkAccept(suggestion: CleanupSuggestion): boolean {
  const { confidence, cluster, impact, futureResolution } = suggestion;

  if (confidence.band !== "high" && confidence.band !== "strong") return false;
  if (cluster.fuzzyOnly) return false;

  // An interpreted step — a company suffix, or text the corpus inferred — is
  // exactly the kind of guess a person should confirm.
  const structural = cluster.evidence.some((e) => e.kind === "structural");
  const contextual = cluster.evidence.some((e) => e.kind === "contextual");
  if (!structural || contextual) return false;

  if (impact) {
    if (impact.behavior.favoriteDiffers || impact.behavior.learnCategoriesDiffers) {
      return false;
    }
    // Counts still loading: not knowing the blast radius is a reason to wait.
    if (impact.transactionTotal === undefined) return false;
  }

  if (futureResolution) {
    // A "catches nothing else" claim built on a truncated history is not a
    // basis for accepting without looking.
    if (futureResolution.historyTruncated) return false;
    if (
      futureResolution.recommended &&
      futureResolution.recommended.unexpectedMatches > 0
    ) {
      return false;
    }
    if (
      futureResolution.relatedRules.some((r) => r.interaction === "potential-conflict")
    ) {
      return false;
    }
  }

  return true;
}

export type NameCollision = {
  /** The shared final name, as the user typed it on the first group. */
  finalName: string;
  suggestions: CleanupSuggestion[];
};

/**
 * Accepted groups that would end up with the same payee name.
 *
 * This is the signal behind both the block and the offer to combine: the user
 * has effectively said these payees are one merchant, so cleanup can either
 * refuse or act on it. Refusing alone leaves them to reconcile it by hand.
 */
export function findNameCollisions(
  suggestions: CleanupSuggestion[]
): NameCollision[] {
  const byName = new Map<string, CleanupSuggestion[]>();

  for (const suggestion of suggestions) {
    if (suggestion.correction.decision !== "accepted") continue;
    const key = suggestion.canonicalName.trim().toUpperCase().replace(/\s+/g, " ");
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), suggestion]);
  }

  return [...byName.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({ finalName: group[0].canonicalName.trim(), suggestions: group }));
}

/** A short, human summary of what the scan removed. */
export function detectionSummary(suggestion: CleanupSuggestion): string {
  // The evidence describes what the detector found. Once the user has combined
  // groups or dropped members, repeating it would explain a grouping that no
  // longer exists.
  if (suggestion.cluster.userEdited) return "Grouped by you";

  // Deduplicated by *part*, not by whole label. A cluster carries both the full
  // reduction and the structural-only one, whose labels overlap — joining them
  // verbatim printed "statement details after the date, card number" twice.
  const parts = new Set<string>();
  for (const evidence of suggestion.cluster.evidence) {
    for (const part of evidence.label.replace(/^removed\s+/i, "").split(", ")) {
      const cleaned = part.trim().toLowerCase();
      if (cleaned) parts.add(cleaned);
    }
  }
  if (parts.size === 0) return "Similar names";
  return `Detected ${[...parts].join(", ")}`;
}

/**
 * Splits a raw payee name into the parts the reduction removed and the parts it
 * kept, so the card can show *why* a name was grouped without making the user
 * decipher a hundred characters of bank text.
 *
 * Best-effort by design: a removal that cannot be located in the original —
 * because an earlier step already rewrote that span — is simply not highlighted
 * rather than approximated.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function annotateNoise(
  rawName: string,
  removals: string[]
): { text: string; noise: boolean }[] {
  const spans: { start: number; end: number }[] = [];

  for (const removal of removals) {
    for (const piece of removal.split(" · ")) {
      const needle = piece.trim();
      if (needle.length < 2) continue;
      // Searched case-insensitively against the original string rather than an
      // upper-cased copy: upper-casing can change length (`ß` → `SS`), which
      // shifts every later index and strikes through the wrong characters.
      const match = new RegExp(escapeRegex(needle), "i").exec(rawName);
      if (!match) continue;
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  if (spans.length === 0) return [{ text: rawName, noise: false }];

  spans.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }

  const parts: { text: string; noise: boolean }[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.start > cursor) {
      parts.push({ text: rawName.slice(cursor, span.start), noise: false });
    }
    parts.push({ text: rawName.slice(span.start, span.end), noise: true });
    cursor = span.end;
  }
  if (cursor < rawName.length) {
    parts.push({ text: rawName.slice(cursor), noise: false });
  }
  return parts;
}
