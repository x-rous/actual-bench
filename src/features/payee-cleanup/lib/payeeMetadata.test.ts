import { fallbackMetadata, getPayeeCleanupMetadata } from "./payeeMetadata";
import { runQuery } from "../../../lib/api/query";
import type { ConnectionInstance } from "@/store/connection";

jest.mock("../../../lib/api/query", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const httpConnection = { id: "c1", mode: "http-api" } as ConnectionInstance;
const directConnection = { id: "c2", mode: "browser-api" } as ConnectionInstance;

beforeEach(() => {
  mockRunQuery.mockReset();
});

describe("getPayeeCleanupMetadata", () => {
  it("queries the AQL payees table for the fields getPayees() cannot return", () => {
    mockRunQuery.mockResolvedValue({ data: [] });

    return getPayeeCleanupMetadata(httpConnection).then(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(httpConnection, {
        ActualQLquery: {
          table: "payees",
          select: [
            "id",
            "favorite",
            "learn_categories",
            "tombstone",
            "transfer_acct",
          ],
        },
      });
    });
  });

  it("never selects `category` — upstream does not populate it (F-095)", async () => {
    mockRunQuery.mockResolvedValue({ data: [] });
    await getPayeeCleanupMetadata(httpConnection);

    const body = mockRunQuery.mock.calls[0][1] as {
      ActualQLquery: { select: string[] };
    };
    expect(body.ActualQLquery.select).not.toContain("category");
  });

  it("normalizes SQLite 1/0 booleans from the HTTP transport", async () => {
    mockRunQuery.mockResolvedValue({
      data: [
        {
          id: "p1",
          favorite: 1,
          learn_categories: 0,
          tombstone: 0,
          transfer_acct: null,
        },
      ],
    });

    const map = await getPayeeCleanupMetadata(httpConnection);
    expect(map.get("p1")).toEqual({
      id: "p1",
      favorite: true,
      learnCategories: false,
      tombstone: false,
      transferAccountId: null,
    });
  });

  it("normalizes real booleans from the Direct transport to the same shape", async () => {
    mockRunQuery.mockResolvedValue({
      data: [
        {
          id: "p1",
          favorite: true,
          learn_categories: false,
          tombstone: false,
          transfer_acct: undefined,
        },
      ],
    });

    const map = await getPayeeCleanupMetadata(directConnection);
    expect(map.get("p1")).toEqual({
      id: "p1",
      favorite: true,
      learnCategories: false,
      tombstone: false,
      transferAccountId: null,
    });
  });

  it("keeps tombstoned rows so the eligibility boundary can exclude them", async () => {
    // Filtering here would under-report the analyzed payee count and hide the
    // reason a payee is missing from the suggestions list.
    mockRunQuery.mockResolvedValue({
      data: [{ id: "dead", favorite: 0, learn_categories: 1, tombstone: 1 }],
    });

    const map = await getPayeeCleanupMetadata(httpConnection);
    expect(map.get("dead")?.tombstone).toBe(true);
  });

  it("preserves the transfer account id that makes a payee ineligible", async () => {
    mockRunQuery.mockResolvedValue({
      data: [{ id: "xfer", transfer_acct: "acct-9" }],
    });

    const map = await getPayeeCleanupMetadata(httpConnection);
    expect(map.get("xfer")?.transferAccountId).toBe("acct-9");
  });

  it("normalizes an empty transfer_acct string to null", async () => {
    mockRunQuery.mockResolvedValue({
      data: [{ id: "p1", transfer_acct: "" }],
    });

    const map = await getPayeeCleanupMetadata(httpConnection);
    expect(map.get("p1")?.transferAccountId).toBeNull();
  });

  it("skips rows with no usable id rather than keying on undefined", async () => {
    mockRunQuery.mockResolvedValue({
      data: [{ id: null }, { favorite: 1 }, { id: "good" }],
    });

    const map = await getPayeeCleanupMetadata(httpConnection);
    expect([...map.keys()]).toEqual(["good"]);
  });

  it("tolerates a response with no data array", async () => {
    mockRunQuery.mockResolvedValue({} as { data: [] });
    await expect(getPayeeCleanupMetadata(httpConnection)).resolves.toEqual(
      new Map()
    );
  });
});

describe("fallbackMetadata", () => {
  it("treats an unmatched payee as live with no preferences set", () => {
    // getPayees() already excludes tombstoned rows, so assuming tombstoned here
    // would silently drop a real cleanup candidate.
    expect(fallbackMetadata("p1", null)).toEqual({
      id: "p1",
      favorite: false,
      learnCategories: false,
      tombstone: false,
      transferAccountId: null,
    });
  });

  it("carries through a known transfer account so eligibility still rejects it", () => {
    expect(fallbackMetadata("xfer", "acct-1").transferAccountId).toBe("acct-1");
  });
});
