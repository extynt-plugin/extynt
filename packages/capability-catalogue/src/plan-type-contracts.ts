// What each plan type promises about read-back, reruns and cleanup, from live-matrix and receipt evidence.

/** How much of a requested write the receipt compares: exact compares every field, partial lists the rest in `unobserved`, host-readback trusts the host's own read, not-read is not read yet, unobservable cannot be read. */
export type ReadBackLevel = "exact" | "partial" | "host-readback" | "not-read" | "unobservable";

/** What a second run does: set rewrites the same value, ensure reuses the object, creates adds one, rejects-rerun fails before writing, destructive removes the target, external writes outside the project. */
export type RerunBehaviour = "set" | "ensure" | "creates" | "rejects-rerun" | "destructive" | "external";

/** The read-back, rerun and cleanup promise of one plan type; `cleanup` names the plan type that reverts it, null records a gap, and times are composition time unless `timeBase` says otherwise. */
export interface PlanTypeContract {
  readonly readBack: ReadBackLevel;
  readonly unobserved: readonly string[];
  readonly rerun: RerunBehaviour;
  readonly cleanup: string | null;
  readonly timeBase?: "composition" | "layer" | "none";
  readonly notes?: string;
}

interface ContractDetails {
  readonly unobserved?: readonly string[];
  readonly timeBase?: "composition" | "layer" | "none";
  readonly notes?: string;
}

function contract(readBack: ReadBackLevel, rerun: RerunBehaviour, cleanup: string | null, details: ContractDetails = {}): PlanTypeContract {
  return { readBack, unobserved: [], rerun, cleanup, ...details };
}

