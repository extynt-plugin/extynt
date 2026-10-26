// Value rows for shapes, masks, markers, scene objects, compositions and project items.
import { converterTradeOffs } from "@extynt/action-plan";
import { arrayAt, stringsIn } from "./json.js";
import type { JsonValue } from "@extynt/decode";
import { colorHex, isColorTuple, compactNumber, describeFields, formatValue, humanizeName } from "./plan-row-format.js";
import { fieldsOf, fixed, nameOnly, text, type PlainRowKey, type RowBuilder, type RowInput, type RowParts } from "./plan-row-context.js";
import type { Translate } from "@extynt/ui-text";

function counted(value: JsonValue | undefined, key: "plan.row.points" | "plan.row.guides", translate: Translate): string | null {
  return Array.isArray(value) ? translate(key, { count: value.length }) : null;
}

function colourOf(value: JsonValue | undefined): string | null {
  return isColorTuple(value) ? colorHex(value) : null;
}

function shapePath({ op, state }: RowInput): RowParts {
  return { label: state.translate("plan.row.shapePath"), after: counted(fieldsOf(op.path).vertices, "plan.row.points", state.translate) };
}

function shapeFill({ op, state }: RowInput): RowParts {
  return { label: state.translate("plan.row.shapeFill"), after: colourOf(op.color) };
}

function shapeStroke({ op, state }: RowInput): RowParts {
  const colour = colourOf(op.color);
  const width = typeof op.width === "number" ? state.translate("plan.row.px", { value: compactNumber(op.width) }) : null;
  return { label: state.translate("plan.row.shapeStroke"), after: [colour, width].filter(Boolean).join(", ") || null };
}

function shapeItem(label: "plan.row.addShapeItem" | "plan.row.changeShapeItem"): RowBuilder {
  return ({ op, state }) => ({ label: state.translate(label, { item: humanizeName(text(op.item) ?? state.translate("plan.row.itemDefault")) }), after: describeFields(fieldsOf(op.values), 3, state.translate) });
}

function maskValues(label: PlainRowKey): RowBuilder {
  return ({ op, state }) => ({ label: state.translate(label), after: describeFields(fieldsOf(op.values), 3, state.translate) });
}

function markerRow(label: PlainRowKey): RowBuilder {
  return ({ op, state }) => ({ label: state.translate(label), after: formatValue(op.comment, false, state.translate) ?? (typeof op.time === "number" ? `${compactNumber(op.time)}s` : null) });
}

function setAudio({ op, state }: RowInput): RowParts {
  const level = typeof op.levelDb === "number" ? state.translate("plan.row.decibels", { value: compactNumber(op.levelDb) }) : null;
  return { label: state.translate("plan.row.audio"), after: op.enabled === false ? state.translate("plan.row.muted") : level };
}

function options(label: PlainRowKey): RowBuilder {
  return ({ op, state }) => ({ label: state.translate(label), after: describeFields(fieldsOf(op.options), 3, state.translate) });
}

function createComposition({ op, state }: RowInput): RowParts {
  const size = typeof op.width === "number" && typeof op.height === "number" ? `${compactNumber(op.width)}×${compactNumber(op.height)}` : null;
  const length = typeof op.durationSeconds === "number" ? `${compactNumber(op.durationSeconds)}s` : null;
  const rate = typeof op.frameRate === "number" ? state.translate("plan.row.fps", { value: compactNumber(op.frameRate) }) : null;
  return { label: state.translate("plan.row.createComposition"), after: [size, length, rate].filter(Boolean).join(", ") || null };
}

function renameItem({ state, op, ref }: RowInput): RowParts {
  const id = text(ref.itemId);
  return { label: state.translate("plan.row.renameItem"), before: state.snapshot.items?.find((item) => item.id === id)?.name ?? null, after: formatValue(op.name, false, state.translate) };
}

function drawShapes({ op, state }: RowInput): RowParts {
  return { label: state.translate("plan.row.drawShapes", { count: Array.isArray(op.shapes) ? op.shapes.length : 0 }) };
}

function convertedNotes(op: RowInput["op"]): string[] {
  const notes = fieldsOf(op.fallbackNotes);
  return converterTradeOffs({ approximated: [...stringsIn(arrayAt(notes, "approximated"))], skipped: [...stringsIn(arrayAt(notes, "skipped"))] });
}

function converterLabel(op: RowInput["op"], translate: Translate): string {
  const version = text(op.importerAeVersion), unavailable = text(op.fallbackUnavailable);
  const prefix = version ? translate("plan.row.converterNoImporter", { version }) : translate("plan.row.converterForced");
  if (unavailable) return translate("plan.row.vectorTooBig", { prefix, unavailable });
  const tradeOffs = convertedNotes(op).join("; ");
  const head = version ? translate("plan.row.vectorConverterBuilds", { prefix }) : translate("plan.row.vectorPrefix", { prefix });
  return tradeOffs ? translate("plan.row.vectorWithNotes", { head, notes: `${tradeOffs.charAt(0).toUpperCase()}${tradeOffs.slice(1)}` }) : head;
}

