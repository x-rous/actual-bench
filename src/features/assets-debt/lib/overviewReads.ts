/** Bound overview work per connection; the query cache still owns results and errors. */
type Queue = { active: number; waiting: Array<() => void> };
const queues = new Map<string, Queue>();
const LIMIT = 3;

export async function withLoanOverviewRead<T>(scope: string, read: () => Promise<T>): Promise<T> {
  const queue: Queue = queues.get(scope) ?? { active: 0, waiting: [] };
  queues.set(scope, queue);
  if (queue.active >= LIMIT) await new Promise<void>((resolve) => queue.waiting.push(resolve));
  else queue.active++;
  try { return await read(); }
  finally {
    const next = queue.waiting.shift();
    if (next) next();
    else {
      queue.active--;
      if (!queue.active) queues.delete(scope);
    }
  }
}
