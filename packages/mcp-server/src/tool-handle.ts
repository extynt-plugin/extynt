// Binds a declared tool to the handler that answers it: the arguments are decoded with the tool's own spec first, so a handler is only ever given what its spec describes.
import { decode } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import type { ArgShape } from "./arg.js";
import type { ToolContext } from "./contracts.js";
import type { ToolEntry } from "./tool.js";
import { toolError } from "./tool-result.js";
import type { SnapshotHandler, ToolRequest, ToolResult } from "./tool-result.js";

/** What a tool that reads no project snapshot is given. */
export interface HostRequest<A = JsonObject> {
  readonly name: string;
  readonly args: A;
  readonly context: ToolContext;
}

/** Answers one tool from the host profile alone. */
export type HostHandler = (request: HostRequest) => ToolResult;

type ArgsOfEntry<S extends ArgShape, N extends string> = Infer<ToolEntry<S, N>["input"]["decoder"]>;

/** Binds a host-profile tool to its handler; arguments its spec rejects are refused as INVALID_ARGUMENT before the handler runs. */
export function hostHandler<S extends ArgShape, N extends string>(entry: ToolEntry<S, N>, run: (request: HostRequest<ArgsOfEntry<S, N>>) => ToolResult): readonly [N, HostHandler] {
  return [entry.name, ({ name, args, context }) => {
    const decoded = decode(entry.input.decoder, args);
    return decoded.ok ? run({ name, args: decoded.value, context }) : toolError("INVALID_ARGUMENT", decoded.error.message);
  }];
}

/** Binds a snapshot tool to its handler; arguments its spec rejects are refused as INVALID_ARGUMENT before the handler runs. */
export function snapshotHandler<S extends ArgShape, N extends string>(entry: ToolEntry<S, N>, run: (request: ToolRequest<ArgsOfEntry<S, N>>) => ToolResult): readonly [N, SnapshotHandler] {
  return [entry.name, (request) => {
    const decoded = decode(entry.input.decoder, request.args);
    return decoded.ok ? run({ ...request, args: decoded.value }) : toolError("INVALID_ARGUMENT", decoded.error.message);
  }];
}
