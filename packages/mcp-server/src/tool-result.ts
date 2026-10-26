// The shapes every tool call answers with, and what a family handler is given.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { ToolContext } from "./contracts.js";
import type { JsonObject, JsonValue } from "@extynt/decode";

/** The identity every successful result carries; the fingerprint is the snapshot the answer was read from. */
export type ToolBase = {
  readonly ok: true;
  readonly tool: string;
  readonly snapshotFingerprint: string;
};

type ToolSuccess = {
  readonly ok: true;
  readonly tool: string;
  readonly snapshotFingerprint: string | null;
  readonly data: JsonValue;
  readonly truncated?: boolean;
  readonly undoPlanId?: string;
};

/** A tool call that was refused, with the code and the sentence the model reads. */
export type ToolFailure = {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
};

/** The refusal for a tool call. */
export function toolError(code: string, message: string): ToolFailure {
  return { ok: false, error: { code, message } };
}

/** The answer for a tool call: the identity of the call and the data it read. */
export function toolSuccess(base: ToolBase, data: JsonValue): ToolSuccess {
  return { ok: true, tool: base.tool, snapshotFingerprint: base.snapshotFingerprint, data };
}

/** What a tool call returns. */
export type ToolResult = ToolSuccess | ToolFailure;

/** Everything a snapshot handler reads: the tool name, its arguments as the tool's spec decodes them, and the context the dispatcher already gated. */
export interface ToolRequest<A = JsonObject> {
  readonly name: string;
  readonly args: A;
  readonly context: ToolContext;
  readonly base: ToolBase;
  readonly snapshot: ProjectSnapshot;
}

/** Answers one tool from a loaded project snapshot. */
export type SnapshotHandler = (request: ToolRequest) => ToolResult;

/** The answer of a tool that reads no project snapshot, so carries no fingerprint. */
export function hostSuccess(tool: string, data: JsonValue, truncated?: boolean): ToolSuccess {
  const result = { ok: true as const, tool, snapshotFingerprint: null, data };
  return truncated === undefined ? result : { ...result, truncated };
}
