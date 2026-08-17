/**
 * Cluster resolution (RD-078 §6).
 *
 * Detectors emit per-payee stems and fuzzy emits pairs; neither decides what a
 * *cluster* is. That decision lives here, under five invariants:
 *
 * - only eligible payees appear (the boundary already ran, but a cluster of one
 *   is dropped rather than shown);
 * - each live payee belongs to at most one cluster;
 * - strong structural evidence forms groups;
 * - **fuzzy transitivity alone can never form a group** — the rule that stops
 *   `A≈B`, `B≈C` from silently merging three unrelated merchants;
 * - output is deterministic for the same input.
 */

import type { DetectedPayee, DetectorId, EvidenceKind } from "./detectors";
import type { FuzzyPair } from "./fuzzy";
import type { PayeeCleanupCandidate } from "../types";

/**
 * Detectors that normalize a name without removing meaning. They fire on every
 * payee, so on their own they prove nothing about why two payees belong
 * together — see the evidence-attribution note in `buildCluster`.
 */
const IDENTITY_DETECTORS = new Set<DetectorId>([
  "case-only",
  "whitespace-only",
  "punctuation",
]);

export type ClusterEvidence = {
  detectorId: DetectorId | "fuzzy-similarity";
  kind: EvidenceKind;
  label: string;
  /** The shared stem, or the compared names for fuzzy evidence. */
  detail: string;
  /** How many cluster members reached the stem through this detector. */
  memberCount?: number;
  /** Regex-ish description of the removed noise, shown as "pattern evidence". */
  pattern?: string;
  /** Highest similarity backing this evidence, fuzzy only. */
  similarity?: number;
};

export type PayeeCluster = {
  id: string;
  members: PayeeCleanupCandidate[];
  /** The stem every structural member reduced to, when there is one. */
  stem: string | null;
  evidence: ClusterEvidence[];
  /** True when nothing but fuzzy similarity connects these payees. */
  fuzzyOnly: boolean;
  /**
   * True when the user added or removed members.
   *
   * The stem and evidence describe the group the *detector* found. Once someone
   * has combined two groups or dropped a member, that description no longer
   * fits what is on screen — and worse, anything derived from the stale stem
   * (the rule pattern above all) is derived from the wrong text.
   */
  userEdited?: boolean;
};

/**
 * Minimal union-find. Used only for *structural and contextual* links — fuzzy
 * pairs are deliberately never fed into it, because union-find is transitive by
 * construction and that is precisely the behavior §6 forbids for fuzzy.
 */
class DisjointSet {
  private parent = new Map<string, string>();

  find(id: string): string {
    const parent = this.parent.get(id);
    if (parent === undefined) {
      this.parent.set(id, id);
      return id;
    }
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    // Lexicographic root keeps the output deterministic regardless of input order.
    if (rootA < rootB) this.parent.set(rootB, rootA);
    else this.parent.set(rootA, rootB);
  }
}

/**
 * The stem the canonical name is built from.
 *
 * Two rules, both learned from wrong suggestions:
 *
 * - it must be a stem that actually **grouped** the cluster (two or more
 *   members reached it). A reducing detector is worth reporting as evidence
 *   even when only one member needed it, but its stem may still carry the
 *   noise the other members never had — that is how `PAY PROTECT 393160543`
 *   and `PAY PROTECT 407287028` came to be named "Pay Protect 393";
 * - among the qualifying stems, prefer the fully-reduced one, since it is the
 *   only stem that has had every class of noise removed.
 */
function chooseStem(evidence: ClusterEvidence[]): string | null {
  const grouping = evidence.filter((e) => (e.memberCount ?? 0) >= 2);
  if (grouping.length === 0) return null;

  const reduced = grouping.find((e) => e.detectorId === "full-reduction");
  if (reduced) return reduced.detail;

  return [...grouping].sort(
    (a, b) => a.detail.length - b.detail.length || a.detail.localeCompare(b.detail)
  )[0].detail;
}

/**
 * A regex-ish sketch of the noise, shown as "pattern evidence".
 *
 * Only offered when the stem is short enough to read. The earlier version built
 * one from whatever stem a single-pass detector produced, which on real bank
 * text meant a 60-character line of the very junk the user wanted removed.
 */
function describePattern(
  detectorId: DetectorId | "fuzzy-similarity",
  stem: string
): string | undefined {
  if (detectorId !== "full-reduction") return undefined;
  if (stem.length > 40) return undefined;
  return `^${escapeForDisplay(stem)}\\b.*$`;
}

