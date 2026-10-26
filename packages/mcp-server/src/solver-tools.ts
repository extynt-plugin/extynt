// Pure motion solvers wired into the tool interface.
import { findCompositionById } from "@extynt/project-graph";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { toolError } from "./tool-result.js";
import { compositionNotFound, layerNotFound } from "./inspection.js";
import { jsonFieldsOf, jsonOf } from "./json.js";
import type { JsonObject } from "@extynt/decode";
import { arcPathInput, staggerInput } from "./solver-args.js";
import type { ArcPathArgs, StaggerArgs } from "./solver-args.js";
import { measureLayer } from "./solvers/geometry.js";
import { solveArcPath } from "./solvers/path.js";
import { solveStagger } from "./solvers/stagger.js";
import type { HostRequest } from "./tool-handle.js";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-result.js";

const ARC_NEXT_VALUES = "Paste position.keyframes (and rotation.keyframes if present) into animate_property for this layer, or pass target to receive ready operations. Values are in the layer's parent space.";
const ARC_NEXT_OPERATIONS = "Queue or propose these operations as they are. Values are in the layer's parent space: correct for an unparented layer; for a parented layer, convert center/start with ae_measure_layer first.";

interface Target {
  readonly compositionId: string;
  readonly layerId: string;
}

function answer(name: string, data: JsonObject): ToolResult {
  return { ok: true, tool: name, snapshotFingerprint: null, data };
}

function arcTarget(target: Target | undefined): Target | undefined | ToolFailure {
  if (target === undefined) return undefined;
  if (target.compositionId.length === 0 || target.layerId.length === 0) return toolError("INVALID_ARGUMENT", "target must be { compositionId, layerId } with non-empty strings.");
  return { compositionId: target.compositionId, layerId: target.layerId };
}

/** Answers ae_solve_arc_path: the keyframes of a circular arc, or ready operations when a target is given. */
export function arcPathTool({ name, args }: HostRequest<ArcPathArgs>): ToolResult {
  const input = arcPathInput(args);
  if (typeof input === "string") return toolError("INVALID_ARGUMENT", input);
  const target = arcTarget(args.target);
  if (target !== undefined && "error" in target) return target;
  const result = solveArcPath(input);
  if (!result.ok) return toolError(result.error.code, result.error.message);
  const { ok: _ok, ...solved } = result;
  const data = jsonFieldsOf(solved);
  if (target === undefined) return answer(name, { ...data, next: ARC_NEXT_VALUES });
  const tracks = [{ track: result.position, role: "transform.position" }, ...(result.rotation ? [{ track: result.rotation, role: "transform.rotation" }] : [])];
  const operations = tracks.map(({ track, role }) => ({ type: "animate_property", target: { ...target, propertyPath: track.propertyPath }, role, keyframes: track.keyframes }));
  return answer(name, { ...data, ...jsonFieldsOf({ operations, next: ARC_NEXT_OPERATIONS }) });
}

function staggerLayerIds(value: ReadonlyArray<string> | undefined, count: number): ReadonlyArray<string> | undefined | ToolFailure {
  if (value === undefined) return count === 0 ? toolError("INVALID_ARGUMENT", "count is required, or pass layerIds.") : undefined;
  if (value.some((id) => id.length === 0)) return toolError("INVALID_ARGUMENT", "layerIds must be an array of non-empty strings.");
  if (count > 0 && count !== value.length) return toolError("INVALID_ARGUMENT", `count ${count} and layerIds length ${value.length} must match.`);
  return value;
}

/** Answers ae_solve_stagger: staggered start times, per layer when layerIds are given. */
export function staggerTool({ name, args }: HostRequest<StaggerArgs>): ToolResult {
  const count = args.count ?? 0;
  const layerIds = staggerLayerIds(args.layerIds, count);
  if (layerIds !== undefined && "error" in layerIds) return layerIds;
  const result = solveStagger(staggerInput(args, layerIds ? layerIds.length : count));
  if (!result.ok) return toolError(result.error.code, result.error.message);
  const { ok: _ok, ...solved } = result;
  const data = jsonFieldsOf(solved);
  if (!layerIds) return answer(name, data);
  const items = layerIds.map((layerId, index) => ({ layerId, start: solved.starts[index], ...(solved.ends ? { end: solved.ends[index] } : {}) }));
  return answer(name, { ...data, ...jsonFieldsOf({ items }) });
}

/** Snapshot-backed: where a layer really sits in composition space. */
export function measureLayerTool(base: ToolBase, snapshot: ProjectSnapshot, args: { readonly compositionId: string; readonly layerId: string }): ToolResult {
  const { compositionId, layerId } = args;
  if (compositionId.length === 0) return toolError("INVALID_ARGUMENT", "compositionId must be a non-empty string.");
  const composition = findCompositionById(snapshot, compositionId);
  if (!composition) return compositionNotFound(snapshot, compositionId);
  if (layerId.length === 0) return toolError("INVALID_ARGUMENT", "layerId must be a non-empty string.");
  if (!composition.layers.some((layer) => layer.id === layerId)) return layerNotFound(composition.id, composition.name, composition.layers, layerId);
  const result = measureLayer(snapshot, compositionId, layerId);
  if (!result.ok) return toolError(result.error.code, result.error.message);
  const { ok: _ok, ...measured } = result;
  return { ...base, data: jsonOf(measured) };
}
