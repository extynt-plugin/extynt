// The sizes a plan declares as its bounds: keyframes written and the longest expression.
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { arrayAt, objectAt, stringAt } from "./json.js";
import { isJsonArray } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { operationJson } from "./operations.js";

/** What a plan measures against its declared bounds. */
export type PlanSizes = { totalKeyframes: number; maxExpressionLength: number };

/** The expression sources an operation writes, whichever field carries them. */
export function expressionSources(operation: JsonObject): Array<JsonValue | undefined> {
  const type = stringAt(operation, "type");
  const animated = type === "animate_property" || type === "animate_control";
  return [
    type === "set_expression" ? operation.source : undefined,
    animated ? objectAt(operation, "expression")?.source : undefined,
    objectAt(operation, "selector")?.amountExpression,
  ];
}

function keyframeCount(operation: JsonObject): number {
  const listed = arrayAt(operation, "keyframes");
  if (listed) return listed.length;
  const byProperty = objectAt(operation, "keyframes");
  return Object.values(byProperty ?? {}).reduce((total: number, frames) => total + (isJsonArray(frames) ? frames.length : 0), 0);
}

function longestExpression(operation: JsonObject): number {
  return Math.max(0, ...expressionSources(operation).map((source) => (typeof source === "string" ? source.length : 0)));
}

/** The keyframes written and the longest expression across the operations. */
export function boundsFor(operations: readonly ActionPlanV2Operation[]): PlanSizes {
  const written = operations.map(operationJson);
  return { totalKeyframes: written.reduce((total, operation) => total + keyframeCount(operation), 0), maxExpressionLength: Math.max(0, ...written.map(longestExpression)) };
}

/** The longest a key may sit: the longest observed or newly created composition, at most a day. */
export function keyframeTimeBound(snapshot: ProjectSnapshot, operations: readonly ActionPlanV2Operation[]): number {
  const created = operations.map((operation) => operation.type === "create_composition" ? operation.durationSeconds : 0);
  const durations = [30, ...snapshot.compositions.map((composition) => composition.duration), ...created];
  return Math.min(86_400, Math.ceil(Math.max(...durations.filter((duration) => Number.isFinite(duration)))));
}
