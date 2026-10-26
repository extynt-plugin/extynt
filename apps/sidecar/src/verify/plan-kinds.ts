// Which operation kinds each verifier family judges, and the one test that tells a composition marker from a layer marker.
import type { Request } from "./plan-request.js";

const MARKER_KINDS: ReadonlySet<string> = new Set(["add_marker", "update_marker", "remove_marker"]);

/** The operation kinds that write a structure of properties under a layer. */
export const STRUCTURED_KINDS: ReadonlySet<string> = new Set(["add_text_animator", "update_text_animator", "add_shape_item", "update_shape_item"]);

/** The operation kinds verified against a composition of the fresh read. */
export const COMPOSITION_KINDS: ReadonlySet<string> = new Set([
  "create_composition",
  "duplicate_composition",
  "set_composition_settings",
  "render_composition",
  "precompose_layers",
  "set_composition_guides",
  "export_mogrt",
  "export_frame",
  "open_composition",
]);

/** The operation kinds verified against a project item of the fresh read. */
export const ITEM_KINDS: ReadonlySet<string> = new Set([
  "switch_project",
  "save_project",
  "collect_project",
  "create_folder",
  "import_file",
  "create_vector_artwork",
  "set_item_name",
  "move_item_to_folder",
  "delete_project_item",
  "cleanup_project",
  "replace_footage",
  "set_footage_proxy",
  "clear_footage_proxy",
  "set_footage_interpretation",
]);

/** A marker operation that names no layer addresses the composition's own marker stream. */
export function isCompositionMarker(request: Request): boolean {
  return request.layerId === undefined && MARKER_KINDS.has(request.operation);
}
