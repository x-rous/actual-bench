/**
 * The read-only cleanup scan (RD-078 §5–§9, Milestone 1).
 *
 * One pure function over an already-partitioned candidate set, so the whole
 * detection pipeline is testable without a connection, a store or a component:
 *
 *   eligible payees → derived forms → detectors → fuzzy pairs →
 *   cluster resolver → confidence → target + canonical name
 *
 * Nothing here reads rules, transactions or the budget, and nothing here
 * mutates anything.
 */

import { detectAll } from "./detectors";
import { findCorpusAffixes } from "./corpusAffixes";
import {
  applyAffixSuppressions,
  applyRuleGapSuppressions,
  applySuppressions,
} from "./suppressions";
import {
  correctedMembers,
  EMPTY_CORRECTION,
  type CorrectionMap,
} from "./corrections";
import { reduceFully } from "./reduce";
import { findFuzzyPairs } from "./fuzzy";
import { resolveClusters } from "./clusterResolver";
import { computeConfidence, type ConfidenceResult } from "./confidence";
import { buildProposal, type ClusterProposal } from "./targetSelection";
import { buildClusterImpact, impactSignals, type ClusterImpact, type ImpactSources } from "./impact";
import { findOrphanPayees, type OrphanPayee } from "./orphans";
import { findRuleGaps, type RuleGap } from "./ruleGaps";
import { buildRuleReferenceMap } from "@/lib/referenceCheck";
import type { EligibilityPartition } from "./eligibility";
import type { ClusterCorrection } from "./corrections";
import type { PayeeCleanupSuppressionRecord } from "@/lib/app-db/types";
import { analyzeFutureResolution, type FutureResolution, type ImportedTextRow } from "./ruleCandidates";
import type { Rule } from "@/types/entities";

export type CleanupSuggestion = ClusterProposal & {
  confidence: ConfidenceResult;
  /** The user's edits to this proposal, if any. */
  correction: ClusterCorrection;
  /** Undefined until the import history has loaded (041f). */
  futureResolution?: FutureResolution;
  /** Undefined when the scan ran without impact data (041b's pure pipeline). */
  impact?: ClusterImpact;
};

export type CleanupScanResult = {
  /** Boilerplate learned from this budget's own payees, shown as scan evidence. */
  learnedAffixes: ReturnType<typeof findCorpusAffixes>;
  /** Every eligible payee that was analyzed. */
  analyzedCount: number;
  excludedTransferCount: number;
  excludedTombstonedCount: number;
  /** Ordered strongest-first; includes `hidden`-band suggestions. */
  suggestions: CleanupSuggestion[];
  /** Payees with no transactions and no rule references. */
  orphans: OrphanPayee[];
  /**
   * Payees the next import will fail to re-resolve, because Actual matches an
   * imported payee by name alone (RD-087). Ordered most-valuable-first.
   */
  ruleGaps: RuleGap[];
  counts: {
    high: number;
    strong: number;
    review: number;
    hidden: number;
  };
};

export type ScanOptions = {
  impactSources?: ImpactSources;
  /** The user's rejected clusters and rejected learned affixes. */
  suppressions?: PayeeCleanupSuppressionRecord[];
  /** Per-cluster edits: excluded/added members, target and name overrides. */
  corrections?: CorrectionMap;
  /** Historical import text, for backtesting proposed rules. */
  importedText?: ImportedTextRow[];
  /** True when that history was truncated by its row cap. */
  importedTextTruncated?: boolean;
  /** The budget's rules, for the "does one already resolve this?" step. */
  rules?: Rule[];
};

