// The vocabulary of concepts an agent may declare it intended, and which plan operations realise each.
import type { JsonValue } from "@extynt/decode";

import { objectField, stringField, targetString } from "./completeness-view.js";
import type { PlanOperation } from "./completeness-view.js";

/** A concept an agent may declare: its word, and whether an operation realises it. */
export interface IntentConcept {
  readonly word: string;
  readonly matches: (operation: PlanOperation) => boolean;
}

interface ConceptRule {
  readonly types?: readonly string[];
  readonly when?: (operation: PlanOperation) => boolean;
}

const textOf = (value: JsonValue | undefined): string => (typeof value === "string" ? value : "");

function saysEffect(operation: PlanOperation, pattern: RegExp): boolean {
  if (pattern.test(textOf(operation.operation.effectMatchName))) return true;
  const propertyPath = targetString(operation, "propertyPath") ?? stringField(operation.operation, "propertyPath");
  return propertyPath !== undefined && pattern.test(propertyPath);
}

function isLayerStyle(operation: PlanOperation, pattern: RegExp): boolean {
  return operation.type === "ensure_layer_style" && pattern.test(textOf(operation.operation.style));
}

function addsShapeItem(operation: PlanOperation, pattern: RegExp): boolean {
  return operation.type === "add_shape_item" && pattern.test(textOf(operation.operation.item));
}

function createsLayerOfType(operation: PlanOperation, layerType: string): boolean {
  return operation.type === "create_layer" && operation.operation.layerType === layerType;
}

function hasSelectorExpression(operation: PlanOperation): boolean {
  const selector = objectField(operation.operation, "selector");
  return selector !== undefined && typeof selector.amountExpression === "string";
}

function concept(word: string, rule: ConceptRule): IntentConcept {
  const types = rule.types ?? [];
  return { word, matches: (operation) => operation.type === "apply_preset" || types.includes(operation.type) || (rule.when?.(operation) ?? false) };
}

/** Every concept a plan may declare, in the order they are listed to the agent; apply_preset may realise any of them. */
export const INTENT_CONCEPTS: readonly IntentConcept[] = [
  concept("blur", { when: (op) => saysEffect(op, /blur/i) }),
  concept("glow", { when: (op) => saysEffect(op, /glow/i) || isLayerStyle(op, /glow/i) }),
  concept("shadow", { when: (op) => saysEffect(op, /shadow/i) || isLayerStyle(op, /shadow/i) }),
  concept("gradient", { when: (op) => saysEffect(op, /ramp|gradient/i) || addsShapeItem(op, /gradient/i) || isLayerStyle(op, /gradient/i) }),
  concept("matte", { types: ["set_track_matte"] }),
  concept("mask", { types: ["add_mask", "update_mask", "remove_mask"] }),
  concept("parent", { types: ["set_layer_parent"] }),
  concept("marker", { types: ["add_marker", "update_marker", "remove_marker"] }),
  concept("expression", { types: ["set_expression", "set_loop"], when: hasSelectorExpression }),
  concept("text", { types: ["set_text_document", "add_text_animator", "update_text_animator", "ensure_text_animator"], when: (op) => createsLayerOfType(op, "text") }),
  concept("camera", { types: ["set_camera_options", "dolly_camera"], when: (op) => createsLayerOfType(op, "camera") }),
  concept("audio", { types: ["set_audio"] }),
];
