// How each operation of an apply receipt came out, and the host evidence that lets a read-back stand in for an exact comparison.
import { numberAt, stringAt } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";

export type OperationOutcome =
  | "confirmed"
  | "host_confirmed"
  | "coerced_equivalent"
  | "applied_unconfirmed"
  | "readback_mismatch"
  | "rejected_before_apply"
  | "failed_during_apply"
  | "applied_before_failure"
  | "not_attempted";

export interface OperationOutcomeRow {
  index: number;
  type: string;
  outcome: OperationOutcome;
  targets: {
    compositionId?: string;
    layerId?: string;
    itemId?: string;
    propertyPath?: string;
    effectPath?: string;
  };
  mutated: boolean | "unknown";
  basis?: string;
  unobserved?: readonly string[];
  error?: { code: string; message: string };
  readBack?: JsonObject;
}

export interface OperationOutcomeSummary {
  rows: OperationOutcomeRow[];
  counts: Record<OperationOutcome, number>;
  partialMutation: boolean;
  laterOperationsAttempted: boolean;
}

export const VERIFIED_OUTCOMES = [
  "confirmed",
  "host_confirmed",
  "coerced_equivalent",
] as const;

export function isVerifiedOutcome(outcome: JsonValue | undefined): outcome is (typeof VERIFIED_OUTCOMES)[number] {
  return VERIFIED_OUTCOMES.some((verified) => verified === outcome);
}

interface HostEvidenceRule {
  readonly type: string;
  readonly field: "hostVerification" | "submission" | "basis";
  readonly evidence: string;
  readonly strength: "strong" | "weak";
  readonly proves: string;
  readonly source: string;
  readonly fileWritten?: true;
}

