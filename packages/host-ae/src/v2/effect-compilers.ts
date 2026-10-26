// Compilers for the effect, text, text-animator and 3D-option kinds: the operations that resolve table matchNames.
import { LAYER_STYLES, TEXT_SELECTORS, resolveSpecWrites, textAnimatorSpecs, type AddTextAnimatorOperation, type EnsureLayerStyleOperation, type TextSelectorType, type UpdateTextAnimatorOperation } from "@extynt/action-plan";
import { compilerTable, refuse, type HostOutcome } from "./compiler-table.js";
import { hostAnimations, hostWrites, layerRef, textAnimatorValues, validatedPropertyPath } from "./host-values.js";

function layerStyleOperation(operation: EnsureLayerStyleOperation): HostOutcome {
  const style = LAYER_STYLES[operation.style];
  return { operation: "ensure_layer_style", ...layerRef(operation.target), style: operation.style, styleMatchName: style.matchName, menu: style.menu, commandId: style.commandId, enabled: operation.enabled ?? true, ...(operation.values ? { values: operation.values } : {}) };
}

type AnimatorIdentity = { newAnimatorId?: string; animatorId?: string; name?: string };

function textAnimatorOperation(operation: AddTextAnimatorOperation | UpdateTextAnimatorOperation, identity: AnimatorIdentity): HostOutcome {
  const selectorType: TextSelectorType = operation.selector?.type ?? "range";
  const resolved = resolveSpecWrites(textAnimatorSpecs(selectorType), textAnimatorValues(operation), operation.keyframes, "text animator");
  if (typeof resolved === "string") return refuse("INVALID_VALUE", resolved);
  const amountExpression = operation.selector?.amountExpression;
  return { operation: operation.type, ...layerRef(operation.target), ...identity, selectorMatchName: TEXT_SELECTORS[selectorType].matchName, ...(amountExpression === undefined ? {} : { amountExpression }), writes: hostWrites(resolved.writes), animations: hostAnimations(resolved.animations, operation.keyframeMode) };
}

export const EFFECT_COMPILERS = compilerTable({
  ensure_effect: (operation) => ({ operation: "ensure_effect", ...layerRef(operation.target), capabilityId: operation.capabilityId, effectMatchName: operation.effectMatchName, effectPath: operation.effectPath, enabled: operation.enabled, initialization: operation.initialization }),
  apply_preset: (operation) => ({ operation: "apply_preset", ...layerRef(operation.target), ...(operation.presetFile === undefined ? { presetId: operation.presetId ?? "" } : { presetFile: operation.presetFile }) }),
  ensure_layer_style: layerStyleOperation,
  set_effect_control: (operation) => ({ operation: "set_effect_control", ...layerRef(operation.target), effectMatchName: operation.effectMatchName, effectPath: operation.target.effectPath, propertyPath: validatedPropertyPath(operation.target), value: operation.value }),
});

export const TEXT_COMPILERS = compilerTable({
  set_text_document: ({ type: _type, target, ...fields }) => ({ operation: "set_text_document", ...layerRef(target), ...fields }),
  ensure_text_animator: (operation) => ({ operation: "ensure_text_animator", ...layerRef(operation.target), role: operation.role, value: operation.value }),
  add_text_animator: (operation) => textAnimatorOperation(operation, { newAnimatorId: operation.newAnimatorId, ...(operation.name ? { name: operation.name } : {}) }),
  update_text_animator: (operation) => textAnimatorOperation(operation, { animatorId: operation.animatorId }),
});

export const OPTION_COMPILERS = compilerTable({
  set_camera_options: (operation) => ({ operation: "set_camera_options", ...layerRef(operation.target), options: operation.options }),
  set_light_options: (operation) => ({ operation: "set_light_options", ...layerRef(operation.target), options: operation.options }),
  set_material_options: (operation) => ({ operation: "set_material_options", ...layerRef(operation.target), options: operation.options }),
});
