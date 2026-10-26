// A bounded wait for a condition on sidecar state, woken by every state change.
import type { SidecarState } from "./server-state.js";

/** Resolves true as soon as `predicate` holds and false when `ms` pass, the sidecar stops or `signal` aborts first; state changes wake it. */
export function waitForState(state: Pick<SidecarState, "changeWaiters" | "server">, predicate: () => boolean, ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(predicate()), ms);
    const onAbort = () => settle(predicate());
    function settle(result: boolean): void {
      clearTimeout(timer);
      state.changeWaiters.delete(check);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    }
    signal?.addEventListener("abort", onAbort);
    if (signal?.aborted) { settle(predicate()); return; }
    function check(): void {
      if (predicate()) settle(true);
      else if (!state.server) settle(false);
      else state.changeWaiters.add(check);
    }
    if (predicate()) settle(true);
    else state.changeWaiters.add(check);
  });
}
