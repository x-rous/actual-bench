/** Ordered, retryable session saves. Failed work must settle before Apply. */
export class ReconciliationSaveQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private failed: (() => Promise<unknown>)[] = [];

  get hasFailures(): boolean { return this.failed.length > 0; }

  enqueue<T>(write: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(async () => {
      if (this.failed.length > 0) {
        this.failed.push(write);
        throw new Error("A reconciliation save failed. Retry saving before applying.");
      }
      try { return await write(); }
      catch (error) { this.failed.push(write); throw error; }
    });
    this.tail = next;
    return next;
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failed.length) throw new Error("Retry the failed reconciliation saves before applying.");
  }

  async retry(): Promise<void> {
    await this.tail.catch(() => undefined);
    const writes = this.failed.splice(0);
    // Enqueue all first so a second failure retains the unattempted suffix.
    const results = await Promise.allSettled(writes.map((write) => this.enqueue(write)));
    const failure = results.find((entry) => entry.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    await this.flush();
  }
}
