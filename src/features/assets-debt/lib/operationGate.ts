/** Serialize Actual refresh and mutation work within a connection in this tab. */
const pending = new Map<string, Promise<unknown>>();
export async function withLoanOperation<T>(connectionId: string, work: () => Promise<T>): Promise<T> {
  const before = pending.get(connectionId) ?? Promise.resolve();
  const operation = before.catch(() => {}).then(work);
  pending.set(connectionId, operation);
  try { return await operation; }
  finally { if (pending.get(connectionId) === operation) pending.delete(connectionId); }
}
