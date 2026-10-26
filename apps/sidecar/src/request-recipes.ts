// Resolved recipes: the features a request names (request-coverage) turned into the exact operations that make them, so a model spends no steps searching the same capabilities each run; the block is static for a request, so it sits in the cached prefix.
import { recipeEffect, type RecipeEffect } from "@extynt/capability-catalogue";
import { type JsonValue } from "@extynt/decode";
import type { FeatureId } from "./coverage-features.js";
import { requestedFeatures } from "./request-coverage.js";

type Operation = { [field: string]: JsonValue };
interface RecipeContext { compositionId: string; features: ReadonlySet<FeatureId> }
interface ControlSample { propertyName: string; value: JsonValue }
type RecipeLine = string | { label: string; operation: Operation };
interface Recipe { ids: readonly FeatureId[]; lines(context: RecipeContext): RecipeLine[] }

const TEXT = "__new__:title";
const SHAPE = "__new__:shape";
const MATTE_SOURCE = "__new__:shine";
const CAMERA = "__new__:camera";
const NULL = "__new__:null";

const op = (label: string, operation: Operation): RecipeLine => ({ label, operation });
const GLOW_INTENSITY = "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0004";

const FEATURE_EFFECTS: readonly { feature: FeatureId; matchName: string; sample: ControlSample }[] = [
  { feature: "glow", matchName: "ADBE Glo2", sample: { propertyName: "Glow Radius", value: 40 } },
  { feature: "drop-shadow", matchName: "ADBE Drop Shadow", sample: { propertyName: "Softness", value: 12 } },
  { feature: "blur", matchName: "ADBE Gaussian Blur 2", sample: { propertyName: "Blurriness", value: 20 } },
  { feature: "ramp", matchName: "ADBE Ramp", sample: { propertyName: "Ramp Shape", value: 2 } },
];

function ensureEffectOperations(layerId: string, effect: RecipeEffect, sample: ControlSample): [Operation] | [Operation, Operation] {
  const effectPath = `ADBE Effect Parade/${effect.matchName}`;
  const ensure: Operation = { type: "ensure_effect", target: { layerId, effectPath }, capabilityId: effect.capabilityId, effectMatchName: effect.matchName, effectPath };
  const found = effect.controls.find((candidate) => candidate.name === sample.propertyName);
  if (!found) return [ensure];
  return [ensure, { type: "set_effect_control", target: { layerId, effectPath, propertyPath: `${effectPath}/${found.matchName}` }, effectMatchName: effect.matchName, value: sample.value }];
}

function effectLines(context: RecipeContext): RecipeLine[] {
  const resolved = FEATURE_EFFECTS.filter(({ feature }) => context.features.has(feature)).flatMap(({ matchName, sample }) => {
    const effect = recipeEffect(matchName);
    return effect ? [{ effect, sample }] : [];
  });
  const [first] = resolved;
  if (!first) return [];
  const [ensure, setControl] = ensureEffectOperations(TEXT, first.effect, first.sample);
  return [
    `Effects (${resolved.map(({ effect }) => effect.displayName).join(", ")}): ensure_effect once per effect per layer, then one set_effect_control per value; a control's propertyPath is "<effectPath>/<control matchName>". Pattern (${first.effect.displayName}):`,
    op("ensure_effect", ensure), ...(setControl ? [op("set_effect_control", setControl)] : []),
    ...resolved.map(({ effect }) => `${effect.displayName} = ${effect.matchName}, capabilityId ${effect.capabilityId}; controls: ${effect.controls.map((control) => `${control.name} ${control.matchName} (${control.rule})`).join("; ")}`),
  ];
}

const TEXT_ANIMATOR: Recipe = { ids: ["text-animator", "selector-offset"], lines: () => [
  "Text animator + range-selector offset (one operation; properties apply to the selected range; a key is set in properties/selector.settings OR keyframed, never both; times are composition seconds; a curve goes on the key whose segment it shapes, never the last):",
  op("add_text_animator", { type: "add_text_animator", target: { layerId: TEXT }, newAnimatorId: "__new__:reveal", name: "Reveal", properties: { opacity: 0, position: [0, 60], rotation: 6 }, selector: { type: "range" }, keyframes: { "selector.offset": [{ time: 0.8, value: 0, curve: "out-expo" }, { time: 1.8, value: 100 }] } }),
] };

const MATTE: Recipe = { ids: ["matte", "text-matte"], lines: () => [
  "Track matte: target is the layer that is clipped to (shows only inside) the matte, matteLayerId supplies it; a shine/sweep over text targets the shine and mattes it with the text, never the reverse; AE hides the matte layer, so a text matte that must stay visible needs showMatteLayer: true (mode alpha | alpha-inverted | luma | luma-inverted); both layers must already exist or be created earlier in the queue:",
  op("set_track_matte", { type: "set_track_matte", target: { layerId: MATTE_SOURCE }, matteLayerId: TEXT, mode: "alpha", showMatteLayer: true }),
] };

const WIGGLE: Recipe = { ids: ["wiggle"], lines: (context) => context.features.has("glow")
  ? ["Wiggle on the glow: the effect must be ensured earlier in the same queue; set_expression addresses the control by effectPath and propertyPath, with a time window here for the first half second:",
    op("set_expression", { type: "set_expression", target: { layerId: TEXT, effectPath: "ADBE Effect Parade/ADBE Glo2", propertyPath: GLOW_INTENSITY }, source: "time < 0.5 ? wiggle(12, 0.4) : value", enabled: true })]
  : ["Wiggle expression (a property with an expression ignores new keyframes):",
    op("set_expression", { type: "set_expression", target: { layerId: TEXT, propertyPath: "ADBE Transform Group/ADBE Position" }, source: "wiggle(2, 30)", enabled: true })] };