/** Display-only escaping — this string is shown as evidence, never executed. */
function escapeForDisplay(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveClusters(
  payees: DetectedPayee[],
  fuzzyPairs: FuzzyPair[]
): PayeeCluster[] {
  const byId = new Map(payees.map((p) => [p.candidate.id, p]));

  // ── Pass 1: group by shared stem, structural and contextual only ──────────
  const set = new DisjointSet();
  const stemGroups = new Map<string, string[]>();

  // Grouped by **stem alone**, deliberately not by `detector:stem`.
  //
  // The whole point is "these names reduce to the same thing", and different
  // payees reach the same stem by different routes: `WOOLWORTHS 0183` gets
  // there via the terminal-suffix detector while the already-clean
  // `Woolworths` gets there via punctuation normalization. Keying by detector
  // kept those two apart — so the clean payee, which is usually the best merge
  // target, never joined its own cluster.
  for (const payee of payees) {
    for (const hit of payee.hits) {
      if (hit.kind === "fuzzy") continue;
      const group = stemGroups.get(hit.stem);
      if (group) {
        if (!group.includes(payee.candidate.id)) group.push(payee.candidate.id);
      } else {
        stemGroups.set(hit.stem, [payee.candidate.id]);
      }
    }
  }

  const groupedKeys: string[] = [];
  for (const [key, ids] of stemGroups) {
    if (ids.length < 2) continue;
    groupedKeys.push(key);
    for (let i = 1; i < ids.length; i++) set.union(ids[0], ids[i]);
  }

  const clustersByRoot = new Map<string, string[]>();
  for (const payee of payees) {
    const id = payee.candidate.id;
    // Only payees that actually participated in a shared stem get a root here.
    if (!groupedKeys.some((stem) => stemGroups.get(stem)?.includes(id))) continue;
    const root = set.find(id);
    const members = clustersByRoot.get(root);
    if (members) members.push(id);
    else clustersByRoot.set(root, [id]);
  }

  const clustered = new Set<string>();
  for (const members of clustersByRoot.values()) {
    for (const id of members) clustered.add(id);
  }

  // ── Pass 2: fuzzy pairs, strictly non-transitive ──────────────────────────
  //
  // A fuzzy pair produces a cluster only when BOTH payees are still
  // unclustered. Once a payee is in a cluster it is closed to further fuzzy
  // links, so `A≈B` then `B≈C` yields {A,B} and drops B≈C — never {A,B,C}.
  // A fuzzy pair also never merges two existing clusters, for the same reason.
  const fuzzyClusters: string[][] = [];
  for (const pair of fuzzyPairs) {
    if (clustered.has(pair.leftId) || clustered.has(pair.rightId)) continue;
    if (!byId.has(pair.leftId) || !byId.has(pair.rightId)) continue;
    clustered.add(pair.leftId);
    clustered.add(pair.rightId);
    fuzzyClusters.push([pair.leftId, pair.rightId]);
  }

  // ── Build the output ──────────────────────────────────────────────────────
  const fuzzyByPair = new Map(
    fuzzyPairs.map((p) => [`${p.leftId}|${p.rightId}`, p])
  );

  const clusters: PayeeCluster[] = [];

  for (const memberIds of clustersByRoot.values()) {
    if (memberIds.length < 2) continue;
    clusters.push(
      buildCluster(memberIds, byId, stemGroups, fuzzyByPair, false)
    );
  }

  for (const memberIds of fuzzyClusters) {
    clusters.push(buildCluster(memberIds, byId, stemGroups, fuzzyByPair, true));
  }

  // Deterministic ordering: strongest evidence first, then by name.
  return clusters.sort(
    (a, b) =>
      Number(a.fuzzyOnly) - Number(b.fuzzyOnly) ||
      b.members.length - a.members.length ||
      a.members[0].name.localeCompare(b.members[0].name)
  );
}

function buildCluster(
  memberIds: string[],
  byId: Map<string, DetectedPayee>,
  stemGroups: Map<string, string[]>,
  fuzzyByPair: Map<string, FuzzyPair>,
  fuzzyOnly: boolean
): PayeeCluster {
  const sortedIds = [...memberIds].sort();
  const members = sortedIds
    .map((id) => byId.get(id)?.candidate)
    .filter((c): c is PayeeCleanupCandidate => Boolean(c));

  const evidence: ClusterEvidence[] = [];

  if (!fuzzyOnly) {
    // Evidence must describe what actually *connects* these payees, which is
    // not the same as "every detector that produced the cluster's stem".
    //
    // The identity detectors (case / whitespace / punctuation) emit a stem for
    // every payee, including one that needed no cleaning at all. Counting those
    // as evidence made `Acme` + `Acme Ltd` look like a hard structural match —
    // `Acme`'s own case-folding reached the stem — when the only real link is
    // the legal suffix, which is contextual and should score much lower.
    //
    // So: a *reducing* detector counts as soon as one member used it to reach
    // the stem (it removed real text), while an *identity* detector counts only
    // if two or more members reached the stem through it with genuinely
    // different names.
    const seenDetectors = new Set<string>();
    for (const id of sortedIds) {
      for (const hit of byId.get(id)?.hits ?? []) {
        if (hit.kind === "fuzzy") continue;
        const key = `${hit.detectorId}:${hit.stem}`;
        if (seenDetectors.has(key)) continue;

        const viaThisDetector = sortedIds.filter((memberId) =>
          byId
            .get(memberId)
            ?.hits.some(
              (h) => h.detectorId === hit.detectorId && h.stem === hit.stem
            )
        );

        if (IDENTITY_DETECTORS.has(hit.detectorId)) {
          const distinctNames = new Set(
            viaThisDetector.map((memberId) => byId.get(memberId)?.candidate.name)
          );
          if (distinctNames.size < 2) continue;
        } else if (viaThisDetector.length < 1 || !hit.removed) {
          continue;
        }

        seenDetectors.add(key);
        evidence.push({
          detectorId: hit.detectorId,
          kind: hit.kind,
          label: hit.label,
          detail: hit.stem,
          memberCount: viaThisDetector.length,
          pattern: describePattern(hit.detectorId, hit.stem),
        });
      }
    }
  } else {
    const pair = fuzzyByPair.get(`${sortedIds[0]}|${sortedIds[1]}`);
    evidence.push({
      detectorId: "fuzzy-similarity",
      kind: "fuzzy",
      label: "Similar spelling only",
      detail: members.map((m) => m.name).join(" · "),
      similarity: pair?.similarity,
    });
  }

  return {
    id: sortedIds.join("+"),
    members,
    stem: chooseStem(evidence),
    evidence,
    fuzzyOnly,
  };
}