function vectorArtworkRow({ op, state }: RowInput): RowParts {
  const after = formatValue(op.name, false, state.translate), unavailable = text(op.fallbackUnavailable);
  if (op.importer === "converter") return { label: converterLabel(op, state.translate), after };
  return { label: unavailable ? state.translate("plan.row.vectorNoFallback", { unavailable }) : state.translate("plan.row.createVectorArtwork"), after };
}

const SAVE_LABELS: Record<string, PlainRowKey> = { save_as: "plan.row.saveProjectAs", increment: "plan.row.incrementSave" };

function pathAfter(label: (op: RowInput["op"]) => PlainRowKey, field: string): RowBuilder {
  return ({ op, state }) => ({ label: state.translate(label(op)), after: typeof op[field] === "string" ? String(op[field]) : null });
}

function fieldsRow(label: PlainRowKey, field: string): RowBuilder {
  return ({ op, state }) => ({ label: state.translate(label), after: describeFields(fieldsOf(op[field]), 3, state.translate) });
}

function valueRow(label: PlainRowKey, field: string): RowBuilder {
  return ({ op, state }) => ({ label: state.translate(label), after: formatValue(op[field], false, state.translate) });
}

export const MISC_ROWS: Readonly<Record<string, RowBuilder>> = {
  create_shape_group: nameOnly("plan.row.addShapeGroup"),
  set_shape_path: shapePath,
  ensure_shape_fill: shapeFill,
  ensure_shape_stroke: shapeStroke,
  draw_vector_shapes: drawShapes,
  add_shape_item: shapeItem("plan.row.addShapeItem"),
  update_shape_item: shapeItem("plan.row.changeShapeItem"),
  add_mask: valueRow("plan.row.addMask", "name"),
  update_mask: maskValues("plan.row.changeMask"),
  remove_mask: fixed("plan.row.deleteMask"),
  add_marker: markerRow("plan.row.addMarker"),
  update_marker: markerRow("plan.row.changeMarker"),
  remove_marker: fixed("plan.row.deleteMarker"),
  set_time_remap: valueRow("plan.row.timeRemapping", "enabled"),
  set_camera_options: options("plan.row.cameraOptions"),
  set_light_options: options("plan.row.lightOptions"),
  set_material_options: options("plan.row.materialOptions"),
  set_audio: setAudio,
  create_composition: createComposition,
  duplicate_composition: ({ op, state }) => ({ label: state.translate("plan.row.duplicateComposition"), after: typeof op.name === "string" ? formatValue(op.name, false, state.translate) : null }),
  set_composition_settings: fieldsRow("plan.row.compositionSettings", "settings"),
  set_composition_guides: ({ op, state }) => ({ label: state.translate("plan.row.compositionGuides"), after: counted(op.guides, "plan.row.guides", state.translate) }),
  create_folder: fixed("plan.row.createFolder"),
  set_item_name: renameItem,
  move_item_to_folder: fixed("plan.row.moveItemToFolder"),
  delete_project_item: fixed("plan.row.deleteProjectItem"),
  import_file: fixed("plan.row.importFile"),
  replace_footage: fixed("plan.row.replaceFootage"),
  set_footage_proxy: fixed("plan.row.setFootageProxy"),
  clear_footage_proxy: fixed("plan.row.clearFootageProxy"),
  set_footage_interpretation: fixed("plan.row.setFootageInterpretation"),
  detect_scene_edits: valueRow("plan.row.detectSceneEdits", "mode"),
  render_composition: ({ op, state }) => ({ label: state.translate(op.mediaEncoder === undefined ? "plan.row.queueRender" : "plan.row.sendToMediaEncoder"), after: describeFields(fieldsOf(op.outputSettings), 3, state.translate) }),
  cleanup_project: ({ op, state }) => ({ label: state.translate("plan.row.projectCleanup"), after: String(op.mode ?? "") }),
  export_mogrt: fixed("plan.row.exportTemplate"),
  export_frame: ({ op, state }) => ({ label: state.translate("plan.row.exportStill"), after: `${String(op.time)}s` }),
  create_vector_artwork: vectorArtworkRow,
  switch_project: pathAfter((op) => (op.mode === "open" ? "plan.row.openProject" : "plan.row.newProject"), "path"),
  collect_project: pathAfter(() => "plan.row.collectFiles", "destinationFolder"),
  save_project: pathAfter((op) => SAVE_LABELS[String(op.mode)] ?? "plan.row.saveProject", "path"),
  set_project_settings: fieldsRow("plan.row.projectSettings", "settings"),
  add_essential_property: nameOnly("plan.row.addEssentialProperty"),
};
