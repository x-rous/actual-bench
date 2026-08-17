/**
 * Merge-target selection and canonical-name suggestion (RD-078 §8, §9).
 *
 * Two decisions the spec insists on keeping apart:
 *
 * - **which payee id survives** — this is what Actual's native
 *   `mergePayees(targetId, mergeIds)` takes, and it carries the surviving
 *   payee's `favorite` / `learn_categories` (neither of which Bench can write,
 *   so choosing the target *is* how the user resolves a behavior difference);
 * - **what the surviving payee should be called** — an ordinary rename, staged
 *   separately and freely editable.
 *
 * §8 also warns against applying its ranking rigidly. So this is a transparent
 * additive score with a reason per contribution, not a priority list: the UI
 * shows why a target was suggested and the user can override it.
 */

import { deriveForms, looksHumanReadable } from "./derivedForms";
import type { PayeeCluster } from "./clusterResolver";
import type { PayeeCleanupCandidate } from "../types";

/**
 * Impact signals that only exist once 041c has run. Passed in rather than
 * fetched so target selection stays a pure function and 041b can suggest a
 * target with name evidence alone.
 */
export type TargetSignals = {
  /** Transaction count per payee id. */
  transactionCounts?: Map<string, number>;
  /** Count of rules referencing each payee id. */
  ruleCounts?: Map<string, number>;
};

export type TargetScore = {
  payeeId: string;
  score: number;
  reasons: string[];
};

export type TargetSuggestion = {
  targetId: string;
  scores: TargetScore[];
  reasons: string[];
};

export function suggestTarget(
  cluster: PayeeCluster,
  signals: TargetSignals = {}
): TargetSuggestion {
  const maxTransactions = Math.max(
    1,
    ...cluster.members.map((m) => signals.transactionCounts?.get(m.id) ?? 0)
  );

  const scores: TargetScore[] = cluster.members.map((member) => {
    const reasons: string[] = [];
    let score = 0;

    if (looksHumanReadable(deriveForms(member.name))) {
      score += 40;
      reasons.push("Clean, human-readable name");
    }

    if (member.metadata.favorite) {
      // §1.7: favorite is real user intent, and merge does not transfer it —
      // the target's own value survives. Weighted heavily for that reason.
      score += 25;
      reasons.push("Marked as a favorite payee");
    }

    const rules = signals.ruleCounts?.get(member.id) ?? 0;
    if (rules > 0) {
      score += 15;
      reasons.push(`Referenced by ${rules} existing ${rules === 1 ? "rule" : "rules"}`);
    }

    const transactions = signals.transactionCounts?.get(member.id);
    if (transactions !== undefined && transactions > 0) {
      // Scaled, not absolute: being the most-used name in the group is a
      // signal, but a machine-generated name with the most transactions should
      // still lose to a clean one.
      const scaled = Math.round((transactions / maxTransactions) * 15);
      score += scaled;
      if (scaled > 0) {
        reasons.push(`Used by ${transactions} transactions`);
      }
    }

    // Shorter names are usually the canonical merchant rather than a variant
    // carrying extra machine text. Small weight — it is a tiebreaker.
    score += Math.max(0, 10 - Math.floor(member.name.length / 6));

    return { payeeId: member.id, score, reasons };
  });

  // Deterministic: score, then name, then id — never input order.
  const ranked = [...scores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const nameA = cluster.members.find((m) => m.id === a.payeeId)?.name ?? "";
    const nameB = cluster.members.find((m) => m.id === b.payeeId)?.name ?? "";
    return nameA.localeCompare(nameB) || a.payeeId.localeCompare(b.payeeId);
  });

  return {
    targetId: ranked[0].payeeId,
    scores: ranked,
    reasons: ranked[0].reasons,
  };
}

/**
 * Suggests the final display name for the surviving payee (§9).
 *
 * Order of preference:
 * 1. an existing clean member name — the user already typed it, so it needs no
 *    invention and no title-casing guesswork;
 * 2. the cluster's shared stem, title-cased;
 * 3. the shortest member name, unchanged.
 *
 * Never enriched from an external source, and always editable downstream.
 */
export function suggestCanonicalName(cluster: PayeeCluster): string {
  const clean = cluster.members
    .filter((m) => looksHumanReadable(deriveForms(m.name)))
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));

  if (clean.length > 0) return clean[0].name.trim();

  if (cluster.stem) return titleCase(cluster.stem);

  const shortest = [...cluster.members].sort(
    (a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)
  )[0];
  return shortest.name.trim();
}

/**
 * Title-cases a normalized (upper-case) stem.
 *
 * Short vowel-less tokens stay upper-case, because those are acronyms — `FB`,
 * `HSBC`, `DXB`. Everything else is title-cased. An earlier version kept every
 * short token upper-case, which produced "PAY Protect" and "Desco COPY Centre";
 * the vowel test separates acronyms from ordinary short words.
 *
 * Not infallible (`IKEA` becomes `Ikea`), which is fine — the name is a
 * suggestion the user can edit before anything is staged.
 */
function titleCase(stem: string): string {
  return stem
    .split(" ")
    .map((token) => {
      if (token.length <= 4 && !/[AEIOU]/.test(token)) return token;
      return token.charAt(0) + token.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * The full read-only proposal for one cluster — everything 041b can determine
 * without touching rules, transactions or the budget.
 */
export type ClusterProposal = {
  cluster: PayeeCluster;
  target: TargetSuggestion;
  canonicalName: string;
  membersToMerge: PayeeCleanupCandidate[];
};

export function buildProposal(
  cluster: PayeeCluster,
  signals: TargetSignals = {}
): ClusterProposal {
  const target = suggestTarget(cluster, signals);
  return {
    cluster,
    target,
    canonicalName: suggestCanonicalName(cluster),
    membersToMerge: cluster.members.filter((m) => m.id !== target.targetId),
  };
}