export const HOST_EVIDENCE_RULES: readonly HostEvidenceRule[] = [
  {
    type: "set_project_settings",
    field: "hostVerification",
    evidence: "project-settings-read-back",
    strength: "strong",
    proves: "setProjectSettings writes each named setting, reads it straight back, and throws PROJECT_SETTINGS_UNSUPPORTED unless the observed value equals the request; the label can only be emitted after that equality held in the host.",
    source: "apps/panel/host/probe.jsx:1701-1710,1966",
  },
  {
    type: "set_project_settings",
    field: "basis",
    evidence: "project-settings-host-read-back",
    strength: "strong",
    proves: "the panel's name for the rule above, and today the only part of that evidence that survives into the receipt: unverified() overwrites the observed object with false before the step is posted, so the compared values never travel. No other reading of this operation reaches the sidecar.",
    source: "apps/sidecar/src/verify/verify-ops.ts",
  },
  {
    type: "render_composition",
    field: "submission",
    evidence: "render-file-written",
    strength: "strong",
    proves: "renderComposition reaches status \"rendered\" only after checking the output module's file exists and is not empty, and throws RENDER_EXECUTION_FAILED otherwise; the panel carries that host label in submission rather than hostVerification.",
    source: "apps/panel/host/probe.jsx:1855-1858,1971",
    fileWritten: true,
  },
  {
    type: "export_frame",
    field: "hostVerification",
    evidence: "frame-file-written",
    strength: "weak",
    proves: "aeApplyExportFrame waits until the PNG exists with a non-zero size that has stopped growing, and throws FRAME_EXPORT_FAILED otherwise; the label is only emitted after that check.",
    source: "apps/panel/host/apply-project.jsx",
    fileWritten: true,
  },
  {
    type: "save_layer_preset",
    field: "hostVerification",
    evidence: "preset-file-saved",
    strength: "weak",
    proves: "Layer.savePreset returned and the .ffx exists with a non-zero size; its contents are not re-read.",
    source: "apps/panel/host/apply-misc.jsx",
    fileWritten: true,
  },
  {
    type: "switch_project",
    field: "hostVerification",
    evidence: "project-opened",
    strength: "weak",
    proves: "app.project.file named the opened path after app.open.",
    source: "apps/panel/host/apply-misc.jsx",
  },
  {
    type: "switch_project",
    field: "hostVerification",
    evidence: "project-created",
    strength: "weak",
    proves: "the new project is untitled after app.newProject.",
    source: "apps/panel/host/apply-misc.jsx",
  },
  {
    type: "collect_project",
    field: "hostVerification",
    evidence: "project-file-saved",
    strength: "weak",
    proves: "the collected .aep exists with a non-zero size and app.project.file names it; each footage copy was compared by size before relinking.",
    source: "apps/panel/host/apply-misc.jsx",
    fileWritten: true,
  },
  {
    type: "save_project",
    field: "hostVerification",
    evidence: "project-file-saved",
    strength: "weak",
    proves: "the saved .aep exists with a non-zero size and app.project.file now names it; its contents are not re-read.",
    source: "apps/panel/host/apply-project.jsx",
    fileWritten: true,
  },
  {
    type: "export_mogrt",
    field: "hostVerification",
    evidence: "mogrt-file-written",
    strength: "strong",
    proves: "exportMogrt calls mogrtFileWritten(), which requires a file that exists with a non-zero length, and throws MOGRT_EXPORT_FAILED when nothing was written; the label is only emitted after that check.",
    source: "apps/panel/host/probe.jsx:1676-1692,1968",
    fileWritten: true,
  },
  {
    type: "create_vector_artwork",
    field: "hostVerification",
    evidence: "managed-svg-written-and-native-shape-composition-imported",
    strength: "weak",
    proves: "the managed UTF-8 SVG file was written and After Effects returned a composition containing at least one native shape layer; visual fidelity and gradient appearance still require live frame inspection.",
    source: "apps/panel/host/probe.jsx:1911-1954,2048",
    fileWritten: true,
  },
  {
    type: "create_vector_artwork",
    field: "hostVerification",
    evidence: "managed-svg-written-and-converted-shape-layers-built",
    strength: "weak",
    proves: "After Effects' native SVG importer refused the managed file, or was never asked because the host version has no SVG importer, so the host built the composition itself from shapes extynt converted from the same SVG: one shape layer per top-level element. The step names the importer, the reason (the importer's failure code, or the host version) and the features the converter approximated or left out; visual fidelity still requires live frame inspection.",
    source: "apps/panel/host/apply-svg-fallback.jsx",
    fileWritten: true,
  },
  { type: "create_shape_group", field: "hostVerification", evidence: "shape-group-read-back", strength: "weak",
    proves: "the host emitted bounded group readback; the panel must still compare its match name, name, and ordinal to promote the operation.", source: "apps/panel/host/probe.jsx:2083" },
  { type: "set_shape_path", field: "hostVerification", evidence: "shape-path-read-back", strength: "weak",
    proves: "the host emitted bounded native path readback; the panel must still compare every vertex, tangent, and closed flag to promote the operation.", source: "apps/panel/host/probe.jsx:2084" },
  { type: "ensure_shape_fill", field: "hostVerification", evidence: "shape-fill-read-back", strength: "weak",
    proves: "the host emitted bounded fill readback; the panel must still compare match name, colour, and opacity to promote the operation.", source: "apps/panel/host/probe.jsx:2085" },
  { type: "ensure_shape_stroke", field: "hostVerification", evidence: "shape-stroke-read-back", strength: "weak",
    proves: "the host emitted bounded stroke readback; the panel must still compare match name, colour, width, and opacity to promote the operation.", source: "apps/panel/host/probe.jsx:2086" },
  { type: "draw_vector_shapes", field: "hostVerification", evidence: "vector-shapes-read-back", strength: "weak",
    proves: "the host emitted bounded per-group readback (name, path and point counts, a geometry checksum, fill, stroke, opacity); the panel must still compare every group with the request to promote the operation.", source: "apps/panel/host/probe.jsx:2191" },
  { type: "set_track_matte", field: "hostVerification", evidence: "track-matte-set", strength: "weak",
    proves: "the label is chosen from the request (`matteLayerId !== null`), not from the layer: it is an echo of what was asked for.", source: "apps/panel/host/probe.jsx:1986" },
  { type: "set_track_matte", field: "hostVerification", evidence: "track-matte-cleared", strength: "weak",
    proves: "same echo of the request (`matteLayerId === null`), not a read-back.", source: "apps/panel/host/probe.jsx:1986" },
  { type: "set_composition_settings", field: "hostVerification", evidence: "composition-settings-written", strength: "weak",
    proves: "setCompositionSettings never reads a field back; this label adds nothing to what the panel's snapshot comparison already did.", source: "apps/panel/host/probe.jsx:846-859,1970" },
  { type: "set_composition_guides", field: "hostVerification", evidence: "guides-written", strength: "weak",
    proves: "the host reads comp.guides.length back, but a count is not the requested positions, and without replace the count includes guides that were already there. A narrow replace + count-equality rule is a measured candidate, deliberately not promoted here.", source: "apps/panel/host/probe.jsx:1695-1700,1969" },
  { type: "replace_footage", field: "hostVerification", evidence: "footage-replaced", strength: "weak",
    proves: "the replacement call returned; the footage item is not re-read.", source: "apps/panel/host/probe.jsx:1974" },
  { type: "set_footage_proxy", field: "hostVerification", evidence: "footage-proxy-set", strength: "weak",
    proves: "the proxy call returned; the proxy is not re-read.", source: "apps/panel/host/probe.jsx:1974" },
  { type: "set_footage_interpretation", field: "hostVerification", evidence: "footage-interpretation-read-back", strength: "weak",
    proves: "the host read each written interpretation field back from FootageItem.mainSource and failed on a mismatch; the label itself is a constant.", source: "apps/panel/host/apply-footage.jsx" },
  { type: "detect_scene_edits", field: "hostVerification", evidence: "scene-edits-diffed", strength: "weak",
    proves: "the host diffed layer marker times or comp layer ids around doSceneEditDetection; the cut list is the host's own diff, not a snapshot read.", source: "apps/panel/host/apply-footage.jsx" },
  { type: "clear_footage_proxy", field: "hostVerification", evidence: "footage-proxy-cleared", strength: "weak",
    proves: "the clear call returned; the proxy state is not re-read.", source: "apps/panel/host/probe.jsx:1974" },
  { type: "add_mask", field: "hostVerification", evidence: "mask-created", strength: "weak",
    proves: "a mask was added; its values are not read back.", source: "apps/panel/host/probe.jsx:1987" },
  { type: "update_mask", field: "hostVerification", evidence: "mask-values-written", strength: "weak",
    proves: "the mask value setter returned; no mask field is read back.", source: "apps/panel/host/probe.jsx:1988" },
  { type: "remove_mask", field: "hostVerification", evidence: "mask-absent", strength: "weak",
    proves: "the removal call returned. The label alone proves no more: the step's maskCountBefore/maskCountAfter are the host's count of the parade either side, which the sidecar compares (exactly one fewer) for its own exact or failed verdict.", source: "apps/panel/host/apply-steps-layers.jsx" },
  { type: "set_camera_options", field: "hostVerification", evidence: "camera-options-written", strength: "weak",
    proves: "the option setters returned; no option is read back.", source: "apps/panel/host/probe.jsx:1994" },
  { type: "set_light_options", field: "hostVerification", evidence: "light-options-written", strength: "weak",
    proves: "the option setters returned; no option is read back.", source: "apps/panel/host/probe.jsx:1995" },
  { type: "set_material_options", field: "hostVerification", evidence: "material-options-written", strength: "weak",
    proves: "the option setters returned; no option is read back.", source: "apps/panel/host/probe.jsx:1996" },
  { type: "set_time_remap", field: "hostVerification", evidence: "time-remap-state-written", strength: "weak",
    proves: "the setter returned. The step's `enabled` is copied from the request and is no read-back; its `observedEnabled` is layer.timeRemapEnabled read right after the write, which the sidecar compares for its own exact or failed verdict.", source: "apps/panel/host/apply-steps-layers.jsx" },
  { type: "read_keyframes", field: "hostVerification", evidence: "keyframes-read", strength: "weak",
    proves: "the host read each key back from the property; the rows are After Effects' own report, nothing was written.", source: "apps/panel/host/apply-key-edit.jsx" },
  { type: "edit_keyframes", field: "hostVerification", evidence: "keyframe-edit-read-back", strength: "strong",
    proves: "every key time was read back after the edit and equals the expected list (merge: each new time is present); the host throws otherwise.", source: "apps/panel/host/apply-key-edit.jsx" },
  { type: "tracker_to_nulls", field: "hostVerification", evidence: "tracker-nulls-created", strength: "weak",
    proves: "each null was created and its follow expression evaluated without an error; the track data itself is the user's analysis.", source: "apps/panel/host/apply-misc.jsx" },
  { type: "resize_solid", field: "hostVerification", evidence: "solid-resized", strength: "strong",
    proves: "the solid item's width, height and pixel aspect were read back after the write and equal the request; the host throws otherwise.", source: "apps/panel/host/apply-misc.jsx" },
  { type: "set_text_path", field: "hostVerification", evidence: "text-path-written", strength: "weak",
    proves: "each Path Options value was read back after the write.", source: "apps/panel/host/apply-misc.jsx" },
  { type: "open_composition", field: "hostVerification", evidence: "viewer-opened", strength: "weak",
    proves: "app.project.activeItem named the composition after openInViewer; the host reports that id (activeCompositionId) and the receipt compares it to the target, failing on a mismatch.", source: "apps/panel/host/apply-misc.jsx" },
  { type: "start_analysis", field: "hostVerification", evidence: "analysis-effect-added", strength: "weak",
    proves: "the analysing effect was added and is present on the layer; whether its analysis finished is not proven.", source: "apps/panel/host/apply-misc.jsx" },
  { type: "start_analysis", field: "hostVerification", evidence: "analysis-status-read", strength: "weak",
    proves: "the effect was already on the layer; its analysing flag comes from its own property names.", source: "apps/panel/host/apply-misc.jsx" },
  { type: "replace_layer_source", field: "hostVerification", evidence: "layer-source-replaced", strength: "weak",
    proves: "layer.source.id was read back after replaceSource and named the new item.", source: "apps/panel/host/apply-layer-more.jsx" },
  { type: "center_anchor", field: "hostVerification", evidence: "anchor-centred", strength: "strong",
    proves: "Anchor Point and Position were read back after the write and equal the centred values; the host throws otherwise. The picture was not compared.", source: "apps/panel/host/apply-layer-more.jsx" },
  { type: "copy_effects", field: "hostVerification", evidence: "effects-copied", strength: "weak",
    proves: "the host added each effect and copied its properties, and reports what it copied and skipped; values are not compared back.", source: "apps/panel/host/apply-layer-more.jsx" },
  { type: "set_composition_settings", field: "hostVerification", evidence: "composition-settings-read-back", strength: "strong",
    proves: "every requested setting was read back from the composition after the write and equals it (numbers within 0.01, colours and resolution factor per component); the label is only emitted when none differed.", source: "apps/panel/host/apply-layers.jsx" },
  { type: "set_layer_attribute", field: "hostVerification", evidence: "layer-attribute-read-back", strength: "strong",
    proves: "the layer's attribute or switch was read straight back after the write and holds the written value; the label is only emitted when it does.", source: "apps/panel/host/apply-steps-layers.jsx" },
  { type: "set_layer_attribute", field: "hostVerification", evidence: "layer-attribute-written", strength: "weak",
    proves: "the write returned but the read straight back did not hold the written value (readBackMatches is false), so it is not evidence of the change.", source: "apps/panel/host/apply-steps-layers.jsx" },
  { type: "set_puppet_pins", field: "hostVerification", evidence: "puppet-pins-placed", strength: "strong",
    proves: "each pin's position was read back at its rest and every key time and equals the request, the host throws otherwise. Where the pin sits in the rendered layer is not read.", source: "apps/panel/host/apply-puppet.jsx" },
  { type: "remove_effect", field: "hostVerification", evidence: "effect-removed", strength: "strong",
    proves: "the effect stack was read back and equals the stack before with that one effect left out (names in order); the host throws otherwise.", source: "apps/panel/host/apply-effect-edit.jsx" },
  { type: "reorder_effect", field: "hostVerification", evidence: "effect-reordered", strength: "strong",
    proves: "the effect's match name and name were read back at the requested place in the stack after moveTo; the host throws otherwise.", source: "apps/panel/host/apply-effect-edit.jsx" },
  { type: "dolly_camera", field: "hostVerification", evidence: "camera-dolly-axis", strength: "weak",
    proves: "every Position key was read back from the camera: its distance to the Point of Interest matches the requested distance and it sits on the camera's original viewing axis.", source: "apps/panel/host/apply-camera.jsx" },
  { type: "retime_layer", field: "hostVerification", evidence: "time-remap-keys", strength: "weak",
    proves: "the two seeded remap keys were rewritten; the sidecar's snapshot check separately confirms the keys exist, not their values.", source: "apps/panel/host/apply-derive.jsx" },
  { type: "set_text_document", field: "hostVerification", evidence: "source-text-written", strength: "weak",
    proves: "the document writer returned; the panel compares what the snapshot exposes separately.", source: "apps/panel/host/probe.jsx:2005" },
  { type: "add_marker", field: "hostVerification", evidence: "marker-present", strength: "weak",
    proves: "the marker writer returned; the marker is not re-read.", source: "apps/panel/host/probe.jsx:2007" },
  { type: "update_marker", field: "hostVerification", evidence: "marker-present", strength: "weak",
    proves: "the marker writer returned; the marker is not re-read.", source: "apps/panel/host/probe.jsx:2007" },
  { type: "remove_marker", field: "hostVerification", evidence: "marker-absent", strength: "weak",
    proves: "the removal call returned; absence is asserted by the panel's snapshot separately.", source: "apps/panel/host/probe.jsx:2008" },
  { type: "add_essential_property", field: "hostVerification", evidence: "essential-property-added", strength: "weak",
    proves: "the add call returned. Where the host has the controller getters, the step's `essential` carries the controller count either side and the names, which the sidecar compares (one more, requested name listed); the property's value is not read back.", source: "apps/panel/host/apply-project.jsx" },
  { type: "set_expression", field: "hostVerification", evidence: "expression-enabled", strength: "weak",
    proves: "asserts the property's expressionEnabled flag, which is a different claim from \"the expression animates\".", source: "apps/panel/host/probe.jsx:2006" },
  { type: "set_expression", field: "hostVerification", evidence: "expression-cleared", strength: "weak",
    proves: "asserts the flag was cleared, not that the animation it produced is gone.", source: "apps/panel/host/probe.jsx:2006" },
  { type: "remove_layer", field: "hostVerification", evidence: "layer-absent", strength: "weak",
    proves: "the removal call returned; absence is asserted by the panel's snapshot separately.", source: "apps/panel/host/probe.jsx:1984" },
  { type: "render_composition", field: "submission", evidence: "render-queued", strength: "weak",
    proves: "queued means the render was accepted into the queue; nothing has been written yet.", source: "apps/panel/host/probe.jsx:1860-1862,1971" },
  { type: "render_composition", field: "submission", evidence: "render-sent-to-media-encoder", strength: "weak",
    proves: "queueInAME returned without throwing; the encode runs in Media Encoder, so no file exists yet and none is read back.", source: "apps/panel/host/apply-output.jsx" },
  { type: "cleanup_project", field: "hostVerification", evidence: "project-cleanup-diffed", strength: "weak",
    proves: "the project's items were listed before and after the cleanup call and the receipt lists every item that disappeared; which survivor a merged duplicate went to is not observable.", source: "apps/panel/host/apply-output.jsx" },
];

