import { remoteBudgets } from "./check-budgets.mjs";

/**
 * The listing is the part that misled us, so it is the part with a test.
 *
 * `GET /v1/budgets` returns two different things in one array: what the sync
 * server holds (`state: "remote"`) and what the API has cached locally. When the
 * Tracking demo broke, its local entry was still listed - with neither a
 * `cloudFileId` nor a `groupId` - which is exactly the row that must not be read
 * as "this budget exists and works".
 */
describe("remoteBudgets", () => {
  const listing = {
    data: [
      // Local cache entries. The second is the broken shape: no groupId, and a
      // name that has fallen back to its id.
      {
        id: "Live-Demo---Envelope-283b5a7",
        cloudFileId: "0389217b-9f62-4eb7-a7dd-992ba7e9c9d5",
        groupId: "7d243b3e-d2dc-4863-be75-b1fd85b77c2b",
        name: "Live Demo - Envelope",
      },
      { id: "Live-Demo---Tracking-1272172", name: "Live-Demo---Tracking-1272172" },
      // What the server actually holds.
      {
        cloudFileId: "0389217b-9f62-4eb7-a7dd-992ba7e9c9d5",
        state: "remote",
        groupId: "7d243b3e-d2dc-4863-be75-b1fd85b77c2b",
        name: "Live Demo - Envelope",
      },
      {
        cloudFileId: "2df796a1-0f76-4ef5-bb85-e1c342c668bb",
        state: "remote",
        groupId: "5e48dea9-96ef-4f5e-ba26-10a5af1e4da2",
        name: "Live Demo - Tracking",
      },
    ],
  };

  it("checks what the server holds, not what the API has cached", () => {
    expect(remoteBudgets(listing)).toEqual([
      { syncId: "7d243b3e-d2dc-4863-be75-b1fd85b77c2b", name: "Live Demo - Envelope" },
      { syncId: "5e48dea9-96ef-4f5e-ba26-10a5af1e4da2", name: "Live Demo - Tracking" },
    ]);
  });

  it("still checks a budget whose local cache is broken", () => {
    // The whole point: the Tracking budget is unusable *because* of that local
    // entry, so it has to stay in the list of things to verify.
    const names = remoteBudgets(listing).map((budget) => budget.name);
    expect(names).toContain("Live Demo - Tracking");
  });

  it("ignores rows with no group id, and never lists one twice", () => {
    expect(
      remoteBudgets({
        data: [
          { state: "remote", name: "No group id" },
          { state: "remote", groupId: "g-1", name: "Once" },
          { state: "remote", groupId: "g-1", name: "Again" },
        ],
      })
    ).toEqual([{ syncId: "g-1", name: "Once" }]);
  });

  it("treats an unreadable payload as no budgets rather than throwing", () => {
    expect(remoteBudgets(null)).toEqual([]);
    expect(remoteBudgets({})).toEqual([]);
    expect(remoteBudgets({ data: "not an array" })).toEqual([]);
  });
});
