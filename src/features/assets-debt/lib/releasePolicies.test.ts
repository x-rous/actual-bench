import { localToday, previousYear } from "./calendarDate";
import { withLoanOperation } from "./operationGate";
import { syncIfNeeded } from "./syncFreshness";
import { withLoanOverviewRead } from "./overviewReads";
import { purgeLegacyLoanStorage } from "./loanStorage";

it("uses local date fields and clamps a leap-day year subtraction", () => {
  const now = new Date(2024, 1, 29, 23, 59);
  jest.spyOn(now, "toISOString").mockImplementation(() => { throw new Error("UTC date is not the user's calendar"); });
  expect(localToday(now)).toBe("2024-02-29");
  expect(previousYear("2024-02-29")).toBe("2023-02-28");
  expect(previousYear("2025-03-01")).toBe("2024-03-01");
});

it("removes legacy financial storage without touching nonfinancial preferences", () => {
  for (const storage of [localStorage, sessionStorage]) {
    storage.setItem("assets-debt:new-loan:old-budget", "financial draft");
    storage.setItem("ab:loan-status:v2:old-budget", "financial status");
    storage.setItem("assets-debt:currency:old-budget", "USD");
    storage.setItem("assets-debt:currency-preference", "EUR");
    storage.setItem("unrelated-ui-preference", "compact");
  }
  purgeLegacyLoanStorage();
  for (const storage of [localStorage, sessionStorage]) {
    expect(storage.getItem("assets-debt:new-loan:old-budget")).toBeNull();
    expect(storage.getItem("ab:loan-status:v2:old-budget")).toBeNull();
    expect(storage.getItem("assets-debt:currency:old-budget")).toBeNull();
    expect(storage.getItem("assets-debt:currency-preference")).toBe("EUR");
    expect(storage.getItem("unrelated-ui-preference")).toBe("compact");
    storage.clear();
  }
});

it("syncs before consecutive explicit actions and propagates sync failure", async () => {
  const sync = jest.fn().mockResolvedValue(undefined);
  await syncIfNeeded("policy-budget", { sync }, "if-stale");
  await syncIfNeeded("policy-budget", { sync }, "if-stale");
  expect(sync).toHaveBeenCalledTimes(2);
  sync.mockRejectedValueOnce(new Error("server unavailable"));
  await expect(syncIfNeeded("policy-budget", { sync }, "always")).rejects.toThrow("server unavailable");
});

it("queues a refresh behind an apply and releases the queue after failure", async () => {
  let finish!: () => void;
  const events: string[] = [];
  const write = withLoanOperation("same-budget", async () => {
    events.push("apply");
    await new Promise<void>((resolve) => { finish = resolve; });
    events.push("applied");
  });
  const refresh = withLoanOperation("same-budget", async () => { events.push("refresh"); });
  await Promise.resolve(); await Promise.resolve();
  expect(events).toEqual(["apply"]);
  finish(); await write; await refresh;
  expect(events).toEqual(["apply", "applied", "refresh"]);
  await expect(withLoanOperation("same-budget", async () => { throw new Error("failed"); })).rejects.toThrow("failed");
  await withLoanOperation("same-budget", async () => { events.push("recovered"); });
  expect(events.at(-1)).toBe("recovered");
});

it("bounds overview concurrency and releases a slot when a read fails", async () => {
  const finish: Array<() => void> = [];
  const started: number[] = [];
  const reads = Array.from({ length: 5 }, (_, index) => withLoanOverviewRead("overview-budget", async () => {
    started.push(index);
    await new Promise<void>((resolve) => finish.push(resolve));
    if (index === 0) throw new Error("balance unavailable");
    return index;
  }).catch(() => -1));
  expect(started).toEqual([0, 1, 2]);
  finish.shift()!();
  await reads[0];
  expect(started).toEqual([0, 1, 2, 3]);
  finish.shift()!();
  await reads[1];
  expect(started).toEqual([0, 1, 2, 3, 4]);
  for (const resolve of finish) resolve();
  expect(await Promise.all(reads)).toEqual([-1, 1, 2, 3, 4]);
});