const TEXT_ANIMATOR_TOLERANCE = 0.0001;

interface HostEvidence { readonly strength: "strong" | "weak"; readonly evidence: string; readonly proves: string }

function barrenBytes(step: JsonObject): boolean {
  const bytes = step.bytes;
  if (bytes === undefined) return false;
  return typeof bytes !== "number" || bytes <= 0;
}

function textAnimatorEvidence(operation: JsonObject, step: JsonObject): HostEvidence | undefined {
  const requested = numberAt(operation, "value"), observed = numberAt(step, "observedValue");
  if (requested === undefined || observed === undefined) return undefined;
  const equivalence = Math.abs(observed - requested) < TEXT_ANIMATOR_TOLERANCE;
  if (equivalence) {
    return {
      strength: "strong",
      evidence: `observedValue=${observed}`,
      proves: "the host re-found the animator's leaf on the layer after the write and its value is within 0.0001 of the request; the sidecar re-does that comparison from the value the step carries.",
    };
  }
  return {
    strength: "weak",
    evidence: `observedValue=${observed}`,
    proves: "the host's re-found value differs from the request, so it is not evidence of equivalence. It is left a warning rather than turned into a mismatch: only the panel's own `failed` is a positive contradiction this ladder acts on.",
  };
}

/** `undefined` means the step brought nothing to promote; the text-animator step carries the value the host re-found, not a label. */
export function hostEvidenceOf(operation: JsonObject, step: JsonObject | undefined): HostEvidence | undefined {
  if (!step) return undefined;
  const type = stringAt(operation, "type") ?? "";
  if (type === "ensure_text_animator") return textAnimatorEvidence(operation, step);
  const ruled = ruleEvidenceFor(type, step);
  if (ruled) return ruled;
  const label = stringAt(step, "hostVerification") ?? stringAt(step, "submission");
  return label ? { strength: "weak", evidence: label, proves: "no rule in HOST_EVIDENCE_RULES covers this label, so it proves only that the writer returned." } : undefined;
}

function ruleEvidenceFor(type: string, step: JsonObject): HostEvidence | undefined {
  for (const rule of HOST_EVIDENCE_RULES) {
    if (rule.type !== type || stringAt(step, rule.field) !== rule.evidence) continue;
    const withheld = rule.strength === "strong" && rule.fileWritten === true && barrenBytes(step);
    if (withheld) return { strength: "weak", evidence: rule.evidence, proves: `${rule.proves} But the step's bytes value is present and is not a positive number, so the promotion is withheld.` };
    return { strength: rule.strength, evidence: rule.evidence, proves: rule.proves };
  }
  return undefined;
}

export const COERCION_BASES: ReadonlyMap<string, string> = new Map([
  ["property-value-coerced", "set_layer_property"],
  ["property-value-broadcast", "set_layer_property"],
  ["property-value-under-expression", "set_layer_property"],
]);

export function coercedEquivalentOf(type: string, step: JsonObject | undefined): boolean {
  const basis = stringAt(step, "basis");
  return basis !== undefined && COERCION_BASES.get(basis) === type;
}
