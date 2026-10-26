/** Later operations of the same plan that rewrite what an earlier one reads back from the final snapshot. */

interface Row {
  operation?: string | undefined;
  compositionId?: string | undefined;
  layerId?: string | undefined;
  propertyPath?: string | undefined;
  effectPath?: string | undefined;
  role?: string | undefined;
}

/** What the failed read-back compared: a value, the keyframes, or whether the thing is there at all. */
export type ReadBackKind = "value" | "keys" | "missing";

const NON_MUTATING: ReadonlySet<string> = new Set(["read_keyframes", "export_frame", "export_mogrt", "render_composition", "save_project", "open_composition", "collect_project", "save_layer_preset", "start_analysis", "set_project_settings"]);
const WHOLE_LAYER: ReadonlySet<string> = new Set(["remove_layer", "replace_layer_source", "set_layer_parent", "resize_solid", "center_anchor", "copy_effects", "retime_layer", "set_time_remap", "precompose_layers", "set_layer_timing", "apply_preset", "switch_project"]);
const COMPOSITION_LEVEL: ReadonlySet<string> = new Set(["set_composition_settings", "set_composition_guides"]);
const KEY_CHANGING: ReadonlySet<string> = new Set(["animate_property", "animate_control", "edit_keyframes", "set_time_remap"]);
const REMOVES_OR_REPLACES: ReadonlySet<string> = new Set(["remove_layer", "replace_layer_source", "precompose_layers", "apply_preset", "copy_effects", "switch_project"]);

function pathOf(row: Row): string {
  return row.propertyPath || row.effectPath || "";
}

function related(first: string, second: string): boolean {
  return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`);
}

function otherLayerInterferes(laterKind: string, later: Row): boolean {
  return laterKind === "precompose_layers" || (laterKind === "remove_layer" && !later.layerId);
}

function wholeLayerInterferes(laterKind: string, readBack: ReadBackKind): boolean {
  if (readBack === "missing") return REMOVES_OR_REPLACES.has(laterKind);
  return readBack !== "keys" || laterKind !== "set_layer_parent";
}

function pathInterferes(paths: { earlier: string; later: string }, laterKind: string, readBack: ReadBackKind): boolean {
  if (paths.earlier === "" || !related(paths.earlier, paths.later)) return false;
  return readBack === "value" || (readBack === "keys" && KEY_CHANGING.has(laterKind)) || laterKind === "remove_effect";
}

function sameLayerInterferes(earlier: Row, later: Row, readBack: ReadBackKind): boolean {
  const laterKind = later.operation ?? "";
  if (WHOLE_LAYER.has(laterKind)) return wholeLayerInterferes(laterKind, readBack);
  const laterPath = pathOf(later);
  if (laterPath) return pathInterferes({ earlier: pathOf(earlier), later: laterPath }, laterKind, readBack);
  return later.operation === earlier.operation && later.role !== undefined && later.role === earlier.role;
}

function layerInterferes(earlier: Row, later: Row, readBack: ReadBackKind): boolean {
  return later.layerId === earlier.layerId ? sameLayerInterferes(earlier, later, readBack) : otherLayerInterferes(later.operation ?? "", later);
}

function interferes(earlier: Row, later: Row, readBack: ReadBackKind): boolean {
  const laterKind = later.operation ?? "";
  if (NON_MUTATING.has(laterKind)) return false;
  if (laterKind === "switch_project") return true;
  if (later.compositionId !== earlier.compositionId) return false;
  if (earlier.layerId) return layerInterferes(earlier, later, readBack);
  return COMPOSITION_LEVEL.has(laterKind) && later.operation === earlier.operation;
}

/**
 * The first later operation that can change what the one at `index` wrote or created, or null. Deliberately narrow: an
 * unrelated later operation hides nothing. `readBack` "keys" means the failed read-back compared keyframes, which only
 * another key-changing operation can alter.
 */
export function laterInterference(operations: ReadonlyArray<Row>, index: number, readBack: ReadBackKind = "value"): { index: number; operation: string } | null {
  const earlier = operations[index];
  if (!earlier) return null;
  for (let next = index + 1; next < operations.length; next += 1) {
    const later = operations[next];
    if (later && interferes(earlier, later, readBack)) return { index: next, operation: String(later.operation) };
  }
  return null;
}
