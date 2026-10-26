// The native transform roles a plan may write (opacity, scale, rotation, position, anchor), their property paths, and the value
// rules in After Effects' own units, including how a null vector component is resolved against the value the property holds now.
import type { JsonValue } from "@extynt/decode";
import { invalid, isFiniteInRange, isOneOf, type Refusal } from "./validation-primitives.js";

const COMPONENT_BOUND = 1e7;
const VECTOR_ROLES = ["transform.scale", "transform.position", "transform.anchor"] as const;
const KEEP_NOTE = ' A null component means "keep the value that component already has"';

type NativeVectorRole = (typeof VECTOR_ROLES)[number];
type VectorStep = { readonly kind: "push"; readonly value: number } | { readonly kind: "stop" } | { readonly kind: "refuse"; readonly message: string };
type VectorStepContext = { readonly index: number; readonly held: readonly JsonValue[]; readonly resolvedCount: number; readonly tail: readonly JsonValue[]; readonly before: JsonValue | undefined };

/** Each native role and the exact property path it writes. */
export const NATIVE_PROPERTY_PATHS: Readonly<Record<string, string>> = { "transform.opacity": "ADBE Transform Group/ADBE Opacity", "transform.scale": "ADBE Transform Group/ADBE Scale", "transform.rotation": "ADBE Transform Group/ADBE Rotate Z", "transform.position": "ADBE Transform Group/ADBE Position", "transform.anchor": "ADBE Transform Group/ADBE Anchor Point" };

/** The role-to-path pairs, spelled for a refusal message. */
export const NATIVE_PROPERTY_ROLES = Object.entries(NATIVE_PROPERTY_PATHS).map(([role, path]) => `${role} → ${path}`).join(", ");

/** The refusal answer of resolveNativeVectorValue: the resolved vector, or why none exists. */
export type NativeVectorResolution = { readonly ok: true; readonly value: number[] } | Refusal;

/** True when the path is exactly the one the role writes. */
export function isAllowlistedNativeProperty(propertyPath: JsonValue | undefined, role: JsonValue | undefined): propertyPath is string {
  if (typeof propertyPath !== "string" || typeof role !== "string") return false;
  return NATIVE_PROPERTY_PATHS[role] === propertyPath;
}

/** The role that writes this exact path, if any. */
export function nativeRoleForPath(propertyPath: string | undefined): string | undefined { return Object.entries(NATIVE_PROPERTY_PATHS).find(([, path]) => path === propertyPath)?.[0]; }

/**
 * Typed value rules for the native transform roles, in AE's own units (opacity and scale percent, degrees, pixels). A vector is two
 * or three components inside the shared ±1e7 bound; null means "keep the value this component already has" and is offered only to a
 * static set_layer_property. A vector that is null in every component is refused, and a bare number is never expanded into a vector.
 */
export function nativeValueError(role: JsonValue | undefined, value: JsonValue | undefined, allowNullComponents = false): string | undefined {
  if (role === "transform.opacity") return isFiniteInRange(value, 0, 100) ? undefined : `transform.opacity must be one number from 0 to 100 (percent); got ${JSON.stringify(value)}.`;
  if (role === "transform.rotation") return isFiniteInRange(value, -COMPONENT_BOUND, COMPONENT_BOUND) ? undefined : `transform.rotation must be one number of degrees; got ${JSON.stringify(value)}.`;
  return isNativeVectorRole(role) ? nativeVectorError(role, value, allowNullComponents) : undefined;
}

/**
 * A static vector write with its null components filled from the value the property holds now: a numbered component comes from the
 * request, a null from `before`, and a trailing run of nulls is dropped because that is the [x, y] spelling AE already merges.
 * Nothing is invented: a null with no number in `before` is a refusal.
 */
export function resolveNativeVectorValue(role: JsonValue | undefined, value: JsonValue | undefined, before: JsonValue | undefined): NativeVectorResolution {
  if (!isNativeVectorRole(role) || !isNativeVectorShape(value)) return invalid("INVALID_VALUE", `${String(role)} is not a native vector write.`);
  const held = Array.isArray(before) ? before : [];
  const resolved: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const step = resolveVectorStep(value[index] ?? null, { index, held, resolvedCount: resolved.length, tail: value.slice(index), before });
    if (step.kind === "refuse") return invalid("INVALID_VALUE", step.message);
    if (step.kind === "stop") break;
    resolved.push(step.value);
  }
  return { ok: true, value: resolved };
}

function isNativeVectorRole(role: JsonValue | undefined): role is NativeVectorRole { return isOneOf(role, VECTOR_ROLES); }

function isNativeVectorShape(value: JsonValue | undefined): value is JsonValue[] { return Array.isArray(value) && (value.length === 2 || value.length === 3); }

function unitsOf(role: NativeVectorRole): string { return role === "transform.scale" ? " percentages (100 is unscaled)" : " pixels"; }

function nativeVectorShapeError(role: NativeVectorRole, value: JsonValue | undefined, allowNullComponents: boolean): string {
  const keepClause = allowNullComponents ? ", with null in place of any component to keep" : "";
  const expansion = role === "transform.scale" ? "Scale is expanded from one number only when it is a plain number on a queued operation; write [s, s] for uniform scale here." : "A single number is never expanded.";
  return `${role} must be [x, y] or [x, y, z]${unitsOf(role)}${keepClause}; got ${JSON.stringify(value)}. ${expansion}`;
}

function nativeNullComponentError(role: NativeVectorRole, value: readonly JsonValue[]): string | undefined {
  if (value.every((component) => component === null)) return `${role} is null in every component, so the write names nothing to set.${KEEP_NOTE}; give at least one number, or drop the operation. Got ${JSON.stringify(value)}.`;
  const bad = value.findIndex((component) => component !== null && !isFiniteInRange(component, -COMPONENT_BOUND, COMPONENT_BOUND));
  if (bad >= 0) return `${role} component ${bad} must be a number inside the ±1e7 magnitude bound${unitsOf(role)}, or null to keep the value it already has; got ${JSON.stringify(value)}. A single number is never expanded.`;
  return undefined;
}

function nativeVectorError(role: NativeVectorRole, value: JsonValue | undefined, allowNullComponents: boolean): string | undefined {
  if (!isNativeVectorShape(value)) return nativeVectorShapeError(role, value, allowNullComponents);
  if (allowNullComponents) return nativeNullComponentError(role, value);
  if (value.every((component) => isFiniteInRange(component, -COMPONENT_BOUND, COMPONENT_BOUND))) return undefined;
  return `${role} must be [x, y] or [x, y, z]${unitsOf(role)}; got ${JSON.stringify(value)}.${KEEP_NOTE}, and only a static set_layer_property write may spell it: a keyframe carries the property's whole value at its time. A single number is never expanded.`;
}

function resolveVectorStep(component: JsonValue, context: VectorStepContext): VectorStep {
  if (component !== null) return isFiniteInRange(component, -COMPONENT_BOUND, COMPONENT_BOUND) ? { kind: "push", value: component } : { kind: "refuse", message: `component ${context.index} is not a bounded number or null.` };
  const current = context.held[context.index];
  if (isFiniteInRange(current, -COMPONENT_BOUND, COMPONENT_BOUND)) return { kind: "push", value: current };
  if (context.resolvedCount >= 2 && context.tail.every((rest) => rest === null)) return { kind: "stop" };
  return { kind: "refuse", message: `component ${context.index} is null, so it means "keep the value this component already has", but the property's current value ${JSON.stringify(context.before ?? null)} has no number there; write a number for it, or refresh the snapshot.` };
}
