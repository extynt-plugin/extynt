// How a curated capability and a semantic control role are recognised in a project snapshot.
import type { EffectSnapshot, PropertySnapshot } from "@extynt/project-graph";

import type { Capability, CatalogueGraph, Evidence, NativeFamily, SemanticControlRole } from "./catalogue-model.js";

/** Native families whose layer type is itself the observed identity when the adapter exposes no family property group. */
export const LAYER_IDENTITY_FAMILIES: ReadonlySet<NativeFamily> = new Set(["footage", "camera", "light"]);

const CAPABILITY_ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["adobe.gaussian-blur", ["adobe.gaussian-blur", "ae:ADBE Gaussian Blur 2", "ADBE Gaussian Blur 2", "ADBE Gaussian Blur"]],
  ["adobe.transform", ["adobe.transform", "ae:ADBE Transform Group", "ADBE Transform Group"]],
];

const GAUSSIAN_BLUR_EFFECTS: ReadonlySet<string> = new Set(["ADBE Gaussian Blur", "ADBE Gaussian Blur 2"]);

interface BlurRoleRule {
  readonly matchNames: readonly string[];
  readonly label: RegExp;
}

const BLUR_ROLE_RULES: ReadonlyArray<readonly [SemanticControlRole, BlurRoleRule]> = [
  ["blur.amount", { matchNames: ["ADBE Gaussian Blur 2-0001", "ADBE Gaussian Blur-0001"], label: /blurriness|blur amount/i }],
  ["blur.repeat-edges", { matchNames: ["ADBE Gaussian Blur 2-0003"], label: /repeat edge/i }],
];

/** The evidence that states a capability id is not in the curated catalogue. */
export function absentCapabilityEvidence(capabilityId: string): Evidence {
  return { kind: "unsupported", source: "catalogue", reference: capabilityId, note: "Capability is not present in the curated catalogue." };
}

/** The evidence that a property or effect was seen in the open project. */
export function observedEvidence(compositionId: string, layerId: string, path: string): Evidence {
  return { kind: "observed", source: "host", reference: `${compositionId}/${layerId}/${path}` };
}

/** The catalogue capability an id (or alias, or match name) names. */
export function capabilityFor(catalogue: CatalogueGraph, id: string): Capability | undefined {
  const candidates = CAPABILITY_ALIASES.find(([alias]) => alias === id)?.[1] ?? [id];
  return catalogue.capabilities.find((capability) => candidates.includes(capability.id) || (capability.matchName !== undefined && candidates.includes(capability.matchName)));
}

/** Whether an effect on a layer is an instance of the capability. */
export function matchesCapabilityEffect(capability: Capability, effect: EffectSnapshot): boolean {
  if (capability.matchName === effect.matchName) return true;
  return capability.id === "adobe.gaussian-blur" && GAUSSIAN_BLUR_EFFECTS.has(effect.matchName);
}

/** Whether a native-family property is the capability's own property group. */
export function nativePropertyMatches(capability: Capability, property: PropertySnapshot): boolean {
  const identity = property.matchName === capability.matchName || property.path === capability.matchName || property.path.startsWith(`${capability.matchName}/`);
  return identity && !property.path.startsWith("ADBE Effect Parade/");
}

function matchesControlSchema(capability: Capability, role: SemanticControlRole, property: PropertySnapshot): boolean {
  const schema = capability.controls?.find((control) => control.role === role);
  if (!schema) return false;
  return property.matchName === schema.matchName || property.path === schema.path || property.path.endsWith(`/${schema.matchName}`);
}

function matchesGaussianBlurRole(role: SemanticControlRole, property: PropertySnapshot): boolean {
  const rule = BLUR_ROLE_RULES.find(([name]) => name === role)?.[1];
  return rule !== undefined && (rule.matchNames.includes(property.matchName) || rule.label.test(property.displayName));
}

/** Whether a property plays the role for the capability, by its curated schema or, for Gaussian Blur, by name. */
export function matchesRole(role: SemanticControlRole, property: PropertySnapshot, effect: EffectSnapshot | null, capability: Capability): boolean {
  if (matchesControlSchema(capability, role, property)) return true;
  if (capability.nativeFamily || !effect || !matchesCapabilityEffect(capability, effect)) return false;
  return matchesGaussianBlurRole(role, property);
}
