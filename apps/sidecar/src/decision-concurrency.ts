// A dependency-free limiter for the decision fan-out: maps items through an async task with at most a fixed number in flight, so a long request cannot open one model call per clause at once.
/** The most decision calls one fan-out keeps in flight at once. */
export const DEFAULT_DECISION_CONCURRENCY = 3;

/** Runs the task over every item with at most `limit` in flight, resolving to the results in the items' order; the first rejection rejects the whole map. */
export async function mapWithConcurrency<Item, Result>(items: ReadonlyArray<Item>, task: (item: Item) => Promise<Result>, limit: number = DEFAULT_DECISION_CONCURRENCY): Promise<Result[]> {
  const queue = items.entries();
  const settled = new Map<number, Result>();
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) settled.set(index, await task(item));
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return [...settled].sort(([left], [right]) => left - right).map(([, result]) => result);
}
