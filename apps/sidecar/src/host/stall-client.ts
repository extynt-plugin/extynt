// The plugin client a runner holds: every call carries the link's call options (stall monitor, configured timeout) unless the caller
// brings its own, clears the link's stall when it settles, and waits out the script engine's first seconds after After Effects launches.
import { isMutationEntry } from "@extynt/host-native";
import type { BatchEntry, BatchResult, CallOptions, CallOutcome, HostCallResult, HostEntry, PluginClient, PluginOp } from "@extynt/host-native";
import type { HostLinkHandle } from "./lane-types.js";

/** When ExtendScript has no JSON and the library's json.jsx did not load, the plugin refuses every host call before running anything; the call is retried, paced by `stepMs`, for at most `budgetMs`. */
export interface ReadyRetry { stepMs: number; budgetMs: number }
const DEFAULT_READY_RETRY: ReadyRetry = { stepMs: 500, budgetMs: 15_000 };
const NOT_READY = "SCRIPT_ENGINE_NOT_READY";

type HostCallArgs = Parameters<PluginClient["hostCall"]>[1];

const refusedNotReady = <R>(outcome: CallOutcome<R>): boolean => outcome.kind === "refused" && outcome.error.code === NOT_READY;

function batchNotReady(ops: readonly BatchEntry[], outcome: CallOutcome<BatchResult>): boolean {
  if (outcome.kind !== "ok") return false;
  const items = outcome.result.results;
  if (!items.some((item) => !item.ok && item.error?.code === NOT_READY)) return false;
  return items.every((item, index) => {
    const op = ops[index];
    return !(op?.op === "host_call" && item.ok && isMutationEntry(op.entry));
  });
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

async function untilReady<R>(retry: ReadyRetry, notReady: (outcome: CallOutcome<R>) => boolean, send: () => Promise<CallOutcome<R>>): Promise<CallOutcome<R>> {
  const started = performance.now();
  for (;;) {
    const outcome = await send();
    if (!notReady(outcome) || performance.now() - started + retry.stepMs > retry.budgetMs) return outcome;
    await pause(retry.stepMs);
  }
}

async function watched<R>(link: HostLinkHandle, options: CallOptions | undefined, send: (options: CallOptions) => Promise<CallOutcome<R>>): Promise<CallOutcome<R>> {
  try { return await send(link.callOptions(options)); }
  finally { link.clearStall(); }
}

/** `client` with stall visibility and the not-ready retry on every command call. `pingDirect` is the stall monitor's own probe on the control connection and stays as it is. */
export function stallAware(client: PluginClient, link: HostLinkHandle, retry: ReadyRetry = DEFAULT_READY_RETRY): PluginClient {
  const attempt = <R>(options: CallOptions | undefined, notReady: (outcome: CallOutcome<R>) => boolean, send: (merged: CallOptions) => Promise<CallOutcome<R>>): Promise<CallOutcome<R>> =>
    untilReady(retry, notReady, () => watched(link, options, send));
  return {
    endpoint: client.endpoint,
    request: <R>(op: PluginOp, options?: CallOptions) => attempt<R>(options, () => false, (merged) => client.request<R>(op, merged)),
    batch: (ops: readonly BatchEntry[], options?: CallOptions & { stopOnError?: boolean }): Promise<CallOutcome<BatchResult>> =>
      attempt(options, (outcome) => batchNotReady(ops, outcome), (merged) => client.batch(ops, { ...merged, ...(options?.stopOnError === undefined ? {} : { stopOnError: options.stopOnError }) })),
    hostCall: (entry: HostEntry, args: HostCallArgs, options?: CallOptions): Promise<CallOutcome<HostCallResult>> =>
      attempt(options, refusedNotReady, (merged) => client.hostCall(entry, args, merged)),
    pingDirect: (timeoutMs) => client.pingDirect(timeoutMs),
    close: () => client.close(),
  };
}
