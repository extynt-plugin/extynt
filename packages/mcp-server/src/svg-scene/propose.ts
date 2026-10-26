// ae_propose_plan {svg}: a drawn scene compiled by the panel's compiler into the plan's native shape-layer operations.
import type { ProjectSnapshot } from "@extynt/project-graph";
import { nonEmptyStringAt, numberAt, objectsIn, stringAt } from "../json.js";
import { isJsonArray } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import { toolError, type ToolFailure } from "../tool-result.js";
import { plannedSceneLayer, sceneLayerLimitProblem, splitHeavyLayers, type PlannedSceneLayer } from "./plan.js";
import { compileSvgScene, type CompiledScene } from "./scene.js";

type SceneProposal = { readonly operations: JsonObject[]; readonly compositionId: string; readonly layers: Array<{ name: string; layerId: string }>; readonly warnings: string[] };
type Target = { id: string } | ToolFailure;

function namedComposition(id: string, scene: CompiledScene, snapshot: ProjectSnapshot): Target {
  const named = snapshot.compositions.find((item) => item.id === id);
  if (!named) return toolError("COMPOSITION_TARGET_REQUIRED", `compositionId ${id} is not in the project snapshot. Name an existing composition, or create one at ${scene.width}×${scene.height} in this plan's operations.`);
  return named.width === scene.width && named.height === scene.height ? { id: named.id } : toolError("COMPOSITION_SIZE_MISMATCH", `The target composition is ${named.width}×${named.height} but the drawing's viewBox is ${scene.width}×${scene.height}. Redraw for that composition before building.`);
}

function targetComposition(args: JsonObject, operations: readonly JsonObject[], scene: CompiledScene, snapshot: ProjectSnapshot): Target {
  const named = stringAt(args, "compositionId");
  if (named !== undefined) return namedComposition(named, scene, snapshot);
  const created = operations.filter((operation) => operation.type === "create_composition" && numberAt(operation, "width") === scene.width && numberAt(operation, "height") === scene.height);
  if (created.length > 1) return toolError("COMPOSITION_AMBIGUOUS", "This plan creates more than one composition at the drawing's size. Create one composition per scene build, or pass compositionId.");
  const createdId = stringAt(created[0], "newCompositionId");
  if (createdId !== undefined) return { id: createdId };
  const active = snapshot.compositions.find((item) => item.id === snapshot.activeCompositionId);
  if (active && active.width === scene.width && active.height === scene.height) return { id: active.id };
  return toolError("COMPOSITION_TARGET_REQUIRED", `Pass compositionId, or include a create_composition operation at the drawing's size (${scene.width}×${scene.height}) in operations; the open composition does not match it.`);
}

function givenOperations(args: JsonObject): JsonObject[] | ToolFailure {
  const given = args.operations;
  if (!isJsonArray(given)) return [];
  const rows = objectsIn(given);
  return rows.length === given.length ? [...rows] : toolError("INVALID_ARGUMENT", "operations must be objects.");
}

function plannedLayers(scene: CompiledScene, compositionId: string): PlannedSceneLayer[] {
  const center: [number, number] = [scene.width / 2, scene.height / 2];
  const size: [number, number] = [scene.width, scene.height];
  const build = { compositionId, center, size };
  return splitHeavyLayers(scene.layers).map((layer, index) => plannedSceneLayer(layer, index, build));
}

function layerLimitFailure(planned: readonly PlannedSceneLayer[]): ToolFailure | undefined {
  for (const entry of planned) {
    const problem = sceneLayerLimitProblem(entry);
    if (problem) return toolError("DESIGN_LAYER_TOO_COMPLEX", problem);
  }
  return undefined;
}

/** The plan's operations with the drawing's layers built in: composition creation first, then the drawing bottom to top, then the rest (which may target the layers by name or placeholder). */
export function sceneProposal(args: JsonObject, snapshot: ProjectSnapshot): SceneProposal | ToolFailure {
  const svg = nonEmptyStringAt(args, "svg");
  if (svg === undefined || !svg.trim()) return toolError("INVALID_ARGUMENT", "svg must be the whole scene as one <svg viewBox=\"0 0 W H\">…</svg> string.");
  const given = givenOperations(args);
  if ("error" in given) return given;
  const compiled = compileSvgScene(svg);
  if (!compiled.ok) return toolError(compiled.code, `The scene drawing did not compile (${compiled.code}): ${compiled.message}`);
  const target = targetComposition(args, given, compiled.scene, snapshot);
  if ("error" in target) return target;
  const planned = plannedLayers(compiled.scene, target.id);
  const failure = layerLimitFailure(planned);
  if (failure) return failure;
  const isCreation = (operation: JsonObject): boolean => operation.type === "create_composition";
  const operations = [...given.filter(isCreation), ...planned.flatMap((entry) => entry.operations), ...given.filter((operation) => !isCreation(operation))];
  return { operations, compositionId: target.id, layers: planned.map((entry) => ({ name: entry.layer.name, layerId: entry.placeholder })), warnings: compiled.scene.warnings.slice(0, 12) };
}
