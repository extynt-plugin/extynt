// The table of layer-grounded operation kinds: each runs only after its layer target is grounded in the snapshot and the plan.
import { validateAnimateControl, validateAnimateProperty, validateSetExpression } from "./layer-animation-rules.js";
import { validateApplyPreset, validateEnsureEffect, validateEnsureLayerStyle, validateEnsureTextAnimator, validateSetEffectControl, validateSetTextDocument } from "./layer-effect-rules.js";
import { validateCreateLayer, validateSetAudio, validateSetLayerAttribute, validateSetLayerName, validateSetLayerParent, validateSetLayerProperty, validateSetLayerTiming, validateSetLoop, validateSetTimeRemap } from "./layer-lifecycle-rules.js";
import type { OperationRule } from "./layer-targets.js";
import type { ActionPlanV2Operation } from "./plan-types.js";

/** The grounded rule of every operation kind that acts on a layer. */
export const LAYER_RULES = {
  ensure_effect: { grounded: true, validate: validateEnsureEffect },
  apply_preset: { grounded: true, validate: validateApplyPreset },
  ensure_layer_style: { grounded: true, validate: validateEnsureLayerStyle },
  set_effect_control: { grounded: true, validate: validateSetEffectControl },
  ensure_text_animator: { grounded: true, validate: validateEnsureTextAnimator },
  set_text_document: { grounded: true, validate: validateSetTextDocument },
  set_expression: { grounded: true, validate: validateSetExpression },
  animate_control: { grounded: true, validate: validateAnimateControl },
  animate_property: { grounded: true, validate: validateAnimateProperty },
  set_layer_property: { grounded: true, validate: validateSetLayerProperty },
  set_layer_name: { grounded: true, validate: validateSetLayerName },
  set_layer_parent: { grounded: true, validate: validateSetLayerParent },
  set_layer_attribute: { grounded: true, validate: validateSetLayerAttribute },
  create_layer: { grounded: true, validate: validateCreateLayer },
  set_layer_timing: { grounded: true, validate: validateSetLayerTiming },
  set_loop: { grounded: true, validate: validateSetLoop },
  set_audio: { grounded: true, validate: validateSetAudio },
  set_time_remap: { grounded: true, validate: validateSetTimeRemap },
} as const satisfies Readonly<Partial<Record<ActionPlanV2Operation["type"], OperationRule>>>;
