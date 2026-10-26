// Value rows for operations on layers: naming, creating, ordering, timing, switches, parenting, matte.
import { arrayAt, numberAt, objectsIn } from "./json.js";
import type { JsonObject } from "@extynt/decode";
import { currentLayerName, fixed, layerOf, nameOnly, text, type PlainRowKey, type RowBuilder, type RowInput, type RowParts } from "./plan-row-context.js";
import { clipText, compactNumber, formatValue, humanizeName } from "./plan-row-format.js";

const ADD_LAYER_LABELS: Readonly<Record<string, PlainRowKey>> = { text: "plan.row.addTextLayer", shape: "plan.row.addShapeLayer", null: "plan.row.addNullLayer", camera: "plan.row.addCameraLayer", light: "plan.row.addLightLayer", adjustment: "plan.row.addAdjustmentLayer", solid: "plan.row.addSolidLayer", footage: "plan.row.addFootageLayer" };

function renameLayer({ state, op, ref, layer }: RowInput): RowParts {
  return { label: state.translate("plan.row.renameLayer"), before: currentLayerName(state, text(ref.layerId), layer) ?? null, after: clipText(text(op.name) ?? "") || null };
}

function createLayer({ op, state }: RowInput): RowParts {
  const label = ADD_LAYER_LABELS[text(op.layerType) ?? ""] ?? "plan.row.addLayer";
  return { label: state.translate(label), before: null, after: op.layerType === "text" ? formatValue(op.text, false, state.translate) : null };
}

function reorderLayer({ state, op, ref }: RowInput): RowParts {
  const placement = text(op.placement);
  const reference = text(op.referenceLayerId);
  const named = reference ? currentLayerName(state, reference, layerOf(state.snapshot, { ...ref, layerId: reference })) : undefined;
  const label = state.translate("plan.row.moveLayer");
  if (placement === "beginning") return { label, after: state.translate("plan.row.toTop") };
  if (placement === "end") return { label, after: state.translate("plan.row.toBottom") };
  return { label, after: named ? state.translate(placement === "before" ? "plan.row.above" : "plan.row.below", { name: clipText(named) }) : null };
}

function parentName({ state, ref }: RowInput, parentId: string | null | undefined): string {
  if (!parentId) return state.translate("plan.row.none");
  return clipText(currentLayerName(state, parentId, layerOf(state.snapshot, { ...ref, layerId: parentId })) ?? state.translate("plan.row.layer"));
}

function setLayerParent(input: RowInput): RowParts {
  const parentId = typeof input.op.parentLayerId === "string" ? input.op.parentLayerId : null;
  return { label: input.state.translate("plan.row.setParent"), before: parentName(input, input.layer?.parentId), after: parentName(input, parentId) };
}

type TimingKey = "inPoint" | "outPoint" | "startTime" | "stretch";

const TIMING_FIELDS: ReadonlyArray<readonly [TimingKey, "plan.row.timingIn" | "plan.row.timingOut" | "plan.row.timingStart" | "plan.row.timingStretch"]> = [["inPoint", "plan.row.timingIn"], ["outPoint", "plan.row.timingOut"], ["startTime", "plan.row.timingStart"], ["stretch", "plan.row.timingStretch"]];

function timingSummary(source: (key: TimingKey) => number | undefined, only: JsonObject, input: RowInput): string | null {
  const parts: string[] = [];
  for (const [key, template] of TIMING_FIELDS) {
    const value = source(key);
    if (typeof only[key] === "number" && value !== undefined) parts.push(input.state.translate(template, { value: compactNumber(value) }));
  }
  return parts.length ? parts.join(", ") : null;
}

function setLayerTiming(input: RowInput): RowParts {
  const { op, layer, state } = input;
  return { label: state.translate("plan.row.layerTiming"), before: timingSummary((key) => layer?.[key], op, input), after: timingSummary((key) => numberAt(op, key), op, input) };
}

const ATTRIBUTE_LABELS: Readonly<Record<string, PlainRowKey>> = { "blend-mode": "plan.row.blendMode", "three-d": "plan.row.threeDLayer", shy: "plan.row.shy", solo: "plan.row.solo", enabled: "plan.row.visibility", locked: "plan.row.lock" };
const CURRENT_ATTRIBUTES: ReadonlyArray<"shy" | "solo" | "enabled" | "locked"> = ["shy", "solo", "enabled", "locked"];

