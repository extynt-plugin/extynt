// Says when a queued ensure_effect lands on an effect the layer already has, so a request for "a new Glow" is not quietly written into the old one.
import { flattenProperties } from "@extynt/project-graph";
import type { LayerSnapshot, ProjectSnapshot } from "@extynt/project-graph";
import { asObject, objectAt, stringAt } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";

const PARADE = "ADBE Effect Parade";

interface EnsureFacts {
  readonly matchName: string;
  readonly effectPath: string;
  readonly layerId: string;
  readonly compositionId: string | undefined;
}

function escaped(matchName: string): string {
  return matchName.replace(/%/g, "%25").replace(/\//g, "%2F").replace(/#/g, "%23");
}

function nonEmpty(value: string | undefined): string | undefined {
  return value || undefined;
}

function layerOf(snapshot: ProjectSnapshot, facts: EnsureFacts): LayerSnapshot | undefined {
  const compositions = snapshot.compositions.filter((composition) => !facts.compositionId || composition.id === facts.compositionId);
  return compositions.flatMap((composition) => composition.layers).find((layer) => layer.id === facts.layerId);
}

function instancesOf(layer: LayerSnapshot, matchName: string) {
  return flattenProperties(layer.properties).filter((property) => property.matchName === matchName && property.path.startsWith(`${PARADE}/`) && property.path.split("/").length === 2);
}

function ensureFacts(operation: JsonObject): EnsureFacts | undefined {
  if (operation.type !== "ensure_effect") return undefined;
  const target = objectAt(operation, "target");
  const matchName = nonEmpty(stringAt(operation, "effectMatchName"));
  const effectPath = nonEmpty(stringAt(target, "effectPath")) ?? nonEmpty(stringAt(operation, "effectPath"));
  const layerId = nonEmpty(stringAt(target, "layerId"));
  return matchName && effectPath && layerId ? { matchName, effectPath, layerId, compositionId: nonEmpty(stringAt(target, "compositionId")) } : undefined;
}

function noteFor(operation: JsonValue, snapshot: ProjectSnapshot, owned: ReadonlySet<string>): string | undefined {
  const facts = ensureFacts(asObject(operation) ?? {});
  if (!facts || owned.has(facts.layerId)) return undefined;
  const layer = layerOf(snapshot, facts);
  const instances = layer ? instancesOf(layer, facts.matchName) : [];
  const reused = instances.find((instance) => instance.path === facts.effectPath);
  if (!layer || !reused) return undefined;
  const name = reused.displayName || facts.matchName;
  const next = `${PARADE}/${escaped(facts.matchName)}#${instances.length + 1}`;
  return `ensure_effect at ${facts.effectPath} reuses the ${name} already on ${layer.name}: it adds nothing, and control writes under that path change that existing effect. If the request asked for a new ${name}, move this ensure and its control writes to ${next} with ae_queue_fix.`;
}

/** One note per queued ensure_effect that names an instance the layer already has. */
export function effectReuseNotes(operations: ReadonlyArray<JsonValue>, snapshot: ProjectSnapshot, ownedLayerIds: ReadonlySet<string> = new Set()): string[] {
  return operations.flatMap((operation) => noteFor(operation, snapshot, ownedLayerIds) ?? []);
}
