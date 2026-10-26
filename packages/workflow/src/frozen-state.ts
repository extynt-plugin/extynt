// Deep-frozen, reducer-owned state: copying, freezing and the registry that tells a trusted projection from an arbitrary object.

import type { WorkflowState } from "./state-types.js";

/** A mutable working copy of a state, edited inside one transition and sealed again by `finish`. */
export type MutableWorkflowState = { -readonly [Key in keyof WorkflowState]: WorkflowState[Key] };

const trustedStates = new WeakSet<WorkflowState>();

/** A structural deep copy. */
export function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

/** Freezes a value and everything reachable from it, in place. */
export function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

/** A deep-frozen copy. */
export function frozenCopy<Value>(value: Value): Value {
  return deepFreeze(clone(value));
}

/** Seals a state as a trusted projection: deep-frozen and registered as reducer-owned. */
export function finish(state: WorkflowState): WorkflowState {
  const frozen = deepFreeze(state);
  trustedStates.add(frozen);
  return frozen;
}

/** Whether the state was produced by `finish`, as opposed to being supplied by a caller. */
export function isTrustedState(state: WorkflowState): boolean {
  return trustedStates.has(state);
}

/** A mutable working copy of a sealed state. */
export function mutable(state: WorkflowState): MutableWorkflowState {
  return clone(state);
}
