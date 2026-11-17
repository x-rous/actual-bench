/** Ordered, retryable session saves. Failed work must settle before Apply. */
export class ReconciliationSaveQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private failed: (() => Promise<unknown>)[] = [];
  private listeners = new Set<() => void>();

  get hasFailures(): boolean { return this.failed.length > 0; }

  /**
   * Told whenever `hasFailures` may have changed. A plain getter only reached
   * the screen on some unrelated re-render, so a failed save could sit
   * unannounced until the user clicked something else.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private notify() {
    for (const listener of this.listeners) listener();
  }

  enqueue<T>(write: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(async () => {
      if (this.failed.length > 0) {
        this.failed.push(write);
        throw new Error("A reconciliation save failed. Retry saving before applying.");
      }
      try { return await write(); }
      catch (error) { this.failed.push(write); this.notify(); throw error; }
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
    this.notify();
    // Enqueue all first so a second failure retains the unattempted suffix.
    const results = await Promise.allSettled(writes.map((write) => this.enqueue(write)));
    const failure = results.find((entry) => entry.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    await this.flush();
  }
}
