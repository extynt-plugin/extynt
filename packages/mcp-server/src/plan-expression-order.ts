// Expressions apply after what they depend on: an expression is written against a property that must already hold its keyframes and may name layers or effects,
// so a plan that lists it first is a sensible plan in the wrong order. The order is settled once, when a plan is sealed or proposed whole; the queue keeps the caller's own positions.
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { jsonFieldsOf, objectAt, stringAt } from "./json.js";
import type { JsonObject } from "@extynt/decode";

type Facts = {
  type: string;
  layerId: string | undefined;
  propertyKey: string | undefined;
  declared: readonly string[];
  referenced: readonly string[];
};

const EXPRESSION_TYPES: ReadonlySet<string> = new Set(["set_expression", "set_loop"]);
const CREATORS: ReadonlySet<string> = new Set(["create_layer", "duplicate_layer", "create_vector_artwork", "ensure_effect", "apply_preset", "ensure_layer_style", "ensure_text_animator", "create_shape_group", "ensure_shape_fill", "ensure_shape_stroke", "draw_vector_shapes", "set_shape_path", "add_mask", "set_time_remap", "set_text_document"]);
const WRITERS: ReadonlySet<string> = new Set(["animate_property", "animate_control", "set_layer_property", "set_effect_control"]);
const BARRIERS: ReadonlySet<string> = new Set(["remove_layer", "duplicate_layer", "render_composition"]);
const NAME_REFERENCE = /\b(?:layer|effect|comp)\(\s*(["'])((?:(?!\1).)*)\1\s*\)/g;

function referencedNames(source: string | undefined): string[] {
  return source ? [...source.matchAll(NAME_REFERENCE)].flatMap((match) => match[2] ?? []) : [];
}

function propertyKeyOf(fields: JsonObject, target: JsonObject | undefined): string | undefined {
  const path = stringAt(target, "propertyPath") ?? stringAt(fields, "propertyPath");
  const effect = stringAt(target, "effectPath") ?? stringAt(fields, "effectPath");
  return path === undefined && effect === undefined ? undefined : `${effect ?? ""}|${path ?? ""}`;
}

function declaredNames(fields: JsonObject): string[] {
  return [stringAt(fields, "name"), stringAt(fields, "effectMatchName")].flatMap((name) => name ?? []);
}

function factsOf(operation: ActionPlanV2Operation): Facts {
  const fields = jsonFieldsOf(operation);
  const target = objectAt(fields, "target");
  return {
    type: operation.type,
    layerId: stringAt(target, "layerId"),
    propertyKey: propertyKeyOf(fields, target),
    declared: declaredNames(fields),
    referenced: referencedNames(stringAt(fields, "source")),
  };
}

function sameLayer(left: Facts, right: Facts): boolean {
  return left.layerId !== undefined && left.layerId === right.layerId;
}

function writesSameProperty(expression: Facts, later: Facts): boolean {
  return expression.propertyKey === undefined || later.propertyKey === undefined || expression.propertyKey === later.propertyKey;
}

function isDependency(expression: Facts, later: Facts): boolean {
  if (EXPRESSION_TYPES.has(later.type)) return false;
  if (expression.referenced.some((name) => later.declared.includes(name))) return true;
  if (!sameLayer(expression, later)) return false;
  if (CREATORS.has(later.type)) return true;
  return WRITERS.has(later.type) && writesSameProperty(expression, later);
}

function isBarrier(expression: Facts, later: Facts): boolean {
  return BARRIERS.has(later.type) && (later.type === "render_composition" || sameLayer(expression, later));
}

function anchorOf(facts: readonly Facts[], index: number, expression: Facts): number {
  const following = facts.slice(index + 1);
  const barrier = following.findIndex((later) => isBarrier(expression, later));
  const reachable = barrier < 0 ? following : following.slice(0, barrier);
  return reachable.reduce((anchor, later, offset) => (isDependency(expression, later) ? index + 1 + offset : anchor), index);
}

function expressionAnchors(facts: readonly Facts[]): number[] {
  const lastAnchorOnLayer = new Map<string, number>();
  return facts.map((fact, index) => {
    if (!EXPRESSION_TYPES.has(fact.type)) return index;
    const own = anchorOf(facts, index, fact);
    if (fact.layerId === undefined) return own;
    const anchor = Math.max(own, lastAnchorOnLayer.get(fact.layerId) ?? own);
    lastAnchorOnLayer.set(fact.layerId, anchor);
    return anchor;
  });
}

/** The plan's operations with each expression moved to just after the last operation it depends on, everything else (and every independent expression) exactly where it was. */
export function orderExpressionsAfterDependencies(operations: readonly ActionPlanV2Operation[]): ActionPlanV2Operation[] {
  const anchors = expressionAnchors(operations.map(factsOf));
  if (anchors.every((anchor, index) => anchor === index)) return [...operations];
  const keyed = operations.map((operation, index) => {
    const anchor = anchors[index] ?? index;
    return { operation, anchor, rank: anchor === index ? 0 : 1, index };
  });
  keyed.sort((left, right) => left.anchor - right.anchor || left.rank - right.rank || left.index - right.index);
  return keyed.map((entry) => entry.operation);
}
