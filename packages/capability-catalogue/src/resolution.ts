// Resolves curated capabilities and semantic control roles to the exact instances and property paths a project snapshot holds.
import { extractEffects, flattenProperties } from "@extynt/project-graph";
import type { CompositionSnapshot, EffectSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";

import { compareText } from "./canonical.js";
import type { Capability, CatalogueGraph, Evidence, SemanticControlRole } from "./catalogue-model.js";
import { BASE_CATALOGUE } from "./curated-catalogue.js";
import { LAYER_IDENTITY_FAMILIES, absentCapabilityEvidence, capabilityFor, matchesCapabilityEffect, matchesRole, nativePropertyMatches, observedEvidence } from "./resolution-match.js";

/** How many instances a lookup found: callers must not silently pick one when the project holds several. */
export type ResolutionCardinality = "absent" | "exactly-one" | "multiple";

/** Whether the capability can be used in the open project. */
export type CapabilityAvailability = "available" | "unavailable" | "unknown";

/** Which capability to find, optionally narrowed to a composition, a layer or the selected layers. */
export interface CapabilityResolveRequest {
  capabilityId: string;
  compositionId?: string;
  layerId?: string;
  selectedLayer?: boolean;
}

/** One place a capability exists in the project, with the evidence that it does. */
export interface ResolvedCapabilityInstance {
  capabilityId: string;
  compositionId: string;
  layerId: string;
  layerName: string;
  effectPath: string;
  effectMatchName: string;
  effectDisplayName: string;
  enabled: boolean | null;
  evidence: Evidence[];
}

/** Every instance of a capability found in the project. */
export interface CapabilityResolution {
  capabilityId: string;
  availability: CapabilityAvailability;
  status: ResolutionCardinality;
  instances: ResolvedCapabilityInstance[];
  evidence: Evidence[];
}

/** Which control role to find on a capability, optionally on one effect. */
export interface ControlResolveRequest extends CapabilityResolveRequest {
  role: SemanticControlRole;
  effectPath?: string;
}

/** One property that plays the requested role, as the project holds it. */
export interface ResolvedControl {
  capabilityId: string;
  role: SemanticControlRole;
  compositionId: string;
  layerId: string;
  layerName: string;
  effectPath: string | null;
  effectMatchName: string | null;
  propertyPath: string;
  propertyMatchName: string;
  displayName: string;
  valueType: PropertySnapshot["valueType"];
  value: PropertySnapshot["value"];
  canSetValue: boolean;
  expression: string | null;
  expressionEnabled: boolean;
  keyframes: NonNullable<PropertySnapshot["keyframes"]>;
  evidence: Evidence[];
}

/** Every control found for a role. */
export interface ControlResolution {
  capabilityId: string;
  role: SemanticControlRole;
  status: ResolutionCardinality;
  controls: ResolvedControl[];
  evidence: Evidence[];
}

interface LayerSite {
  readonly composition: CompositionSnapshot;
  readonly layer: LayerSnapshot;
}

interface SiteContext {
  readonly capability: Capability;
  readonly baseEvidence: Evidence[];
}

interface ControlContext extends SiteContext {
  readonly request: ControlResolveRequest;
}

function cardinality(count: number): ResolutionCardinality {
  if (count === 0) return "absent";
  return count === 1 ? "exactly-one" : "multiple";
}

function layerSites(snapshot: ProjectSnapshot, request: CapabilityResolveRequest): LayerSite[] {
  return snapshot.compositions
    .filter((composition) => request.compositionId === undefined || composition.id === request.compositionId)
    .flatMap((composition) => composition.layers
      .filter((layer) => (request.layerId === undefined || layer.id === request.layerId) && (request.selectedLayer === undefined || layer.isSelected === request.selectedLayer))
      .map((layer) => ({ composition, layer })));
}

function instanceAt(context: SiteContext, site: LayerSite, found: { path: string; matchName: string; displayName: string; enabled: boolean | null }): ResolvedCapabilityInstance {
  const { composition, layer } = site;
  return {
    capabilityId: context.capability.id, compositionId: composition.id, layerId: layer.id, layerName: layer.name,
    effectPath: found.path, effectMatchName: found.matchName, effectDisplayName: found.displayName, enabled: found.enabled,
    evidence: [...context.baseEvidence, observedEvidence(composition.id, layer.id, found.path)],
  };
}

function layerIdentityInstance(context: SiteContext, site: LayerSite): ResolvedCapabilityInstance[] {
  const { capability } = context;
  if (!capability.nativeFamily || !LAYER_IDENTITY_FAMILIES.has(capability.nativeFamily)) return [];
  if (!capability.layerTypes?.includes(site.layer.type)) return [];
  const identity = capability.matchName ?? capability.id;
  return [instanceAt(context, site, { path: identity, matchName: identity, displayName: capability.displayName, enabled: null })];
}

function nativeInstances(context: SiteContext, site: LayerSite): ResolvedCapabilityInstance[] {
  const { capability } = context;
  const observed = flattenProperties(site.layer.properties).find((property) => nativePropertyMatches(capability, property));
  if (!observed) return layerIdentityInstance(context, site);
  const path = capability.matchName ?? observed.path;
  return [instanceAt(context, site, { path, matchName: capability.matchName ?? observed.matchName, displayName: capability.displayName, enabled: observed.enabled ?? null })];
}

function effectInstances(context: SiteContext, site: LayerSite): ResolvedCapabilityInstance[] {
  return extractEffects(site.layer)
    .filter((effect) => matchesCapabilityEffect(context.capability, effect))
    .map((effect) => instanceAt(context, site, effect));
}

function compareInstances(a: ResolvedCapabilityInstance, b: ResolvedCapabilityInstance): number {
  return compareText(a.compositionId, b.compositionId) || compareText(a.layerId, b.layerId) || compareText(a.effectPath, b.effectPath);
}

/** Every instance of the capability in the project, ordered by composition, layer and effect path. */
export function resolveCapability(snapshot: ProjectSnapshot, request: CapabilityResolveRequest, catalogue: CatalogueGraph = BASE_CATALOGUE): CapabilityResolution {
  const capability = capabilityFor(catalogue, request.capabilityId);
  const baseEvidence = capability?.evidence ?? [absentCapabilityEvidence(request.capabilityId)];
  if (!capability) return { capabilityId: request.capabilityId, availability: "unavailable", status: "absent", instances: [], evidence: baseEvidence };
  const context: SiteContext = { capability, baseEvidence };
  const find = capability.nativeFamily ? nativeInstances : effectInstances;
  const ordered = layerSites(snapshot, request).flatMap((site) => find(context, site)).sort(compareInstances);
  return { capabilityId: capability.id, availability: "available", status: cardinality(ordered.length), instances: ordered, evidence: [...baseEvidence, ...ordered.flatMap((instance) => instance.evidence.slice(1))] };
}

function resolvedControl(context: ControlContext, site: LayerSite, found: { effect: EffectSnapshot | null; property: PropertySnapshot }): ResolvedControl {
  const { effect, property } = found;
  const { composition, layer } = site;
  return {
    capabilityId: context.capability.id, role: context.request.role, compositionId: composition.id, layerId: layer.id, layerName: layer.name,
    effectPath: effect?.path ?? null, effectMatchName: effect?.matchName ?? null, propertyPath: property.path, propertyMatchName: property.matchName,
    displayName: property.displayName, valueType: property.valueType, value: property.value, canSetValue: property.canSetValue,
    expression: property.expression ?? null, expressionEnabled: property.expressionEnabled === true, keyframes: property.keyframes ?? [],
    evidence: [...context.baseEvidence, observedEvidence(composition.id, layer.id, property.path)],
  };
}

function matchedControl(context: ControlContext, site: LayerSite, effect: EffectSnapshot | null): ResolvedControl[] {
  const properties = flattenProperties(effect ? effect.properties : site.layer.properties);
  const property = properties.find((candidate) => matchesRole(context.request.role, candidate, effect, context.capability));
  return property ? [resolvedControl(context, site, { effect, property })] : [];
}

function controlEffects(context: ControlContext, site: LayerSite): Array<EffectSnapshot | null> {
  if (context.capability.nativeFamily) return [null];
  return extractEffects(site.layer).filter((effect) => matchesCapabilityEffect(context.capability, effect) && (context.request.effectPath === undefined || effect.path === context.request.effectPath));
}

function controlKey(control: ResolvedControl): string {
  return [control.compositionId, control.layerId, control.effectPath ?? "", control.propertyPath].join("\u0000");
}

function compareControls(a: ResolvedControl, b: ResolvedControl): number {
  return compareText(a.compositionId, b.compositionId) || compareText(a.layerId, b.layerId) || compareText(a.effectPath ?? "", b.effectPath ?? "") || compareText(a.propertyPath, b.propertyPath);
}

function uniqueControls(controls: readonly ResolvedControl[]): ResolvedControl[] {
  const byKey = new Map<string, ResolvedControl>();
  for (const control of controls) if (!byKey.has(controlKey(control))) byKey.set(controlKey(control), control);
  return [...byKey.values()];
}

/** Resolve a semantic control role to an exact observed property path. */
export function resolveControl(snapshot: ProjectSnapshot, request: ControlResolveRequest, catalogue: CatalogueGraph = BASE_CATALOGUE): ControlResolution {
  const capability = capabilityFor(catalogue, request.capabilityId);
  const baseEvidence = capability?.evidence ?? [absentCapabilityEvidence(request.capabilityId)];
  if (!capability) return { capabilityId: request.capabilityId, role: request.role, status: "absent", controls: [], evidence: baseEvidence };
  const context: ControlContext = { capability, baseEvidence, request };
  const found = layerSites(snapshot, request).flatMap((site) => controlEffects(context, site).flatMap((effect) => matchedControl(context, site, effect)));
  const ordered = uniqueControls(found).sort(compareControls);
  return { capabilityId: capability.id, role: request.role, status: cardinality(ordered.length), controls: ordered, evidence: [...baseEvidence, ...ordered.flatMap((control) => control.evidence.slice(1))] };
}
