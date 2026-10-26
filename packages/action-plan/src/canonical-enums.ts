// The closed string enums a plan accepts, and the one spelling rule that lets the composer fix a near-miss
// without a round trip: a value that names exactly one member under case, separators or a dropped suffix is that member.
import { TEXT_DOCUMENT_FIELDS, type TextFieldSpec } from "@extynt/project-graph";
import { CLEANUP_MODES } from "./project-operation-decoders.js";
import { SCENE_EDIT_MODES } from "./plan-constants.js";
import { SHAPE_ITEMS } from "./extended.js";
import { DERIVE_LAYER_KINDS, RETIME_MODES } from "./layer-edit-decoders.js";
import { LAYER_STYLES } from "./plan-constants.js";

const TEXT_FIELD_SPECS: Readonly<Record<string, TextFieldSpec>> = TEXT_DOCUMENT_FIELDS;

export const PLACEMENTS: readonly string[] = ["beginning", "end", "before", "after"];
export const TRACK_MATTE_MODES: readonly string[] = ["alpha", "alpha-inverted", "luma", "luma-inverted"];
export const LOOP_MODES: readonly string[] = ["cycle", "pingpong", "offset", "continue"];
export const IMPORT_AS_VALUES: readonly string[] = ["auto", "footage", "composition", "composition-cropped-layers", "project"];

/** Top-level enum fields per operation type, with the members each accepts. */
export const OPERATION_ENUM_FIELDS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  reorder_layer: { placement: PLACEMENTS },
  set_track_matte: { mode: TRACK_MATTE_MODES },
  set_loop: { mode: LOOP_MODES },
  detect_scene_edits: { mode: SCENE_EDIT_MODES },
  cleanup_project: { mode: CLEANUP_MODES },
  import_file: { importAs: IMPORT_AS_VALUES },
  add_shape_item: { item: Object.keys(SHAPE_ITEMS) },
  update_shape_item: { item: Object.keys(SHAPE_ITEMS) },
  ensure_layer_style: { style: Object.keys(LAYER_STYLES) },
  derive_layer: { kind: DERIVE_LAYER_KINDS },
  retime_layer: { mode: RETIME_MODES },
};

function folded(text: string): string {
  return text.trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s_-]+/g, "_").toUpperCase();
}

function canonicalEnumMember(value: string, allowed: readonly string[]): string | undefined {
  if (!value.trim() || allowed.includes(value)) return undefined;
  const key = folded(value);
  const exact = allowed.filter((member) => folded(member) === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const leading = allowed.filter((member) => folded(member).startsWith(`${key}_`));
  return leading.length === 1 ? leading[0] : undefined;
}

/** `canonicalEnumMember` for a value of unchecked type: anything that is not a string names no member. */
export function canonicalEnumValue<T>(value: T, allowed: readonly string[]): string | undefined {
  return typeof value === "string" ? canonicalEnumMember(value, allowed) : undefined;
}

/** The members of one text-document enum field, or undefined when the field is not an enum. */
export function textEnumMembers(field: string): readonly string[] | undefined {
  const spec = TEXT_FIELD_SPECS[field];
  return spec?.kind === "enum" ? spec.values : undefined;
}
