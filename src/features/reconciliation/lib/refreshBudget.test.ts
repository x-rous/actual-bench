import { refreshBudget } from "./loadCandidates";
import { getTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";

jest.mock("@/lib/actual", () => ({ getTransport: jest.fn() }));

const mockGetTransport = getTransport as jest.MockedFunction<typeof getTransport>;
const connection = { id: "c1" } as unknown as ConnectionInstance;

/*
 * The local budget is a copy, and nothing in a reconciliation refreshed it. A
 * session could be built entirely on what Actual looked like whenever the
 * connection happened to open - and transactions deleted in Actual stayed in
 * that copy, matching the statement perfectly because they had been created
 * from it.
 *
 * Not the same thing as the toolbar's Refresh, which invalidates the query
 * cache sitting in front of the copy and so re-reads the same stale data.
 */
describe("bringing the budget up to date before reading it", () => {
  it("syncs the budget rather than a cache in front of it", async () => {
    const sync = jest.fn().mockResolvedValue(undefined);
    mockGetTransport.mockReturnValue({ sync } as never);

    await refreshBudget(connection);

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("carries on when the server cannot be reached", async () => {
    /*
     * A reconciliation built on a slightly stale copy is worse than one built
     * on a fresh one, and far better than one that cannot start at all because
     * the server blinked. The pre-flight drift check still stands behind it.
     */
    const sync = jest.fn().mockRejectedValue(new Error("offline"));
    mockGetTransport.mockReturnValue({ sync } as never);

    await expect(refreshBudget(connection)).resolves.toBeUndefined();
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
