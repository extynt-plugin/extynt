// How a plan's operations are echoed in a response: a long keyframe list is replaced by its count and its ends.
import type { ActionPlan, ActionPlanV2Operation } from "@extynt/action-plan";
import { composedOperations, operationKeyframes } from "./operations.js";

const ECHOED_KEYFRAME_LIMIT = 8;

function elideEchoedKeyframes(operation: ActionPlanV2Operation): ActionPlanV2Operation {
  const keyframes = operationKeyframes(operation);
  if (!keyframes || keyframes.length <= ECHOED_KEYFRAME_LIMIT) return operation;
  const elided = { keyframes: { omitted: true, count: keyframes.length, first: keyframes[0], last: keyframes.at(-1) } };
  return Object.assign({ ...operation }, elided);
}

/** The operations as a response echoes them. */
export function compactOperationEcho(operations: readonly ActionPlanV2Operation[]): ActionPlanV2Operation[] {
  return operations.map(elideEchoedKeyframes);
}

/** The plan with its operations echoed compactly; a plan with no long keyframe list is returned as it is. */
export function compactPlanEcho(plan: ActionPlan): ActionPlan {
  const operations = composedOperations(plan);
  const compact = compactOperationEcho(operations);
  return compact.some((operation, index) => operation !== operations[index]) ? { ...plan, operations: compact } : plan;
}