export function scanForCleanup(
  partition: EligibilityPartition,
  options: ScanOptions = {}
): CleanupScanResult {
  const {
    impactSources,
    suppressions = [],
    corrections = {},
    importedText,
    importedTextTruncated = false,
    rules = [],
  } = options;
  // Learn this budget's own boilerplate first: the shape reducers cannot see
  // that `DUBAI UAE` or `INTERNET BANKING` is wrapping, but repetition across
  // otherwise-unrelated payees can.
  //
  // Learned from the shape-reduced names rather than the raw ones, so the
  // learner only ever sees what the certain rules could not remove. Otherwise
  // `WOOLWORTHS 0183 / 0291 / 8442` looks exactly like a wrapper with three
  // different continuations, and the merchant's own name gets stripped.
  const learnedAffixes = applyAffixSuppressions(
    findCorpusAffixes(partition.eligible.map((p) => reduceFully(p.name).stem)),
    suppressions
  );
  const detected = detectAll(partition.eligible, learnedAffixes);
  const fuzzyPairs = findFuzzyPairs(detected);

  const byId = new Map(partition.eligible.map((c) => [c.id, c]));
  const clusters = applySuppressions(resolveClusters(detected, fuzzyPairs), suppressions)
    // Apply the user's edits before anything is scored, so confidence, target
    // and impact all describe the proposal as it now stands rather than the one
    // the detector originally produced.
    .map((cluster) => {
      const correction = corrections[cluster.id] ?? EMPTY_CORRECTION;
      // Ask the correction whether it changes membership, rather than comparing
      // arrays: `correctedMembers` always builds a new one, so an identity check
      // marked every cluster as edited and stripped every stem.
      const membershipChanged =
        correction.excludedIds.length > 0 || correction.addedIds.length > 0;
      if (!membershipChanged) return cluster;

      const members = correctedMembers(cluster.members, correction, (id) => byId.get(id));

      // The detector's stem described the original members. Keeping it after
      // the user combined two groups produced a rule built from text most of
      // the group does not contain — `\bLEVEL 5 406 VI\b` for a payee the user
      // had named "Optus". Dropping it makes the rule fall back to the name the
      // user chose, which is the only description that still fits.
      return { ...cluster, members, stem: null, userEdited: true };
    })
    // A cluster edited down to one payee is no longer a merge proposal.
    .filter((cluster) => cluster.members.length >= 2);

  // Impact feeds both the target score (a payee's usage and rule references are
  // reasons to keep it) and confidence (behaviour or rule conflicts are reasons
  // to look closer). Without it the scan still works — it just scores on name
  // evidence alone.
  const targetSignals = impactSources
    ? {
        transactionCounts: impactSources.transactionCounts,
        ruleCounts: buildRuleReferenceMap(impactSources.stagedRules, [
          "payee",
          "imported_payee",
        ]),
      }
    : {};

  const suggestions: CleanupSuggestion[] = clusters.map((cluster) => {
    const correction = corrections[cluster.id] ?? EMPTY_CORRECTION;
    const suggested = buildProposal(cluster, targetSignals);

    // A user override always wins over the scorer, but only while the payee it
    // names is still in the cluster.
    const overrideTarget =
      correction.targetId && cluster.members.some((m) => m.id === correction.targetId)
        ? correction.targetId
        : undefined;

    const proposal = {
      ...suggested,
      target: overrideTarget
        ? { ...suggested.target, targetId: overrideTarget, reasons: ["You chose this payee"] }
        : suggested.target,
      canonicalName: correction.canonicalName ?? suggested.canonicalName,
      membersToMerge: cluster.members.filter(
        (m) => m.id !== (overrideTarget ?? suggested.target.targetId)
      ),
    };
    const impact = impactSources
      ? buildClusterImpact(cluster, proposal.target.targetId, impactSources)
      : undefined;

    // Only analyse future resolution once the history is loaded — without it
    // every cluster would look like it needs a rule.
    const futureResolution =
      importedText && importedText.length > 0
        ? analyzeFutureResolution({
            stem: cluster.stem ?? "",
            finalName: proposal.canonicalName,
            members: cluster.members,
            rows: importedText,
            rules,
            override: correction.rulePattern,
            historyTruncated: importedTextTruncated,
          })
        : undefined;

    return {
      ...proposal,
      impact,
      correction,
      futureResolution,
      confidence: computeConfidence(cluster, impact ? impactSignals(impact) : {}),
    };
  });

  // Highest confidence first; ties broken by name so the list is stable.
  suggestions.sort(
    (a, b) =>
      b.confidence.score - a.confidence.score ||
      a.cluster.members[0].name.localeCompare(b.cluster.members[0].name)
  );

  const counts = { high: 0, strong: 0, review: 0, hidden: 0 };
  for (const suggestion of suggestions) counts[suggestion.confidence.band]++;

  const orphans = impactSources
    ? findOrphanPayees({
        candidates: partition.eligible,
        stagedRules: impactSources.stagedRules,
        transactionCounts: impactSources.transactionCounts,
      })
    : [];

  // A payee already in a live suggestion is excluded from the rule gaps: that
  // suggestion's own "Future imports" step already proposes a rule for it, and
  // offering the same rule from two places with independently editable text is
  // how a user ends up with two rules for one merchant.
  //
  // Derived from `suggestions` rather than the raw clusters, so a payee the user
  // has excluded by hand correctly becomes a rule-gap candidate again.
  const clusteredPayeeIds = new Set(
    suggestions.flatMap((s) => s.cluster.members.map((m) => m.id))
  );

  const ruleGaps = impactSources
    ? applyRuleGapSuppressions(
        findRuleGaps({
          candidates: partition.eligible,
          rows: importedText ?? [],
          rules,
          transactionCounts: impactSources.transactionCounts,
          clusteredPayeeIds,
          truncated: importedTextTruncated,
        }),
        suppressions
      )
    : [];

  return {
    learnedAffixes,
    orphans,
    ruleGaps,
    analyzedCount: partition.eligible.length,
    excludedTransferCount: partition.excludedTransfer.length,
    excludedTombstonedCount: partition.excludedTombstoned.length,
    suggestions,
    counts,
  };
}
