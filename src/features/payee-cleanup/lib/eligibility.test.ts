import {
  assertCleanupEligible,
  ineligibleReason,
  isCleanupEligible,
  partitionByEligibility,
} from "./eligibility";
import type { PayeeCleanupCandidate, PayeeCleanupMetadata } from "../types";

function metadata(
  overrides: Partial<PayeeCleanupMetadata> = {}
): PayeeCleanupMetadata {
  return {
    id: "p1",
    favorite: false,
    learnCategories: true,
    tombstone: false,
    transferAccountId: null,
    ...overrides,
  };
}

function candidate(
  id: string,
  overrides: Partial<PayeeCleanupMetadata> = {}
): PayeeCleanupCandidate {
  return {
    id,
    name: `Payee ${id}`,
    metadata: metadata({ id, ...overrides }),
  };
}

describe("isCleanupEligible", () => {
  it("accepts an ordinary live payee", () => {
    expect(isCleanupEligible(metadata())).toBe(true);
  });

  it("rejects a transfer payee", () => {
    // Actual's merge silently no-ops on a transfer target and drops transfer
    // sources, so one reaching a plan produces a merge that reports success and
    // changes nothing.
    expect(isCleanupEligible(metadata({ transferAccountId: "acct-1" }))).toBe(
      false
    );
  });

  it("rejects a tombstoned payee", () => {
    expect(isCleanupEligible(metadata({ tombstone: true }))).toBe(false);
  });

  it("rejects a payee that is both", () => {
    expect(
      isCleanupEligible(metadata({ transferAccountId: "acct-1", tombstone: true }))
    ).toBe(false);
  });

  it("treats an empty transfer account id as no transfer account", () => {
    // The reader normalizes "" to null (payeeMetadata.test.ts covers that), but
    // this predicate is also reachable from a raw row, so the empty string is
    // exercised here rather than assumed away.
    expect(
      isCleanupEligible(
        metadata({ transferAccountId: "" as unknown as string | null })
      )
    ).toBe(true);
  });
});

describe("ineligibleReason", () => {
  it("returns null for an eligible payee", () => {
    expect(ineligibleReason(metadata())).toBeNull();
  });

  it("reports transfer ahead of tombstone", () => {
    expect(
      ineligibleReason(metadata({ transferAccountId: "acct-1", tombstone: true }))
    ).toBe("transfer-payee");
  });

  it("reports tombstoned when that is the only reason", () => {
    expect(ineligibleReason(metadata({ tombstone: true }))).toBe("tombstoned");
  });
});

describe("partitionByEligibility", () => {
  it("splits candidates into eligible and the two exclusion buckets", () => {
    const partition = partitionByEligibility([
      candidate("a"),
      candidate("b", { transferAccountId: "acct-1" }),
      candidate("c", { tombstone: true }),
      candidate("d"),
    ]);

    expect(partition.eligible.map((p) => p.id)).toEqual(["a", "d"]);
    expect(partition.excludedTransfer.map((p) => p.id)).toEqual(["b"]);
    expect(partition.excludedTombstoned.map((p) => p.id)).toEqual(["c"]);
  });

  it("keeps exclusion counts so the scan summary can report them", () => {
    const partition = partitionByEligibility([
      candidate("a", { transferAccountId: "acct-1" }),
      candidate("b", { transferAccountId: "acct-2" }),
      candidate("c"),
    ]);

    expect(partition.excludedTransfer).toHaveLength(2);
    expect(partition.eligible).toHaveLength(1);
  });

  it("returns empty buckets for an empty budget", () => {
    const partition = partitionByEligibility([]);
    expect(partition.eligible).toEqual([]);
    expect(partition.excludedTransfer).toEqual([]);
    expect(partition.excludedTombstoned).toEqual([]);
  });
});

describe("assertCleanupEligible", () => {
  it("passes an eligible candidate", () => {
    expect(assertCleanupEligible(candidate("a"))).toBeNull();
  });

  it("blocks a transfer payee being added to a cluster or chosen as target", () => {
    // The guard every later slice calls when the UI hands back a payee id.
    expect(assertCleanupEligible(candidate("b", { transferAccountId: "acct-1" }))).toBe(
      "transfer-payee"
    );
  });

  it("blocks a tombstoned payee", () => {
    expect(assertCleanupEligible(candidate("c", { tombstone: true }))).toBe(
      "tombstoned"
    );
  });
});
