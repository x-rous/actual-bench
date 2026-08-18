import {
  addMember,
  combineGroups,
  correctedMembers,
  EMPTY_CORRECTION,
  excludeMember,
  hasCorrections,
  includeMember,
  resetCluster,
  setCanonicalName,
  setDecision,
  setTarget,
  splitCluster,
} from "./corrections";
import {
  applyAffixSuppressions,
  applyRuleGapSuppressions,
  buildRuleGapSuppression,
  applySuppressions,
  buildAffixSuppression,
  buildClusterSuppression,
  suppressesCluster,
} from "./suppressions";
import type { CorrectionMap } from "./corrections";
import type { PayeeCluster } from "./clusterResolver";
import type { PayeeCleanupCandidate } from "../types";
import type { PayeeCleanupSuppressionRecord } from "@/lib/app-db/types";

function payee(
  id: string,
  name = id.toUpperCase(),
  overrides: Partial<PayeeCleanupCandidate["metadata"]> = {}
): PayeeCleanupCandidate {
  return {
    id,
    name,
    metadata: {
      id,
      favorite: false,
      learnCategories: true,
      tombstone: false,
      transferAccountId: null,
      ...overrides,
    },
  };
}

function cluster(members: PayeeCleanupCandidate[]): PayeeCluster {
  return {
    id: members.map((m) => m.id).join("+"),
    members,
    stem: "STEM",
    evidence: [
      {
        detectorId: "full-reduction",
        kind: "structural",
        label: "Removed the card number",
        detail: "STEM",
      },
    ],
    fuzzyOnly: false,
  };
}

describe("cluster corrections", () => {
  it("records accept and reject decisions", () => {
    let map = setDecision({}, "c1", "accepted");
    expect(map.c1.decision).toBe("accepted");
    map = setDecision(map, "c1", "rejected");
    expect(map.c1.decision).toBe("rejected");
  });

  it("excludes and re-includes a member", () => {
    let map = excludeMember({}, "c1", "p2");
    expect(map.c1.excludedIds).toEqual(["p2"]);
    map = includeMember(map, "c1", "p2");
    expect(map.c1.excludedIds).toEqual([]);
  });

  it("clears the target when the target is excluded", () => {
    // Leaving it would stage a merge into a payee the user just removed.
    const withTarget = setTarget({}, "c1", payee("p1")) as Record<string, never>;
    const map = excludeMember(withTarget, "c1", "p1");
    expect(map.c1.targetId).toBeUndefined();
  });

  it("refuses to add a transfer payee, and says why", () => {
    const result = addMember({}, "c1", payee("x", "Transfer", { transferAccountId: "a1" }));
    expect(result).toBe("transfer-payee");
  });

  it("refuses to add a tombstoned payee", () => {
    expect(addMember({}, "c1", payee("x", "Gone", { tombstone: true }))).toBe(
      "tombstoned"
    );
  });

  it("refuses a transfer payee as the merge target", () => {
    // Actual's merge silently no-ops on a transfer target, so this would look
    // like a success and change nothing.
    expect(setTarget({}, "c1", payee("x", "Transfer", { transferAccountId: "a1" }))).toBe(
      "transfer-payee"
    );
  });

  it("adds an eligible payee the detector missed", () => {
    const result = addMember({}, "c1", payee("p9"));
    expect(typeof result).not.toBe("string");
    expect((result as Record<string, { addedIds: string[] }>).c1.addedIds).toEqual(["p9"]);
  });

  it("treats an empty name override as no override", () => {
    const map = setCanonicalName({}, "c1", "   ");
    expect(map.c1.canonicalName).toBeUndefined();
  });

  it("splits a cluster by excluding everything not kept", () => {
    const map = splitCluster({}, "c1", ["p1", "p2"], ["p1", "p2", "p3", "p4"]);
    expect(map.c1.excludedIds).toEqual(["p3", "p4"]);
  });

  it("drops a hand-added member that the split removed", () => {
    // `addedIds` bypassed `excludedIds` entirely, so a payee the user added and
    // then split away came straight back through the other list.
    const added = addMember({}, "c1", payee("p9")) as CorrectionMap;
    const map = splitCluster(added, "c1", ["p1"], ["p1", "p2", "p9"]);
    expect(
      correctedMembers([payee("p1"), payee("p2")], map.c1, (id) =>
        [payee("p1"), payee("p2"), payee("p9")].find((m) => m.id === id)
      ).map((m) => m.id)
    ).toEqual(["p1"]);
  });

  it("drops a target that a split removed", () => {
    const withTarget = setTarget({}, "c1", payee("p3")) as Record<string, never>;
    const map = splitCluster(withTarget, "c1", ["p1", "p2"], ["p1", "p2", "p3"]);
    expect(map.c1.targetId).toBeUndefined();
  });

  it("resets a cluster back to the detector's proposal", () => {
    let map = setDecision({}, "c1", "accepted");
    map = excludeMember(map, "c1", "p2");
    map = resetCluster(map, "c1");
    expect(map.c1).toBeUndefined();
  });

  it("knows whether a proposal has been touched", () => {
    expect(hasCorrections(EMPTY_CORRECTION)).toBe(false);
    expect(hasCorrections(setDecision({}, "c1", "accepted").c1)).toBe(true);
  });
});

