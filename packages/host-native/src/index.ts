// @extynt/host-native: the wire contract between the sidecar and the extynt After Effects plugin.
export * from "./host-identity.js";
export * from "./protocol.js";
export * from "./wire-calls.js";
export * from "./wire-ping.js";
export * from "./wire-response.js";
export * from "./wire-watch.js";
export { wireError, wireTiming } from "./wire-common.js";
export type { WireError, WireTiming } from "./wire-common.js";
export { isRecord, parseEffectMenusResult, parseHostCallResult, parseWatchState } from "./unknown-input.js";
export type { NativeReadResult } from "./unknown-input.js";
export type {
  CallOptions, CallOutcome, ConnectOptions, JsonPluginClient, PluginClient, PluginEndpoint, StallReport,
} from "./client-types.js";
export * from "./client.js";
export * from "./discovery.js";
export * from "./events.js";
export * from "./options-dialogs.js";
