import { ReconciliationSaveQueue } from "./saveQueue";

it("serializes rapid edits, blocks Apply after a failure and retries the retained suffix in order", async () => {
  const queue = new ReconciliationSaveQueue();
  const calls: string[] = [];
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let attempts = 0;
  const first = queue.enqueue(async () => { calls.push("first"); await waiting; });
  const second = queue.enqueue(async () => { calls.push("second"); if (++attempts < 3) throw new Error("offline"); });
  const third = queue.enqueue(async () => { calls.push("third"); });
  const settled = Promise.allSettled([first, second, third]);
  await Promise.resolve();
  expect(calls).toEqual([]);
  release(); await settled;
  await expect(queue.flush()).rejects.toThrow();
  expect(calls).toEqual(["first", "second"]);
  await expect(queue.retry()).rejects.toThrow("offline");
  expect(calls).toEqual(["first", "second", "second"]);
  await queue.retry(); await queue.flush();
  expect(calls).toEqual(["first", "second", "second", "second", "third"]);
});