describe("combineGroups", () => {
  it("moves every member into the survivor and empties the others", () => {
    const map = combineGroups(
      {},
      { clusterId: "A", finalName: "Optus" },
      [
        { clusterId: "B", memberIds: ["b1", "b2"] },
        { clusterId: "C", memberIds: ["c1"] },
      ]
    );

    expect(map.A.addedIds).toEqual(["b1", "b2", "c1"]);
    expect(map.A.canonicalName).toBe("Optus");
    // Emptied groups fall below two members and stop being proposals.
    expect(map.B.excludedIds).toEqual(["b1", "b2"]);
    expect(map.C.excludedIds).toEqual(["c1"]);
  });

  it("pins the name the user chose rather than re-deriving one", () => {
    // The combined group's stem is a mix of the originals; re-deriving from it
    // would rename the result to something the user never asked for.
    const map = combineGroups(
      { A: { ...EMPTY_CORRECTION, canonicalName: "Optus" } },
      { clusterId: "A", finalName: "Optus" },
      [{ clusterId: "B", memberIds: ["b1"] }]
    );
    expect(map.A.canonicalName).toBe("Optus");
  });

  it("clears the absorbed group's decision so it stops being staged", () => {
    const map = combineGroups(
      { B: { ...EMPTY_CORRECTION, decision: "accepted", targetId: "b1" } },
      { clusterId: "A", finalName: "Optus" },
      [{ clusterId: "B", memberIds: ["b1", "b2"] }]
    );
    expect(map.B.decision).toBe("undecided");
    expect(map.B.targetId).toBeUndefined();
  });

  it("empties an absorbed group's added members too", () => {
    // Otherwise the absorbed group keeps its hand-added payees, stays at two
    // members and remains a live proposal claiming the same source payee as the
    // survivor — which the validator then blocks, instead of the user getting
    // the combine they asked for.
    const withAdded = addMember({}, "B", payee("b9")) as CorrectionMap;
    const map = combineGroups(
      withAdded,
      { clusterId: "A", finalName: "Optus" },
      [{ clusterId: "B", memberIds: ["b1", "b2"] }]
    );
    expect(map.B.addedIds).toEqual([]);
  });

  it("is undone one group at a time", () => {
    let map = combineGroups(
      {},
      { clusterId: "A", finalName: "Optus" },
      [{ clusterId: "B", memberIds: ["b1", "b2"] }]
    );
    map = resetCluster(map, "B");
    expect(map.B).toBeUndefined();
  });
});

