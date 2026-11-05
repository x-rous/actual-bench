import { attempt } from "./attempt";

describe("attempt", () => {
  it("runs the work, then onDone, and never onError, when the work succeeds", async () => {
    const order: string[] = [];
    await attempt(async () => { order.push("work"); }, { onError: () => { order.push("error"); }, onDone: () => { order.push("done"); } });
    expect(order).toEqual(["work", "done"]);
  });

  it("hands what the work throws to onError and still runs onDone", async () => {
    const order: string[] = [];
    const boom = new Error("boom");
    await attempt(async () => { order.push("work"); throw boom; }, { onError: (error) => { order.push(error === boom ? "error" : "other"); }, onDone: () => { order.push("done"); } });
    expect(order).toEqual(["work", "error", "done"]);
  });

  it("runs onDone after an early return from the work", async () => {
    const order: string[] = [];
    await attempt(async () => { if (order.length === 0) return; order.push("never"); }, { onDone: () => { order.push("done"); } });
    expect(order).toEqual(["done"]);
  });

  it("waits for an async onError before onDone, as a catch block that awaits would", async () => {
    const order: string[] = [];
    await attempt(async () => { throw new Error("x"); }, {
      onError: async () => { await Promise.resolve(); order.push("error finished"); },
      onDone: () => { order.push("done"); },
    });
    expect(order).toEqual(["error finished", "done"]);
  });

  it("lets an error from onError reach the caller after onDone has run, like a throw inside a catch block", async () => {
    const order: string[] = [];
    await expect(attempt(async () => { throw new Error("first"); }, {
      onError: () => { throw new Error("second"); },
      onDone: () => { order.push("done"); },
    })).rejects.toThrow("second");
    expect(order).toEqual(["done"]);
  });

  it("passes the error on to the caller, after onDone, when there is no onError", async () => {
    const order: string[] = [];
    await expect(attempt(async () => { throw new Error("kept"); }, { onDone: () => { order.push("done"); } })).rejects.toThrow("kept");
    expect(order).toEqual(["done"]);
  });
});