function setLayerAttribute({ op, layer, state }: RowInput): RowParts {
  const role = text(op.role) ?? "";
  const known = CURRENT_ATTRIBUTES.find((key) => key === role);
  const before = known && layer ? formatValue(layer[known], false, state.translate) : null;
  const after = typeof op.value === "string" ? humanizeName(op.value) : formatValue(op.value, false, state.translate);
  const key = ATTRIBUTE_LABELS[role];
  return { label: key ? state.translate(key) : humanizeName(role), before, after };
}

function setTrackMatte({ op, layer, state }: RowInput): RowParts {
  const mode = text(op.mode);
  const none = state.translate("plan.row.none");
  const before = layer && layer.matteType !== "none" ? humanizeName(layer.matteType) : none;
  const shown = mode ? (op.showMatteLayer === true ? state.translate("plan.row.matteVisible", { mode: humanizeName(mode) }) : humanizeName(mode)) : none;
  return { label: state.translate("plan.row.trackMatte"), before, after: shown };
}

const DERIVE_LABELS: Readonly<Record<string, PlainRowKey>> = { split: "plan.row.splitLayer", "audio-keyframes": "plan.row.audioToKeyframes", "shapes-from-vector": "plan.row.shapesFromVector", "shapes-from-text": "plan.row.shapesFromText", "path-null": "plan.row.pathNull" };

function deriveLayer({ op, state }: RowInput): RowParts {
  const kind = text(op.kind) ?? "";
  const at = kind === "split" && typeof op.time === "number" ? state.translate("plan.row.atTime", { time: compactNumber(op.time) }) : null;
  return { label: state.translate(DERIVE_LABELS[kind] ?? "plan.row.deriveLayer"), before: null, after: at };
}

function retimeLayer({ op, state }: RowInput): RowParts {
  if (op.mode !== "freeze") return { label: state.translate("plan.row.reverseLayer"), after: state.translate("plan.row.timeReversed") };
  return { label: state.translate("plan.row.freezeFrame"), after: typeof op.time === "number" ? state.translate("plan.row.atTime", { time: compactNumber(op.time) }) : null };
}

function dollyCamera({ op, state }: RowInput): RowParts {
  const keys = objectsIn(arrayAt(op, "keyframes"));
  const first = numberAt(keys[0], "distance"), last = numberAt(keys.at(-1), "distance");
  if (typeof first !== "number" || typeof last !== "number") return { label: state.translate("plan.row.moveCamera") };
  return { label: state.translate(last < first ? "plan.row.pushCameraIn" : "plan.row.pullCameraOut"), before: state.translate("plan.row.fromSubject", { distance: compactNumber(first) }), after: `${compactNumber(last)}px` };
}

function editKeyframes({ op, state }: RowInput): RowParts {
  const action = String(op.action ?? (op.offset !== undefined ? "move" : op.source !== undefined ? "copy" : "scale"));
  const scaled = op.factor !== undefined ? state.translate("plan.row.scaleAbout", { factor: String(op.factor), about: String(op.about) }) : null;
  return { label: state.translate("plan.row.editKeyframes", { action }), after: op.offset !== undefined ? `${String(op.offset)}s` : scaled };
}

export const LAYER_ROWS: Readonly<Record<string, RowBuilder>> = {
  set_layer_name: renameLayer,
  create_layer: createLayer,
  duplicate_layer: fixed("plan.row.duplicateLayer"),
  derive_layer: deriveLayer,
  retime_layer: retimeLayer,
  dolly_camera: dollyCamera,
  read_keyframes: fixed("plan.row.readKeyframes"),
  edit_keyframes: editKeyframes,
  remove_layer: fixed("plan.row.removeLayer"),
  reorder_layer: reorderLayer,
  set_layer_parent: setLayerParent,
  set_layer_timing: setLayerTiming,
  set_layer_attribute: setLayerAttribute,
  set_track_matte: setTrackMatte,
  precompose_layers: nameOnly("plan.row.precomposeLayers"),
};
