// Calls to the plugin made on behalf of a claimed item; the lane's client already shows every stall in the link status.
import type { BatchEntry, BatchResult, CallOutcome, PingDirectResult, PluginClient } from "@extynt/host-native";
import type { HostLaneContext } from "./lane-types.js";

/** What a batch needs of its context: the plugin's batch call and nothing else. */
export type BatchLane = { client: Pick<PluginClient, "batch"> };

/** One batch, one idle turn in After Effects; a failing op does not stop the ones after it. */
export function hostBatch(ctx: BatchLane, ops: readonly BatchEntry[]): Promise<CallOutcome<BatchResult>> {
  return ctx.client.batch(ops, { stopOnError: false });
}

/** The plugin's static facts the adapter needs (versions, architecture): what the link learned at connect, or an honest stand-in. */
export function pingOf(ctx: HostLaneContext): PingDirectResult {
  const known = ctx.link.ping();
  if (known) return known;
  const status = ctx.link.status();
  return {
    pong: true, mainThread: false, pluginVersion: status.pluginVersion ?? "unknown", aeVersion: status.aeVersion ?? "unknown", pid: status.pid ?? 0, host: status.host, arch: "unknown",
    idleAgeMs: null, idleTicks: 0, queueDepth: 0, oldestQueuedMs: null, watchers: 0, library: { version: status.libraryVersion, entryFile: null },
  };
}
