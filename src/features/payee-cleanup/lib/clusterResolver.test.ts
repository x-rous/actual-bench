import { detectAll } from "./detectors";
import { findFuzzyPairs } from "./fuzzy";
import { resolveClusters } from "./clusterResolver";
import type { PayeeCleanupCandidate } from "../types";

function payee(id: string, name: string): PayeeCleanupCandidate {
  return {
    id,
    name,
    metadata: {
      id,
      favorite: false,
      learnCategories: true,
      tombstone: false,
      transferAccountId: null,
    },
  };
}

function cluster(names: string[], fuzzyPairs = false) {
  // Ids are derived from the name, not the input index, so reordering the
  // input does not silently reassign ids and make a determinism test lie.
  const candidates = names.map((name) => payee(`p-${name}`, name));
  const detected = detectAll(candidates);
  return resolveClusters(detected, fuzzyPairs ? findFuzzyPairs(detected) : []);
}

describe("structural clustering", () => {
  it("groups payees that share a stem after removing a store number", () => {
    const clusters = cluster([
      "WOOLWORTHS 0183",
      "WOOLWORTHS 0291",
      "WOOLWORTHS 8442",
      "Woolworths",
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.name).sort()).toEqual([
      "WOOLWORTHS 0183",
      "WOOLWORTHS 0291",
      "WOOLWORTHS 8442",
      "Woolworths",
    ]);
    expect(clusters[0].fuzzyOnly).toBe(false);
  });

  it("carries the evidence that formed the group", () => {
    const clusters = cluster(["WOOLWORTHS 0183", "WOOLWORTHS 0291"]);
    const evidence = clusters[0].evidence;

    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.some((e) => e.detectorId === "full-reduction")).toBe(true);
    expect(evidence.some((e) => e.kind === "structural")).toBe(true);
    expect(evidence[0].label).toMatch(/store or terminal number/i);
  });

  it("reports each kind of evidence once, not once per member", () => {
    // Members reduce along slightly different paths (their store numbers
    // differ), which previously produced one duplicate evidence line per member.
    const clusters = cluster([
      "WOOLWORTHS 0183",
      "WOOLWORTHS 0291",
      "WOOLWORTHS 8442",
    ]);
    const labels = clusters[0].evidence.map((e) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("offers a readable pattern, and none at all when the stem is junk", () => {
    const clean = cluster(["WOOLWORTHS 0183", "WOOLWORTHS 0291"]);
    expect(clean[0].evidence.find((e) => e.pattern)?.pattern).toBe(
      "^WOOLWORTHS\\b.*$"
    );

    // A long stem of the very noise the user wants removed is not evidence, it
    // is wallpaper — so a pattern is only offered while the stem stays readable.
    const junk = cluster([
      "SOME VERY LONG MERCHANT NAME THAT KEEPS GOING AND GOING BRANCH 0183",
      "SOME VERY LONG MERCHANT NAME THAT KEEPS GOING AND GOING BRANCH 0291",
    ]);
    // Asserted before the loop: if the junk names failed to cluster at all, the
    // loop body would never run and this test would pass having checked nothing.
    expect(junk).toHaveLength(1);
    expect(junk[0].evidence.length).toBeGreaterThan(0);
    for (const evidence of junk[0].evidence) {
      expect(evidence.pattern).toBeUndefined();
    }
  });

  it("groups case-only variants", () => {
    const clusters = cluster(["AMAZON", "Amazon", "amazon"]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(3);
  });

  it("does not create a cluster from a single payee", () => {
    expect(cluster(["Woolworths"])).toHaveLength(0);
    expect(cluster(["WOOLWORTHS 0183"])).toHaveLength(0);
  });

  it("keeps unrelated merchants in separate clusters", () => {
    const clusters = cluster([
      "WOOLWORTHS 0183",
      "WOOLWORTHS 0291",
      "TESCO 4821",
      "TESCO 9001",
    ]);

    expect(clusters).toHaveLength(2);
    for (const c of clusters) {
      const names = c.members.map((m) => m.name);
      expect(new Set(names.map((n) => n.split(" ")[0])).size).toBe(1);
    }
  });

  it("puts each payee in at most one cluster", () => {
    const clusters = cluster([
      "AMAZON",
      "Amazon",
      "AMAZON 1234",
      "AMAZON.COM",
      "TESCO 1",
      "TESCO 2",
    ]);

    const seen = new Set<string>();
    for (const c of clusters) {
      for (const member of c.members) {
        expect(seen.has(member.id)).toBe(false);
        seen.add(member.id);
      }
    }
  });

  it("is deterministic regardless of input order", () => {
    const names = ["WOOLWORTHS 0291", "Woolworths", "WOOLWORTHS 0183"];
    const forward = cluster(names);
    const reversed = cluster([...names].reverse());

    expect(forward.map((c) => c.id)).toEqual(reversed.map((c) => c.id));
    expect(forward[0].members.map((m) => m.name)).toEqual(
      reversed[0].members.map((m) => m.name)
    );
  });
});

describe("fuzzy clustering is never transitive", () => {
  it("does NOT chain A≈B and B≈C into one cluster", () => {
    // The invariant RD-078 §6 forbids breaking. CARREFOUR/CARREFOURE/CARREFOURA
    // are pairwise similar; chaining them would merge three payees on nothing
    // but spelling distance.
    const clusters = cluster(
      ["CARREFOURE", "CARREFOURA", "CARREFOURI"],
      true
    );

    // Asserted up front: with no fuzzy cluster at all, the loop and the size
    // bound below both pass while the behaviour they guard has disappeared.
    const fuzzy = clusters.filter((c) => c.fuzzyOnly);
    expect(fuzzy).toHaveLength(1);
    for (const c of fuzzy) {
      expect(c.members).toHaveLength(2);
    }
    const clusteredIds = clusters.flatMap((c) => c.members.map((m) => m.id));
    expect(new Set(clusteredIds).size).toBeLessThanOrEqual(2);
  });

  it("creates a two-member cluster from a genuine typo pair", () => {
    const clusters = cluster(["Carrefour Market", "Carrefour Markt"], true);
    const fuzzy = clusters.filter((c) => c.fuzzyOnly);

    expect(fuzzy).toHaveLength(1);
    expect(fuzzy[0].members).toHaveLength(2);
    expect(fuzzy[0].evidence[0].detectorId).toBe("fuzzy-similarity");
    expect(fuzzy[0].evidence[0].similarity).toBeGreaterThan(0.85);
  });

  it("never merges two existing structural clusters", () => {
    const clusters = cluster(
      ["TESCO 0001", "TESCO 0002", "TESC0 0001", "TESC0 0002"],
      true
    );

    // Two structural clusters, TESCO and TESC0, and neither absorbs the other.
    // Without this the loop body never runs if clustering stops entirely.
    expect(clusters).toHaveLength(2);
    for (const c of clusters) {
      const stems = new Set(
        c.members.map((m) => m.name.replace(/\s*\d+$/, ""))
      );
      expect(stems.size).toBe(1);
    }
  });

  it("does not add a fuzzy member to a structural cluster", () => {
    // A payee already grouped by hard evidence is closed to fuzzy links.
    const clusters = cluster(
      ["WOOLWORTHS 0183", "WOOLWORTHS 0291", "WOOLWORTH"],
      true
    );

    // `expect(undefined).not.toContain(...)` passes, so the structural cluster
    // has to be proven to exist before its membership means anything.
    const structural = clusters.find((c) => !c.fuzzyOnly);
    expect(structural).toBeDefined();
    expect(structural!.members.map((m) => m.name)).not.toContain("WOOLWORTH");
  });

  it("marks fuzzy-only clusters so scoring can treat them as weak", () => {
    const clusters = cluster(["Carrefour Market", "Carrefour Markt"], true);
    expect(clusters.every((c) => c.fuzzyOnly)).toBe(true);
  });
});