describe("correctedMembers", () => {
  const members = [payee("p1"), payee("p2"), payee("p3")];
  const lookup = (id: string) => [...members, payee("p9")].find((m) => m.id === id);

  it("returns the original list when nothing was corrected", () => {
    expect(correctedMembers(members, EMPTY_CORRECTION, lookup)).toEqual(members);
  });

  it("removes excluded members", () => {
    const result = correctedMembers(
      members,
      { ...EMPTY_CORRECTION, excludedIds: ["p2"] },
      lookup
    );
    expect(result.map((m) => m.id)).toEqual(["p1", "p3"]);
  });

  it("appends added members", () => {
    const result = correctedMembers(
      members,
      { ...EMPTY_CORRECTION, addedIds: ["p9"] },
      lookup
    );
    expect(result.map((m) => m.id)).toEqual(["p1", "p2", "p3", "p9"]);
  });

  it("does not duplicate a member that is already present", () => {
    const result = correctedMembers(
      members,
      { ...EMPTY_CORRECTION, addedIds: ["p1"] },
      lookup
    );
    expect(result.map((m) => m.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("ignores an added id that no longer resolves", () => {
    const result = correctedMembers(
      members,
      { ...EMPTY_CORRECTION, addedIds: ["deleted"] },
      lookup
    );
    expect(result.map((m) => m.id)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("suppressions", () => {
  const emirates = cluster([payee("p1", "EMIRATES"), payee("p2", "EMIRATES NBD")]);

  function record(
    overrides: Partial<PayeeCleanupSuppressionRecord> = {}
  ): PayeeCleanupSuppressionRecord {
    return {
      id: "s1",
      budgetSyncId: "b1",
      kind: "not-duplicates",
      payeeIds: ["p1", "p2"],
      normalizedNames: ["EMIRATES", "EMIRATES NBD"],
      detectorIds: ["fuzzy-similarity"],
      createdAt: "2026-08-16T00:00:00.000Z",
      ...overrides,
    };
  }

  it("suppresses the exact grouping the user rejected", () => {
    expect(suppressesCluster(record(), emirates)).toBe(true);
    expect(applySuppressions([emirates], [record()])).toEqual([]);
  });

  it("still matches after the payee ids have changed", () => {
    // Ids do not survive a merge or a re-import, which is exactly when an old
    // decision still needs to hold.
    expect(
      suppressesCluster(record({ payeeIds: ["gone-1", "gone-2"] }), emirates)
    ).toBe(true);
  });

  it("does NOT suppress a different cluster containing one of the payees", () => {
    // The rejected pair should stop being suggested; it must not veto a
    // three-member proposal the user has never seen.
    const wider = cluster([
      payee("p1", "EMIRATES"),
      payee("p3", "EMIRATES AIRLINE"),
      payee("p4", "Emirates"),
    ]);
    expect(suppressesCluster(record(), wider)).toBe(false);
    expect(applySuppressions([wider], [record()])).toHaveLength(1);
  });

  it("does not suppress a cluster that merely reuses a normalized name", () => {
    // `EMIRATES` and `Emirates` both key to EMIRATES, so this cluster's names
    // are ["EMIRATES", "EMIRATES"]. Compared as sets that looked identical to a
    // stored ["EMIRATES", "EMIRATES NBD"] and silently dropped a grouping the
    // user never rejected — and case-only pairs are exactly what this finds.
    const caseOnly = cluster([payee("p5", "EMIRATES"), payee("p6", "Emirates")]);
    expect(suppressesCluster(record(), caseOnly)).toBe(false);
  });

  it("does not suppress anything when the record has no matchable key", () => {
    expect(
      suppressesCluster(record({ payeeIds: [], normalizedNames: [] }), emirates)
    ).toBe(false);
  });

  it("ignores affix records when matching clusters", () => {
    expect(suppressesCluster(record({ kind: "rejected-affix" }), emirates)).toBe(false);
  });

  it("builds a record carrying both ids and names", () => {
    const built = buildClusterSuppression("b1", emirates);
    expect(built.payeeIds).toEqual(["p1", "p2"]);
    expect(built.normalizedNames).toEqual(["EMIRATES", "EMIRATES NBD"]);
    expect(built.detectorIds).toEqual(["full-reduction"]);
  });

  it("removes a rejected learned affix so it stops being applied everywhere", () => {
    // Rejecting one cluster does not stop an inference like `TRANSFER FROM`
    // being applied to every other payee, so the affix itself is suppressible.
    const affix = {
      kind: "prefix" as const,
      tokens: ["TRANSFER", "FROM"],
      payeeCount: 40,
      distinctRemainders: 30,
    };
    const suppression = record({
      ...buildAffixSuppression("b1", affix),
      id: "s2",
      createdAt: "2026-08-16T00:00:00.000Z",
    });

    expect(applyAffixSuppressions([affix], [suppression])).toEqual([]);
  });

  it("does not let a rejected prefix suppress the reversed or opposite affix", () => {
    // An affix is an ordered sequence at one end of a name. Compared as an
    // unordered bag, rejecting the prefix ["BANK","TRANSFER"] also silenced a
    // ["TRANSFER","BANK"] affix and the matching suffix — suggestions lost that
    // the user never rejected.
    const rejected = record({
      ...buildAffixSuppression("b1", {
        kind: "prefix",
        tokens: ["BANK", "TRANSFER"],
        payeeCount: 20,
        distinctRemainders: 18,
      }),
      id: "s4",
      createdAt: "2026-08-16T00:00:00.000Z",
    });

    const reversed = {
      kind: "prefix" as const,
      tokens: ["TRANSFER", "BANK"],
      payeeCount: 20,
      distinctRemainders: 18,
    };
    const sameTokensOtherEnd = {
      kind: "suffix" as const,
      tokens: ["BANK", "TRANSFER"],
      payeeCount: 20,
      distinctRemainders: 18,
    };

    expect(applyAffixSuppressions([reversed], [rejected])).toEqual([reversed]);
    expect(applyAffixSuppressions([sameTokensOtherEnd], [rejected])).toEqual([
      sameTokensOtherEnd,
    ]);
  });

  it("hides a payee the user said does not need a rule", () => {
    const suppression = record({
      ...buildRuleGapSuppression("b1", { id: "p1", name: "Netflix" }),
      id: "s5",
      createdAt: "2026-08-17T00:00:00.000Z",
    });
    const gaps = [{ payee: { id: "p1", name: "Netflix" } }];

    expect(applyRuleGapSuppressions(gaps, [suppression])).toEqual([]);
  });

  it("still hides it after the payee id has changed", () => {
    // Ids do not survive a merge or a re-import; the name does.
    const suppression = record({
      ...buildRuleGapSuppression("b1", { id: "gone", name: "Netflix" }),
      id: "s6",
      createdAt: "2026-08-17T00:00:00.000Z",
    });

    expect(
      applyRuleGapSuppressions([{ payee: { id: "p9", name: "Netflix" } }], [suppression])
    ).toEqual([]);
  });

  it("does not let a rule dismissal hide a merge suggestion for the same payee", () => {
    // Different decisions about the same payee. "It does not need a rule" says
    // nothing about whether it is a duplicate of something else.
    const suppression = record({
      ...buildRuleGapSuppression("b1", { id: "p1", name: "EMIRATES" }),
      id: "s7",
      createdAt: "2026-08-17T00:00:00.000Z",
    });

    expect(suppressesCluster(suppression, emirates)).toBe(false);
    expect(applySuppressions([emirates], [suppression])).toHaveLength(1);
  });

  it("does not let a cluster dismissal hide a rule gap for the same payee", () => {
    expect(
      applyRuleGapSuppressions([{ payee: { id: "p1", name: "EMIRATES" } }], [record()])
    ).toHaveLength(1);
  });

  it("leaves other affixes alone", () => {
    const kept = {
      kind: "suffix" as const,
      tokens: ["DUBAI", "UAE"],
      payeeCount: 40,
      distinctRemainders: 30,
    };
    const rejected = record({
      ...buildAffixSuppression("b1", {
        kind: "prefix",
        tokens: ["NFC", "APPAY"],
        payeeCount: 20,
        distinctRemainders: 18,
      }),
      id: "s3",
      createdAt: "2026-08-16T00:00:00.000Z",
    });

    expect(applyAffixSuppressions([kept], [rejected])).toEqual([kept]);
  });
});
