// The keyframe-assistant solver as a tool: sequence layers, wiggle and smooth, each returning values or ready plan operations.
import { toolError } from "./tool-result.js";
import { jsonFieldsOf, objectOf, stringAt } from "./json.js";
import type { JsonObject } from "@extynt/decode";
import { sequenceInput, smoothInput, wiggleInput } from "./solver-args.js";
import type { AssistantArgs } from "./solver-args.js";
import { solveSequenceLayers, solveSmooth, solveWiggle } from "./solvers/assistants.js";
import type { HostRequest } from "./tool-handle.js";
import type { ToolResult } from "./tool-result.js";

interface Target {
  readonly compositionId: string;
  readonly layerId?: string;
}

const TARGET_HELP = "target must be { compositionId, layerId } with non-empty strings.";

function targetOf(target: JsonObject | undefined): Target | undefined | "invalid" {
  if (target === undefined) return undefined;
  const compositionId = stringAt(target, "compositionId");
  const layerId = target.layerId;
  if (!compositionId || (layerId !== undefined && (typeof layerId !== "string" || layerId.length === 0))) return "invalid";
  return typeof layerId === "string" ? { compositionId, layerId } : { compositionId };
}

function answer(name: string, data: JsonObject): ToolResult {
  return { ok: true, tool: name, snapshotFingerprint: null, data };
}

function sequenceTool(name: string, args: AssistantArgs, target: Target | undefined): ToolResult {
  const result = solveSequenceLayers(sequenceInput(args));
  if (!result.ok) return toolError(result.error.code, result.error.message);
  const { ok: _ok, ...solved } = result;
  const data = jsonFieldsOf(solved);
  if (!target) return answer(name, data);
  const operations = solved.items.map((item) => ({ type: "set_layer_timing", target: { compositionId: target.compositionId, layerId: item.layerId }, inPoint: item.inPoint, outPoint: item.outPoint, startTime: item.startTime }));
  const next = "Queue or propose these set_layer_timing operations as they are: each layer keeps its duration and moves to its new in point.";
  return answer(name, { ...data, ...jsonFieldsOf({ operations, next }) });
}

function keyframeTool(name: string, kind: "wiggle" | "smooth", args: AssistantArgs, target: Target | undefined): ToolResult {
  const result = kind === "wiggle" ? solveWiggle(wiggleInput(args)) : solveSmooth(smoothInput(args));
  if (!result.ok) return toolError(result.error.code, result.error.message);
  const { ok: _ok, ...solved } = result;
  const data = jsonFieldsOf(solved);
  if (!target) return answer(name, data);
  const propertyPath = args.propertyPath;
  if (!target.layerId || !propertyPath) return toolError("INVALID_ARGUMENT", "To get an operation, pass target { compositionId, layerId } and propertyPath.");
  const operation = objectOf({ type: "animate_property", target: { ...target, propertyPath }, keyframeMode: kind === "smooth" ? "replace" : undefined, keyframes: jsonFieldsOf({ keyframes: solved.keyframes }).keyframes });
  const next = kind === "smooth" ? "This replaces the property's keys with the smoothed set." : "Queue or propose this operation as it is; if the property already has keys, add keyframeMode \"merge\" or \"replace\".";
  return answer(name, { ...data, operations: [operation], next });
}

/** Answers ae_solve_keyframe_assistant: sequence-layers, wiggle or smooth; with a target, the answer also carries the operations to queue. */
export function keyframeAssistantTool({ name, args }: HostRequest<AssistantArgs>): ToolResult {
  const target = targetOf(args.target);
  if (target === "invalid") return toolError("INVALID_ARGUMENT", TARGET_HELP);
  return args.assistant === "sequence-layers" ? sequenceTool(name, args, target) : keyframeTool(name, args.assistant, args, target);
}
