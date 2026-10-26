// The chat request whose turn is running, carried along the async chain so that a decision call made inside the turn is counted against that turn's usage.
import { AsyncLocalStorage } from "node:async_hooks";

const scope = new AsyncLocalStorage<string>();

/** Runs `work` with `requestId` as the chat request its decision calls belong to. */
export function inRequestScope<T>(requestId: string, work: () => Promise<T>): Promise<T> {
  return scope.run(requestId, work);
}

/** The chat request the running code belongs to, or null outside a chat turn. */
export function currentRequestId(): string | null {
  return scope.getStore() ?? null;
}
