/** The full ordered list of host verification cases. */
import { EFFECT_CASES, EXPRESSION_CASES, KEYFRAME_CASES } from "./animation-effects.js";
import { COVERAGE_CASES, SWITCH_LAST_CASES } from "./coverage.js";
import { LAYER_CASES } from "./layers.js";
import { ENVELOPE_CASES, MARKER_CASES, MASK_CASES, PROJECT_CASES, THREE_D_AUDIO_CASES } from "./misc.js";
import { SHAPE_CASES, TEXT_CASES } from "./shapes-text.js";
import { effectSweepCases } from "./sweep.js";
import { LIVE_PRESET_ID } from "../plan.js";
import { C, L, OUT, P, applied, fixture, layer, plannedHostRejects, type CaseWithMeta } from "./helpers.js";

export { EFFECT_SWEEP_PREFIX, controlTreeDrift, expectedControls } from "./sweep.js";
export type { CaseWithMeta } from "./helpers.js";

const ATOMICITY_CASES: CaseWithMeta[] = [
  { ...plannedHostRejects({ id: "atomicity.partial-failure", covers: ["set_layer_name", "set_expression"], title: "A later failing operation rolls the earlier write back and the receipt says rolled-back", fixture: fixture(layer("top", "solid", { name: "Before" })), operations: [{ type: "set_layer_name", target: L("top"), name: "After" }, { type: "set_expression", target: L("top", { propertyPath: P.opacity }), source: "thisComp.layer(\"Nope\").transform.opacity", enabled: true }], code: "EXPRESSION_INVALID", options: { mayMutate: true } }), expect: [{ kind: "layer", layer: "top", field: "name", equals: "Before" }, { kind: "host", step: 0, field: "mutationState", equals: "rolled-back" }, { kind: "host", step: 0, field: "completedOperations", equals: [] }] },
  { ...plannedHostRejects({ id: "atomicity.partial-applied-fallback", covers: ["set_layer_name", "export_frame", "set_expression"], title: "When an external file was already written, rollback is unprovable and the receipt says partial-applied", fixture: fixture(layer("top", "solid", { name: "Before" })), operations: [{ type: "set_layer_name", target: L("top"), name: "After" }, { type: "export_frame", target: C(), time: 0, outputPath: `${OUT}/atomicity-frame.png`, overwrite: true, exportAuthorization: "EXPORT_NOW" }, { type: "set_expression", target: L("top", { propertyPath: P.opacity }), source: "thisComp.layer(\"Nope\").transform.opacity", enabled: true }], code: "EXPRESSION_INVALID", options: { mayMutate: true, notes: "The exported PNG cannot be un-written, so the host keeps the project write and reports partial-applied with both completed operations." } }), external: true, files: [`${OUT}/atomicity-frame.png`], expect: [{ kind: "layer", layer: "top", field: "name", equals: "After" }, { kind: "host", step: 0, field: "mutationState", equals: "partial-applied" }, { kind: "host", step: 0, field: "completedOperations", equals: ["set_layer_name", "export_frame"] }] },
];

const PRESET_CASES: CaseWithMeta[] = [
  { ...applied({ id: "presets.apply", covers: ["apply_preset"], title: "Apply an installed Animation Preset and report what it added", fixture: fixture(layer("title", "text", { text: "Preset target" })), operations: [{ type: "apply_preset", target: L("title"), presetId: LIVE_PRESET_ID }], expect: [{ kind: "custom", describe: "the preset added at least one effect, animator, keyframe, or expression", check: (view) => Object.keys(view.sections.props).some((key) => key.startsWith(`${view.layerId("title")}|ADBE Effect Parade/`) || key.includes("ADBE Text Animator")) ? undefined : "no observable change on the layer" }], options: { rerunExpect: "host-ok", notes: "Live AE 26.2.1: re-applying the same text preset did not stack its animators. The runner picks the first .ffx under Presets/Text; the report records which one." } }), commandPatches: [{ step: 0, operation: 0, set: { presetPath: "@presetPath" } }] },
];

/**
 * switch_project's applying case is always last: it closes the project the run works in, so every other case, the effect sweep included, must
 * already have run.
 */
export function allCases(options: { effectSweep?: boolean | undefined } = {}): CaseWithMeta[] {
  const cases = [
    ...LAYER_CASES,
    ...SHAPE_CASES,
    ...TEXT_CASES,
    ...KEYFRAME_CASES,
    ...EXPRESSION_CASES,
    ...EFFECT_CASES,
    ...MASK_CASES,
    ...MARKER_CASES,
    ...THREE_D_AUDIO_CASES,
    ...ATOMICITY_CASES,
    ...PRESET_CASES,
    ...ENVELOPE_CASES,
    ...PROJECT_CASES,
    ...COVERAGE_CASES,
    ...(options.effectSweep === false ? [] : effectSweepCases()),
    ...SWITCH_LAST_CASES,
  ];
  const ids = new Set<string>();
  for (const entry of cases) { if (ids.has(entry.id)) throw new Error(`Duplicate live case id ${entry.id}`); ids.add(entry.id); }
  return cases;
}
