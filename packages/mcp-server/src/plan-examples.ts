// Worked plan examples, one per common plan type, served with an operation's description.
import type { JsonObject } from "@extynt/decode";

type PlanExample = { summary: string; operations: JsonObject[] };

/** Worked operation examples served by ae_describe_native_operation and proposed verbatim by a sidecar test. */
export const PLAN_EXAMPLES: Readonly<Record<string, PlanExample>> = {
  animate_property: { summary: "Fade in Title over 1s", operations: [{ type: "animate_property", target: { compositionId: "C", layerId: "L", propertyPath: "ADBE Transform Group/ADBE Opacity" }, role: "transform.opacity", keyframes: [{ time: 0, value: 0, curve: "ease-out" }, { time: 1, value: 100 }] }] },
  set_layer_property: { summary: "Set Background opacity to 50%", operations: [{ type: "set_layer_property", target: { compositionId: "C", layerId: "L" }, role: "transform.opacity", propertyPath: "ADBE Transform Group/ADBE Opacity", value: 50 }] },
  create_layer: { summary: "Add a centered headline", operations: [{ type: "create_layer", target: { compositionId: "C", layerId: "__new__:headline" }, layerType: "text", name: "Headline", text: "Hello" }, { type: "set_layer_property", target: { compositionId: "C", layerId: "__new__:headline" }, role: "transform.position", propertyPath: "ADBE Transform Group/ADBE Position", value: [960, 540] }] },
  ensure_effect: { summary: "Blur Background by 20", operations: [{ type: "ensure_effect", target: { compositionId: "C", layerId: "L", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, { type: "set_effect_control", target: { compositionId: "C", layerId: "L", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2", propertyPath: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001" }, effectMatchName: "ADBE Gaussian Blur 2", value: 20 }] },
  ensure_layer_style: { summary: "Drop shadow on Logo", operations: [{ type: "ensure_layer_style", target: { compositionId: "C", layerId: "L" }, style: "drop-shadow" }] },
  add_text_animator: { summary: "Reveal Title letter by letter over 1s", operations: [{ type: "add_text_animator", target: { compositionId: "C", layerId: "L" }, newAnimatorId: "__new__:reveal", name: "Reveal", properties: { opacity: 0 }, selector: { type: "range" }, keyframes: { "selector.start": [{ time: 0, value: 0 }, { time: 1, value: 100 }] } }] },
  set_text_document: { summary: "Title reads Winter Sale in red", operations: [{ type: "set_text_document", target: { compositionId: "C", layerId: "L" }, text: "Winter Sale", fillColor: [1, 0, 0] }] },
};

/** The worked example for a plan type; setting an effect control is shown by the example that adds the effect first. */
export function planExampleFor(planType: string): PlanExample | undefined {
  return PLAN_EXAMPLES[planType] ?? (planType === "set_effect_control" ? PLAN_EXAMPLES.ensure_effect : undefined);
}
