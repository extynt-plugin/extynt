// The effects visible in the open project, as a partial inventory.
import type { EffectSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";

import type { Inventory, InventoryItem } from "./catalogue-model.js";
import { makeInventory } from "./inventory.js";

const DEFAULT_MAX_OBSERVED_EFFECTS = 512;

function effectFromProperty(property: PropertySnapshot): EffectSnapshot {
  return { path: property.path, matchName: property.matchName, displayName: property.displayName, enabled: property.enabled ?? null, properties: property.children ?? [], expressions: [] };
}

function effectsIn(properties: readonly PropertySnapshot[]): EffectSnapshot[] {
  return properties.flatMap((property) => {
    if (property.kind === "effect") return [effectFromProperty(property)];
    if (property.matchName === "ADBE Effect Parade") return (property.children ?? []).map(effectFromProperty);
    return effectsIn(property.children ?? []);
  });
}

/** The effects visible in the open project, not a census: an unlisted effect stays "unknown" rather than becoming the claim "not installed". */
export function observeSnapshotEffects(snapshot: ProjectSnapshot, maxItems = DEFAULT_MAX_OBSERVED_EFFECTS): Inventory {
  const host = { application: "After Effects" as const, version: snapshot.host.version, buildNumber: snapshot.host.buildNumber, platform: snapshot.host.platform, architecture: snapshot.host.architecture };
  const items = new Map<string, InventoryItem>();
  const sightings = snapshot.compositions.flatMap((composition) => composition.layers.flatMap((layer) => effectsIn(layer.properties).map((effect) => ({ effect, note: `Observed in composition ${composition.id}, layer ${layer.id}.` }))));
  for (const { effect, note } of sightings) {
    if (items.size >= maxItems) return makeInventory(host, [...items.values()], true);
    if (items.has(effect.matchName)) continue;
    items.set(effect.matchName, { matchName: effect.matchName, displayName: effect.displayName, available: true, evidence: [{ kind: "observed", source: "host", note }] });
  }
  return makeInventory(host, [...items.values()], false, "partial");
}
