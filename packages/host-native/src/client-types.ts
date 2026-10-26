// The client contract: what a caller of the plugin link sees. client.ts implements it; the sidecar host lane (apps/sidecar/src/host) and tools/fake-plugin code against it.
import type { Socket } from "node:net";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { BatchResult, HostCallResult } from "./wire-calls.js";
import type { BatchEntry, HostEntry, PluginOp } from "./protocol.js";
import type { PingDirectResult, WaitingOnDialog } from "./wire-ping.js";
import type { PluginEvent } from "./wire-watch.js";
import type { WireError, WireTiming } from "./wire-common.js";

/** The discovery file (native.json) the plugin writes: where to connect and the token every line carries. */
export interface PluginEndpoint { path: string; port: number; token: string; pid: number | null; pluginVersion: string | null; aeVersion: string | null }

/** What a stalled call reports: how long it has waited, the plugin's idle age and queue depth when it answered, the After Effects window the call is waiting on (else null), and the verdict. */
export interface StallReport { waitedMs: number; idleAgeMs: number | null; queueDepth: number | null; dialog: WaitingOnDialog | null; verdict: "ae-busy" | "plugin-unresponsive" | "slow" }

/**
 * Options for one call. `timeoutMs` defaults to 60_000 for a read and 900_000 for a mutation; a call that has waited `stallAfterMs` (default 2000) starts
 * pinging on the control connection and reports each verdict to `onStall`.
 */
export interface CallOptions {
  timeoutMs?: number;
  stallAfterMs?: number;
  onStall?: (report: StallReport) => void;
}

/** How a call ended; `sent: true` on a lost mutation means the outcome is unknown. */
export type CallOutcome<R> =
  | { kind: "ok"; result: R; timing: WireTiming; rttMs: number }
  | { kind: "refused"; error: WireError; rttMs: number }
  | { kind: "lost"; reason: "timeout" | "closed" | "protocol" | "shutting-down"; sent: boolean; waitedMs: number };

/** A live link to the plugin. `request` is the caller-names-the-type form (`R` is trusted, not checked); `hostCall` sends the arguments as a JSON string the plugin never parses into code. */
export interface PluginClient {
  readonly endpoint: PluginEndpoint;
  request<R = JsonValue>(op: PluginOp, options?: CallOptions): Promise<CallOutcome<R>>;
  batch(ops: readonly BatchEntry[], options?: CallOptions & { stopOnError?: boolean }): Promise<CallOutcome<BatchResult>>;
  hostCall(entry: HostEntry, args: JsonObject, options?: CallOptions): Promise<CallOutcome<HostCallResult>>;
  pingDirect(timeoutMs?: number): Promise<CallOutcome<PingDirectResult>>;
  close(): void;
}

/** A link whose raw results and call arguments are exact JSON: nothing in it is trusted by assertion. */
export interface JsonPluginClient extends PluginClient {
  requestJson(op: PluginOp, options?: CallOptions): Promise<CallOutcome<JsonValue>>;
  hostCallJson(entry: HostEntry, args: JsonObject, options?: CallOptions): Promise<CallOutcome<HostCallResult>>;
}

export interface ConnectOptions {
  endpoint: PluginEndpoint;
  watch?: { intervalMs?: number; stillMs?: number };
  onEvent(event: PluginEvent): void;
  onClose(reason: "host-closing" | "reset" | "closed-by-client"): void;
  createConnection?: (port: number) => Socket;
}