/** One contract per plan type. set_composition_guides is "creates" because a rerun appends; the contract cannot express the caller's replace:true, so the notice checks the operation. */
export const PLAN_TYPE_CONTRACTS: Readonly<Record<string, PlanTypeContract>> = {
  create_folder: contract("exact", "creates", "delete_project_item"),
  set_item_name: contract("exact", "set", "set_item_name"),
  move_item_to_folder: contract("exact", "set", "move_item_to_folder"),
  delete_project_item: contract("exact", "destructive", null, { notes: "Removal is undoable only through After Effects Undo." }),
  import_file: contract("partial", "creates", "delete_project_item", { unobserved: ["source file path", "import type"] }),
  create_vector_artwork: contract("partial", "external", null, { unobserved: ["individual imported shape properties", "visual SVG fidelity"], notes: "The receipt confirms the sanitized source hash/metadata, managed file, imported composition identity, layer count and which importer built it (After Effects' own, or extynt's converter when the native importer refused; the receipt names the refusal and what the converter left out). Visual fidelity and every converted native shape property still require live AE inspection. Project Undo does not remove the retained managed SVG source." }),
  replace_footage: contract("not-read", "set", "replace_footage", { unobserved: ["footage file path"] }),
  set_footage_proxy: contract("not-read", "set", "clear_footage_proxy", { unobserved: ["proxy source", "useProxy"] }),
  clear_footage_proxy: contract("not-read", "set", "set_footage_proxy", { unobserved: ["useProxy"] }),
  set_footage_interpretation: contract("host-readback", "set", "set_footage_interpretation", { notes: "The host reads every written field back and fails the step on a mismatch; the snapshot's source interpretation shows the result after a refresh." }),
  set_project_settings: contract("host-readback", "set", "set_project_settings"),
  create_composition: contract("partial", "creates", "delete_project_item", { unobserved: ["name", "width", "height", "durationSeconds", "frameRate"] }),
  duplicate_composition: contract("partial", "creates", "delete_project_item", { unobserved: ["name", "copied layers and expressions"] }),
  set_composition_settings: contract("partial", "set", "set_composition_settings", { unobserved: ["backgroundColor"] }),
  set_composition_guides: contract("host-readback", "creates", "set_composition_guides", { unobserved: ["guide positions"], notes: "Replaces every guide when replace:true; otherwise appends, which the host reports only as a resulting guide count." }),
  precompose_layers: contract("exact", "creates", null, { notes: "No un-precompose operation exists; use After Effects Undo." }),
  create_layer: contract("partial", "creates", "remove_layer", { unobserved: ["text content", "color", "box", "size", "sourceItemId"] }),
  duplicate_layer: contract("partial", "creates", "remove_layer", { unobserved: ["copied properties"] }),
  derive_layer: contract("partial", "creates", "remove_layer", { unobserved: ["menu-command results beyond the new layer's type and name", "path-null expression motion"], notes: "A fresh snapshot confirms the new layer exists with the expected type, name and (split) in/out points; menu-command kinds depend on the After Effects build.", timeBase: "composition" }),
  retime_layer: contract("partial", "rejects-rerun", null, { unobserved: ["keyframe values", "stretch"], timeBase: "composition", notes: "Writes time remap keyframes; the receipt compares the keyframe digest the host wrote with a fresh probe." }),
  remove_layer: contract("exact", "destructive", null),
  reorder_layer: contract("exact", "set", "reorder_layer"),
  set_layer_name: contract("exact", "set", "set_layer_name"),
  set_layer_property: contract("exact", "set", "set_layer_property"),
  set_layer_attribute: contract("exact", "set", "set_layer_attribute", { notes: "The requested switch or attribute is compared with a fresh layer snapshot." }),
  set_layer_parent: contract("exact", "set", "set_layer_parent"),
  set_track_matte: contract("exact", "set", "set_track_matte"),
  set_layer_timing: contract("exact", "set", "set_layer_timing", { timeBase: "composition" }),
  set_time_remap: contract("host-readback", "set", "set_time_remap", { notes: "The host reads layer.timeRemapEnabled right after the write; a state other than the one requested fails the step." }),
  detect_scene_edits: contract("partial", "creates", null, { unobserved: ["cut positions"], notes: "The host diffs marker times or layer ids around the call; markers and split layers are in the snapshot after a refresh. Undo is After Effects Undo." }),
  animate_property: contract("partial", "rejects-rerun", null, { unobserved: ["keyframe values", "interpolation", "temporal ease", "spatial tangents"], timeBase: "composition", notes: "Compares the keyframe digest the host wrote against the digest a fresh probe read, so a matching count alone is reported unconfirmed. An enabled expression on the same property is classified from the evaluated value the host sampled at the same keyed times: referenced (the value follows the keyed times - the keys are live inputs, the digest still stands, and expressionMotionUnverified keeps the plan applied_unverified because the expression's own motion is not verified), ignored (the value was constant across differently valued keyed times - property-keyframes-superseded-by-expression reports applied_unverified and says the keyed values do not drive this property), or unknown (fewer than two usable samples, more than three keys, or a constant equal to a key value - property-keyframes-expression-keys-unknown reports applied_unverified and claims nothing about the keys). keyframeMode reject (default) refuses a rerun; merge/replace rewrite. No operation removes keyframes." }),
  animate_control: contract("partial", "rejects-rerun", null, { unobserved: ["keyframe values", "interpolation", "temporal ease"], timeBase: "composition" }),
  set_expression: contract("partial", "set", "set_expression", { unobserved: ["the motion an expression computes, other than a literal wiggle(f, a) or loopOut(\"cycle\")"], notes: "Confirms the enabled state and the stored source, then samples the evaluated value at bounded times: the write is exact, but a value that never changes on a keyed property, or one that could not be sampled, is reported unverified, and an expression that reports an error at a sampled time fails. When the target property is also keyed, those same samples classify the relationship and the step reports expressionKeysReferenced as referenced, ignored, or unknown, with up to three bounded expressionKeyValues: referenced keeps the keyframe digest as evidence but carries expressionMotionUnverified so the plan is applied_unverified, ignored reports property-keyframes-superseded-by-expression, and unknown reports property-keyframes-expression-keys-unknown without claiming either way. A literal wiggle(f, a) is also probed against its pre-expression value (every sample within |a| plus 5%, and moving), and a loopOut() or loopOut(\"cycle\") past its last key against the keyed span (within 0.0005 or 10 ppm); either probe that disagrees fails." }),
  set_loop: contract("partial", "set", "set_expression", { unobserved: ["the motion an expression computes, other than a literal wiggle(f, a) or loopOut(\"cycle\")"], notes: "Compiles to a set_expression host step on the same property, so it shares that contract's evidence: the stored source, the evaluated values sampled at bounded times, the referenced/ignored/unknown keyframe classification, and the wiggle and loopOut(\"cycle\") probes. It is never reported exact for a loop form other than cycle, whose motion is not probed." }),
  set_text_document: contract("partial", "set", "set_text_document", { unobserved: ["box fields on point text", "range-only fields", "fields After Effects does not report on this layer"], notes: "Document fields compare the first character; character ranges use host read-back. A requested field the snapshot does not carry reads back as unverified, never as a mismatch." }),
  ensure_text_animator: contract("host-readback", "ensure", null, { notes: "The snapshot leaf is compared when it is in the snapshot; otherwise the host's own read of the leaf it resolved and wrote, within 0.0001." }),
  add_text_animator: contract("host-readback", "creates", null, { unobserved: ["write values wider than four components", "keys past the first 32"], notes: "Each write is compared with the host's read of the value it set, and each animation with the host's read of every key (time within 0.0005 s, value as written); a read that disagrees fails. Specs the snapshot also carries are compared there too." }),
  update_text_animator: contract("host-readback", "set", null, { unobserved: ["write values wider than four components", "keys past the first 32"], notes: "Same host read of written values and keys as add_text_animator." }),
  add_mask: contract("host-readback", "creates", "remove_mask", { notes: "The host reads back each requested path and setting, and a fresh snapshot confirms the named mask exists. Tiny coordinate rounding is tolerated." }),
  update_mask: contract("host-readback", "set", "update_mask", { notes: "The host reads back each requested path and setting, and a fresh snapshot confirms the mask exists. Tiny coordinate rounding is tolerated." }),
  remove_mask: contract("host-readback", "destructive", null, { notes: "The host counts the layer's masks either side of the removal: exactly one fewer passes, anything else fails." }),
  create_shape_group: contract("host-readback", "creates", null, { notes: "The host re-reads the new group from the layer root: matchName, name, ordinal, empty contents and the default group transform (anchor and position 0, scale 100, rotation 0, opacity 100). Transform fields the host cannot read are skipped." }),
  set_shape_path: contract("host-readback", "set", "set_shape_path", { notes: "Every vertex, both tangent arrays (zero where the request left them out) and closed are compared. Geometry and numbers match within 0.0005 or 10 ppm of the requested value, whichever is larger. A path over 256 vertices is compared by count, weighted digest and its first and last 8 points. The layer's sourceRectAtTime bounds ride along as evidence." }),
  ensure_shape_fill: contract("host-readback", "ensure", null, { notes: "The host reads the fill back: color within 0.00001 per channel, opacity within 0.0005 or 10 ppm." }),
  ensure_shape_stroke: contract("host-readback", "ensure", null, { notes: "The host reads the stroke back: color within 0.00001 per channel, width and opacity within 0.0005 or 10 ppm." }),
  draw_vector_shapes: contract("host-readback", "creates", null, { notes: "Per group: name, path count, point count, closed paths and weighted checksum, then every path vertex by vertex (summarised past 256 vertices or a 4096-point budget), the ordered contents (paths, then stroke above fill), the default group transform with the requested opacity, and the paint. Geometry and numbers match within 0.0005 or 10 ppm of the requested value, whichever is larger. sourceRectAtTime bounds fail the step only when the layer held no other groups and every segment is straight (1 px); otherwise they are evidence." }),
  add_shape_item: contract("host-readback", "creates", null, { unobserved: ["write values wider than four components", "keys past the first 32"], notes: "Each write is compared with the host's read of the value it set, and each animation with the host's read of every key; a read that disagrees fails. Specs the snapshot also carries are compared there too." }),
  update_shape_item: contract("host-readback", "set", null, { unobserved: ["write values wider than four components", "keys past the first 32"], notes: "Same host read of written values and keys as add_shape_item." }),
  read_keyframes: contract("host-readback", "set", null, { notes: "A read: nothing is written. The rows are what After Effects reports; shape and text values are summarised." }),
  edit_keyframes: contract("host-readback", "rejects-rerun", null, { unobserved: ["interpolation, ease and tangent restoration on re-added keys"], timeBase: "composition", notes: "The host reads the key count and key times back after the edit and fails the step on a mismatch; each key is rewritten with its interpolation, ease and spatial tangents on a best-effort basis." }),
  dolly_camera: contract("host-readback", "rejects-rerun", null, { timeBase: "composition", notes: "The host reads every Position key back and the receipt checks each key's distance to the Point of Interest and that it stays on the camera's original axis (basis camera-dolly-axis)." }),
  set_camera_options: contract("exact", "set", "set_camera_options"),
  set_light_options: contract("exact", "set", "set_light_options"),
  set_material_options: contract("exact", "set", "set_material_options"),
  set_audio: contract("exact", "set", "set_audio"),
  tracker_to_nulls: contract("host-readback", "creates", null, { unobserved: ["where the nulls sit on screen"], notes: "Each null's follow expression is evaluated without error; the track data itself is the user's analysis." }),
  save_layer_preset: contract("host-readback", "external", null, { unobserved: ["what the preset contains"], notes: "Passes only when the .ffx exists with more than zero bytes; applying it back reproduces the effects (measured on 26.5)." }),
  switch_project: contract("host-readback", "external", null, { unobserved: ["the opened project's contents"], notes: "app.project.file is read back (the opened path, or untitled for a new project); what the old project held is gone unless it was saved." }),
  collect_project: contract("host-readback", "external", null, { unobserved: ["image sequences, proxies, fonts, plug-ins"], notes: "Passes only when the collected .aep exists with more than zero bytes; each copy is compared by size and the relink is read back." }),
  resize_solid: contract("host-readback", "set", null, { notes: "Width, height and pixel aspect are read back; other layers that share the solid change with it and are counted in the receipt." }),
  set_text_path: contract("host-readback", "set", null, { notes: "Each written Path Options value is read back; the booleans (reverse, perpendicular, force alignment) are not offered because their menu order is not confirmed." }),
  open_composition: contract("host-readback", "set", null, { notes: "app.project.activeItem is read back after the open (activeCompositionId) and the receipt compares it to the target composition: a different active composition fails, a host that does not report it is applied-unverified." }),
  start_analysis: contract("partial", "creates", null, { unobserved: ["whether the analysis finished"], notes: "The effect's existence is read back; whether analysis is still running comes from its property names and is not proof of completion. Unverified until run in After Effects." }),
  replace_layer_source: contract("host-readback", "set", null, { notes: "layer.source.id is read back and must name the new item; expressions that referenced the old source are not rewritten (fixExpressions is false)." }),
  center_anchor: contract("host-readback", "set", null, { notes: "Anchor Point and Position are read back after the write; the on-screen invariance rests on the host's scale-and-rotation maths, not on a rendered frame." }),
  copy_effects: contract("partial", "creates", null, { unobserved: ["every property value"], notes: "The host reports the effects it copied and the properties it skipped; individual property values are not compared." }),
  set_puppet_pins: contract("host-readback", "rejects-rerun", null, { unobserved: ["pin influence and mesh deformation"], notes: "Each pin's position is read back at its rest and every key time after placement; the rendered deformation is checked live, not on every run." }),
  remove_effect: contract("host-readback", "destructive", null, { notes: "The host reads the effect stack back one shorter; there is no inverse operation, use After Effects Undo or ensure_effect to add it again." }),
  reorder_effect: contract("host-readback", "set", "reorder_effect", { notes: "The host reads the effect's place in the stack back after moveTo." }),
  ensure_effect: contract("host-readback", "ensure", null, { notes: "Existence of the exact matchName path is compared with the snapshot; the enabled state from the snapshot row, else from the host's read of the effect right after the write. No remove_effect operation exists." }),
  set_effect_control: contract("exact", "set", "set_effect_control"),
  apply_preset: contract("partial", "creates", null, { unobserved: ["animators", "keyframes", "expressions added by the preset"], notes: "Each run applies the preset again." }),
  ensure_layer_style: contract("host-readback", "ensure", "ensure_layer_style", { unobserved: ["values wider than four components when the snapshot lacks the style"], notes: "The enabled state and each value from the snapshot, else from the host's read right after the write. Cleanup can only turn a style off, never remove it." }),
  add_marker: contract("exact", "rejects-rerun", "remove_marker", { timeBase: "composition", notes: "The planner refuses a second marker at an occupied time. At the host a replayed identical marker is a no-op (alreadyPresent, nothing applied) and a different marker at that time fails with MARKER_EXISTS." }),
  update_marker: contract("exact", "set", "update_marker", { timeBase: "composition" }),
  remove_marker: contract("exact", "destructive", null, { timeBase: "composition" }),
  render_composition: contract("host-readback", "external", null, { unobserved: ["rendered frames (only the file's existence and size are read)", "Media Encoder job"], notes: "Submission is not success: an executed render passes only when the output file exists and holds more than zero bytes; an empty file fails. Typed output and render settings are read back per field." }),
  cleanup_project: contract("partial", "destructive", null, { unobserved: ["which surviving item a consolidated duplicate was merged into"], notes: "Removed items are diffed before and after and listed in the receipt; undo is After Effects Undo only." }),
  add_essential_property: contract("host-readback", "creates", null, { unobserved: ["membership on After Effects builds without the controller getters"], notes: "Where comp.getMotionGraphicsTemplateControllerName exists, the host reads the controller count either side of the add (exactly one more passes) and the requested name must be listed. Builds without the getters keep the add unverified." }),
  save_project: contract("host-readback", "external", null, { unobserved: ["the saved file's contents"], notes: "Passes only when the saved file exists with more than zero bytes and app.project.file names it." }),
  export_frame: contract("host-readback", "external", null, { unobserved: ["the picture in the file"], notes: "Passes only when the .png exists and holds more than zero bytes after the host waited for it to settle; the picture itself is not read back." }),
  export_mogrt: contract("host-readback", "external", null, { unobserved: ["the template's contents"], notes: "Passes only when the .mogrt file exists and holds more than zero bytes; an empty file fails." }),
};
