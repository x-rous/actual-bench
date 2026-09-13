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

  it("reports success so callers can decide what a failure means", async () => {
    const sync = jest.fn().mockResolvedValue(undefined);
    mockGetTransport.mockReturnValue({ sync } as never);

    await expect(refreshBudget(connection)).resolves.toBe(true);
  });

  it("says it failed rather than throwing, or pretending it worked", async () => {
    /*
     * The two callers need different things from a failure, which is why this
     * returns rather than swallows. Matching carries on - it writes nothing, so
     * a slightly stale graph beats a reconciliation that cannot start because
     * the server blinked. The pre-flight check must not: it exists to notice
     * what changed in Actual, and a copy it could not refresh would report
     * "nothing changed" about a budget it never looked at, with a write next.
     */
    const sync = jest.fn().mockRejectedValue(new Error("offline"));
    mockGetTransport.mockReturnValue({ sync } as never);

    await expect(refreshBudget(connection)).resolves.toBe(false);
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
