import { refreshFromServer } from "./refreshFromServer";

/*
 * The order is the fix. Invalidating first refetches every query from the budget
 * as it stands and only then updates it, so the screens settle on what was there
 * a moment before the refresh - which is what the button is pressed to escape.
 */
describe("refreshing what is on screen", () => {
  it("pulls the budget before dropping the caches in front of it", async () => {
    const order: string[] = [];
    await refreshFromServer({
      sync: async () => {
        order.push("sync");
      },
      invalidate: async () => {
        order.push("invalidate");
      },
    });

    expect(order).toEqual(["sync", "invalidate"]);
  });

  it("waits for the budget before reading from it", async () => {
    // Not merely called first - finished first. Firing the invalidate while the
    // sync is still in flight has the same effect as running it first.
    let synced = false;
    let sawSyncedDuringInvalidate = false;

    await refreshFromServer({
      sync: async () => {
        await Promise.resolve();
        synced = true;
      },
      invalidate: async () => {
        sawSyncedDuringInvalidate = synced;
      },
    });

    expect(sawSyncedDuringInvalidate).toBe(true);
  });

  it("still drops the caches when the server cannot be reached", async () => {
    // They may be older than the budget the app already holds, so refreshing
    // them is worth doing even when nothing new could be pulled.
    const invalidate = jest.fn().mockResolvedValue(undefined);
    const onSyncFailed = jest.fn();

    await refreshFromServer({
      sync: () => Promise.reject(new Error("offline")),
      invalidate,
      onSyncFailed,
    });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(onSyncFailed).toHaveBeenCalledTimes(1);
  });

  it("says when the budget could not be pulled", async () => {
    // Silence is how the stale data got trusted in the first place.
    const onSyncFailed = jest.fn();
    await refreshFromServer({
      sync: () => Promise.reject(new Error("offline")),
      invalidate: async () => {},
      onSyncFailed,
    });

    expect(onSyncFailed).toHaveBeenCalledWith(expect.any(Error));
  });
});