const REPEATER: Recipe = { ids: ["repeater", "trim-paths"], lines: (context) => [
  `Shape operators on a shape layer's root group (draw the primitive first; menus are 1-based):`,
  op("add_shape_item", { type: "add_shape_item", target: { layerId: SHAPE }, groupId: "root", item: "ellipse", newItemId: "__new__:ring", name: "Ring", values: { size: [200, 200] } }),
  ...(context.features.has("repeater") ? [op("add_shape_item", { type: "add_shape_item", target: { layerId: SHAPE }, groupId: "root", item: "repeater", newItemId: "__new__:copies", name: "Ring Copies", values: { copies: 12, scale: [92, 92] } })] : []),
  ...(context.features.has("trim-paths") ? [op("add_shape_item", { type: "add_shape_item", target: { layerId: SHAPE }, groupId: "root", item: "trim-paths", newItemId: "__new__:trim", name: "Trim", keyframes: { end: [{ time: 0, value: 0, curve: "out-quint" }, { time: 1, value: 100 }] } })] : []),
] };

const CAMERA_RECIPE: Recipe = { ids: ["camera"], lines: () => [
  "Camera push-in or pull-out: queue create_layer camera and dolly_camera together. distance is pixels from the camera to its point of interest along the camera's own viewing axis, so a push-in is a falling distance (2667 -> 2200) and a pull-out a rising one. Never send Position coordinates for a camera: the host derives every key from the axis the camera has, and keeps it on that axis. A default camera sits at distance 2667 for a 1920x1080 comp (its zoom). Only 3D layers respond to a camera:",
  op("create_layer", { type: "create_layer", target: { layerId: CAMERA }, layerType: "camera", name: "Camera" }),
  op("dolly_camera", { type: "dolly_camera", target: { layerId: CAMERA }, keyframes: [{ time: 0, distance: 2667, curve: "ease" }, { time: 10, distance: 2200 }] }),
] };

const NULL_PARENT: Recipe = { ids: ["null", "parent"], lines: () => [
  "Null parent: create the null, then set_layer_parent on each child (target is the child, parentLayerId the parent):",
  op("create_layer", { type: "create_layer", target: { layerId: NULL }, layerType: "null", name: "Title Null" }),
  op("set_layer_parent", { type: "set_layer_parent", target: { layerId: TEXT }, parentLayerId: NULL }),
] };

const THREE_D: Recipe = { ids: ["three-d"], lines: () => ["3D switch, one operation per layer:", op("set_layer_attribute", { type: "set_layer_attribute", target: { layerId: TEXT }, role: "three-d", value: true })] };

const MARKERS: Recipe = { ids: ["markers"], lines: (context) => ["Marker on the composition (or on a layer with target {layerId}); time in composition seconds, one operation per beat:", op("add_marker", { type: "add_marker", target: { compositionId: context.compositionId }, time: 0.8, comment: "Reveal" })] };

const ESSENTIAL: Recipe = { ids: ["essential-graphics"], lines: () => ["Essential Graphics: target must carry the propertyPath to publish (Source Text here):", op("add_essential_property", { type: "add_essential_property", target: { layerId: TEXT, propertyPath: "ADBE Text Properties/ADBE Text Document" }, name: "Title" })] };

const EFFECTS: Recipe = { ids: FEATURE_EFFECTS.map(({ feature }) => feature), lines: effectLines };
const RECIPES: readonly Recipe[] = [EFFECTS, TEXT_ANIMATOR, MATTE, WIGGLE, REPEATER, NULL_PARENT, THREE_D, CAMERA_RECIPE, MARKERS, ESSENTIAL];

const heading = (verb: string): string => `Resolved for this request (looked up in the capability catalogue; each example is a plan the validator accepts). ${verb} these directly: do not search or describe these capabilities or operations again, and do not read their guides. Layer ids below are placeholders: use your own __new__:<name> or a real id. A refused control path is the one case to look a capability up.`;

const render = (line: RecipeLine): string => (typeof line === "string" ? line : `${line.label}: ${JSON.stringify(line.operation)}`);

function recipeLines(goal: string, compositionId: string): RecipeLine[] {
  const features = new Set(requestedFeatures(goal).map((feature) => feature.id));
  const context: RecipeContext = { compositionId, features };
  return RECIPES.filter((recipe) => recipe.ids.some((id) => features.has(id))).flatMap((recipe) => recipe.lines(context));
}

/** The compact block for the features a request names, or an empty list when it names none; `compositionId` is the open composition, for composition-level operations. */
export function recipeBlock(goal: string, compositionId: string, verb = "Queue"): string[] {
  const lines = recipeLines(goal, compositionId);
  return lines.length ? [heading(verb), ...lines.map(render)] : [];
}

/** Every example operation the block carries, for the test that runs them through the validator. */
export function recipeOperations(goal: string, compositionId: string): Operation[] {
  return recipeLines(goal, compositionId).flatMap((line) => (typeof line === "string" ? [] : [line.operation]));
}
