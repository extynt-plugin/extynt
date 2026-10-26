// Runs one operation of a plan: the checks every kind shares, then the kind's own rule.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import { groundOperationTarget, type OperationContext } from "./layer-targets.js";
import { ruleFor } from "./operation-rules.js";
import type { PlanBounds } from "./plan-types.js";
import { earlierRemovalError, earlierRemovals } from "./removal-rules.js";
import { invalid, isRefusal, strayLayerTargetField, type OperationResult } from "./validation-primitives.js";

const NAME_CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u0008\\u000A-\\u001F\\u007F]");
const NO_FIELDS: JsonObject = {};

/** Where an operation sits in its plan: the plan record, the declared bounds and the operation's position. */
export type PlanPosition = { readonly plan: JsonObject; readonly operations: readonly JsonValue[]; readonly bounds: PlanBounds; readonly snapshot: ProjectSnapshot | undefined };

/**
 * Validates the operation at `index`: the control-character, earlier-removal and stray-target-field checks run for every kind, then
 * the kind's rule. A kind that grounds its layer target is refused for a stale or missing target before an unknown kind is refused.
 */
export function validateOperation(position: PlanPosition, index: number): OperationResult {
  const { plan, operations, bounds, snapshot } = position;
  const value = operations[index];
  const operation = Array.isArray(value) ? NO_FIELDS : value;
  if (!isJsonObject(operation)) return invalid("INVALID_OPERATION", "Operation must be an object.");
  const context: OperationContext = { operation, plan, snapshot, bounds, index, earlier: operations.slice(0, index), later: operations.slice(index + 1) };
  const preflight = preflightError(context);
  if (preflight) return preflight;
  const rule = ruleFor(operation.type);
  if (rule && !rule.grounded) return rule.validate(context);
  const target = groundOperationTarget(context);
  if (isRefusal(target)) return target;
  return rule ? rule.validate({ ...context, target }) : invalid("INVALID_OPERATION", "Operation is not in the v0.2 allowlist.");
}

function preflightError({ operation, earlier, index }: OperationContext): OperationResult | undefined {
  const name = operation.name;
  if (typeof name === "string" && NAME_CONTROL_CHARACTERS.test(name)) return invalid("INVALID_VALUE", "Names cannot contain control characters (other than tab); After Effects strips them, so the result would not match the plan.");
  return earlierRemovalError(operation, earlierRemovals(earlier), index) ?? strayLayerTargetField(operation);
}
