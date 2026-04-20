/**
 * @jest-environment node
 */
import { NextResponse } from "next/server";
import { queueServerRequest, __internals } from "./serverQueue";

const connection = (budgetSyncId?: string) => ({
  baseUrl: "http://example.test",
  apiKey: "key",
  budgetSyncId,
});

describe("queueServerRequest", () => {
  beforeEach(() => {
    __internals.serverQueueTails.clear();
    jest.restoreAllMocks();
  });

  it("serializes requests against the same baseUrl", async () => {
    const order: string[] = [];
    const make = (id: string, delay: number) => () =>
      new Promise<NextResponse>((resolve) => {
        setTimeout(() => {
          order.push(id);
          resolve(NextResponse.json({ id }, { status: 200 }));
        }, delay);
      });

    // Kick off second request while first is still running. If the queue is
    // honored, "second" must land after "first" even though its own delay
    // is shorter.
    const first = queueServerRequest(connection(), "r1", make("first", 40));
    const second = queueServerRequest(connection(), "r2", make("second", 5));

    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("runs requests for different baseUrls in parallel", async () => {
    const order: string[] = [];
    const resolveA = (id: string, delay: number) => () =>
      new Promise<NextResponse>((resolve) => {
        setTimeout(() => {
          order.push(id);
          resolve(NextResponse.json({ id }, { status: 200 }));
        }, delay);
      });

    const a = queueServerRequest(
      { baseUrl: "http://a.test", apiKey: "k" },
      "r1",
      resolveA("a", 30)
    );
    const b = queueServerRequest(
      { baseUrl: "http://b.test", apiKey: "k" },
      "r2",
      resolveA("b", 5)
    );

    await Promise.all([a, b]);
    // b was on a different server and had a shorter delay — must finish first.
    expect(order).toEqual(["b", "a"]);
  });

  it("attempts a budget close after a 5xx response when budgetSyncId is set", async () => {
    const closeSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await queueServerRequest(connection("budget-1"), "r1", async () =>
      NextResponse.json({ error: "boom" }, { status: 500 })
    );
    // Wait a tick for the tail promise to run the side-effect.
    await new Promise((r) => setTimeout(r, 0));

    expect(closeSpy).toHaveBeenCalledWith(
      "http://example.test/v1/budgets/budget-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("does not attempt a budget close on 5xx when no budgetSyncId is set", async () => {
    const closeSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await queueServerRequest(connection(), "r1", async () =>
      NextResponse.json({ error: "boom" }, { status: 500 })
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("cleans its entry from the queue map once the tail settles", async () => {
    await queueServerRequest(connection(), "r1", async () =>
      NextResponse.json({ ok: true }, { status: 200 })
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(__internals.serverQueueTails.size).toBe(0);
  });

  it("keeps the chain alive even when an operation rejects", async () => {
    const order: string[] = [];
    const rejecting = queueServerRequest(connection(), "r1", async () => {
      order.push("reject");
      throw new Error("upstream failed");
    }).catch(() => {
      order.push("caught");
    });

    const following = queueServerRequest(connection(), "r2", async () => {
      order.push("next");
      return NextResponse.json({ ok: true }, { status: 200 });
    });

    await Promise.all([rejecting, following]);
    expect(order).toEqual(["reject", "caught", "next"]);
  });
});
