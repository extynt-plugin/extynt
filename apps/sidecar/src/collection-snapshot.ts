// The project snapshot a completed native read adds up to: layers, one local blur control or one effect creation, with coverage that says what stays unknown.
import { absentAs, decode, presentFields, decodeOrCode, jsonObject, jsonValue, nullable, object, optional } from "@extynt/decode";
import type { Infer, JsonObject, JsonValue } from "@extynt/decode";
import type { CollectionJob, CollectionPage, CollectionTicket, LayerAssembly } from "./collection-job.js";

const SNAPSHOT_CODE = "INVALID_COLLECTION_PAGE";
const BLUR_PATH = "ADBE Effect Parade/ADBE Gaussian Blur 2";
const hostFacts = object({ runtime: optional(jsonValue), project: optional(jsonValue), activeCompositionId: absentAs(nullable(jsonValue), null) });
const observedScene = object({ layer: jsonObject, composition: jsonObject });
const sceneIds = object({ id: optional(jsonValue), selected: optional(jsonValue) });
const blurFacts = object({ effectEnabled: optional(jsonValue), value: optional(jsonValue) });

interface Scene { host: JsonObject; layer: JsonObject; composition: JsonObject; layerId: JsonValue; compositionId: JsonValue | undefined; selected: JsonValue[] }

function scopedSnapshot(input: { page: CollectionPage; ticket: CollectionTicket; host: JsonObject; coverage: JsonObject; selected: JsonValue[]; compositions: JsonValue[]; warning: string }): JsonObject {
  const { page, ticket } = input;
  return {
    schemaVersion: "0.1", ok: true, requestId: ticket.id,
    result: {
      ...input.host, hostStamp: page.stamp.raw, revision: String(page.stamp.epoch) + ":" + String(page.stamp.revision),
      coverage: { ...input.coverage, collectionSessionId: page.sessionId }, selectedLayerIds: input.selected, compositions: input.compositions,
    },
    warnings: [input.warning],
  };
}

function hostOf(metadata: JsonObject): JsonObject {
  const facts = decodeOrCode(hostFacts, metadata, SNAPSHOT_CODE);
  return presentFields({ runtime: facts.runtime, project: facts.project, activeCompositionId: facts.activeCompositionId });
}

function sceneFrom(metadata: JsonObject, observed: Infer<typeof observedScene>): Scene | undefined {
  const layer = decode(sceneIds, observed.layer), composition = decode(sceneIds, observed.composition), host = hostOf(metadata);
  if (!layer.ok || !composition.ok) return undefined;
  const current = host.activeCompositionId === composition.value.id && !!layer.value.selected, layerId = layer.value.id ?? null;
  return { host, layer: observed.layer, composition: observed.composition, layerId, compositionId: composition.value.id, selected: current ? [layerId] : [] };
}

function sceneOf(page: CollectionPage): Scene | undefined {
  const metadata = page.metadata;
  if (metadata === undefined || page.nextCursor !== null) return undefined;
  const observed = decode(observedScene, metadata);
  return observed.ok ? sceneFrom(metadata, observed.value) : undefined;
}

function layerSnapshot(page: CollectionPage, ticket: CollectionTicket, job: CollectionJob, assembly: LayerAssembly): JsonObject | undefined {
  const { metadata, layers } = job;
  if (!assembly.complete || !metadata || !layers) return undefined;
  const host = hostOf(metadata.raw), current = host.activeCompositionId === metadata.compositionId;
  return scopedSnapshot({
    page, ticket, host,
    coverage: { kind: "composition-metadata", compositionId: metadata.compositionId, properties: "unknown", globalSelection: "unknown-outside-observed-targets", otherCompositions: "unknown" },
    selected: current ? layers.filter((layer) => layer.selected).map((layer) => layer.id) : [],
    compositions: [{ ...metadata.composition, layers: layers.map((layer) => layer.raw) }],
    warning: "Metadata coverage only; values, property dependencies and other compositions are unknown.",
  });
}

function creationSnapshot(page: CollectionPage, ticket: CollectionTicket, job: CollectionJob): JsonObject | undefined {
  const scene = job.target.kind === "effect-create" && page.localCreation !== undefined ? sceneOf(page) : undefined;
  if (!scene || page.localCreation === undefined) return undefined;
  return scopedSnapshot({
    page, ticket, host: scene.host,
    coverage: presentFields({
      kind: "composition-metadata", compositionId: scene.compositionId, properties: "unknown", otherCompositions: "unknown", otherLayers: "unknown",
      globalSelection: "unknown-outside-observed-targets", observedLayerIds: [scene.layerId], localCreation: page.localCreation,
    }),
    selected: scene.selected, compositions: [{ ...scene.composition, layers: [{ ...scene.layer, propertyPaths: [] }] }],
    warning: "Only exact local Gaussian creation availability is observed; other properties/dependencies remain unknown.",
  });
}

function blurProperties(local: JsonObject): JsonObject[] {
  const facts = decodeOrCode(blurFacts, local, SNAPSHOT_CODE), propertyPath = BLUR_PATH + "/ADBE Gaussian Blur 2-0001";
  return [
    presentFields({ path: BLUR_PATH, matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", kind: "effect", valueType: "unknown", value: null, canSetValue: false, enabled: facts.effectEnabled }),
    presentFields({ path: propertyPath, matchName: "ADBE Gaussian Blur 2-0001", displayName: "Blurriness", kind: "property", valueType: "number", value: facts.value, canSetValue: true, keyframeCount: 0, expression: "", expressionEnabled: false }),
  ];
}

function blurSnapshot(page: CollectionPage, ticket: CollectionTicket, job: CollectionJob): JsonObject | undefined {
  const scene = job.target.kind === "blur" && page.localEffect !== undefined ? sceneOf(page) : undefined;
  if (!scene || page.localEffect === undefined) return undefined;
  return scopedSnapshot({
    page, ticket, host: scene.host,
    coverage: presentFields({
      kind: "composition-metadata", compositionId: scene.compositionId, properties: "unknown", globalSelection: "unknown-outside-observed-targets",
      otherCompositions: "unknown", otherLayers: "unknown", observedLayerIds: [scene.layerId], localEffect: page.localEffect,
    }),
    selected: scene.selected, compositions: [{ ...scene.composition, layers: [{ ...scene.layer, propertyPaths: blurProperties(page.localEffect) }] }],
    warning: "Local literal assignment only; downstream expressions and rendered output remain unknown.",
  });
}

/** The snapshot a read yields once it is complete for its kind (a blur page, an effect-creation page or a finished layer inventory), otherwise undefined. */
export function collectionSnapshot(page: CollectionPage, ticket: CollectionTicket, job: CollectionJob, assembly: LayerAssembly): JsonObject | undefined {
  return blurSnapshot(page, ticket, job) ?? creationSnapshot(page, ticket, job) ?? layerSnapshot(page, ticket, job, assembly);
}
