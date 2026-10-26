/** Snapshot construction and identity: stable text, content and selection fingerprints, and the canonical reference form of a snapshot. */
import { isJsonObject, isJsonArray, type JsonObject, type JsonValue } from "@extynt/decode";
import { isSampledProperty, VOLATILE_SNAPSHOT_FIELDS } from "./canonical.js";
import { fingerprintOf, projectFingerprint, type FingerprintMemo } from "./graph-hash.js";
import type { ProjectSnapshot, SnapshotInput } from "./model.js";

type JsonMapper = (value: JsonValue) => JsonValue;

/** Deterministic JSON encoding with object keys sorted recursively; a missing value is written as null. */
export function stableStringify<Value>(value: Value): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1)).map(([key, member]) => `${JSON.stringify(key)}:${stableStringify(member)}`).join(",")}}`;
}

/** A merkle hash of the project content (see `graph-hash.ts`); `memo` lets a caller that hashes the same frozen layers again skip them. */
export function graphFingerprint(input: SnapshotInput | ProjectSnapshot, memo?: FingerprintMemo): string {
  return projectFingerprint(input, memo);
}

/** Stable identity for the volatile UI selection, kept separate from graph identity. */
export function selectionFingerprint(input: SnapshotInput | ProjectSnapshot): string {
  return fingerprintOf(stableStringify({
    activeCompositionId: input.activeCompositionId,
    selection: input.selection,
  }));
}

function jsonClone(value: JsonValue | undefined): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (isJsonArray(value)) return value.map((item) => jsonClone(item) ?? null);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, member]) => {
    const copy = jsonClone(member);
    return copy === undefined ? [] : [[key, copy]];
  }));
}

function withoutKeys(record: JsonObject, dropped: (key: string) => boolean): JsonObject {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !dropped(key)));
}

function mapMembers(record: JsonObject, key: string, map: JsonMapper): JsonObject {
  const members = record[key];
  return Array.isArray(members) ? { ...record, [key]: members.map(map) } : record;
}

function whenObject(map: (record: JsonObject) => JsonObject): JsonMapper {
  return (value) => (isJsonObject(value) ? map(value) : value);
}

const canonicalProperty: JsonMapper = whenObject((property) => {
  const kept = isSampledProperty(property) ? withoutKeys(property, (key) => key === "value") : property;
  return mapMembers(kept, "children", (child) => canonicalProperty(child));
});

const canonicalLayer: JsonMapper = whenObject((layer) => mapMembers(withoutKeys(layer, (key) => key === "isSelected"), "properties", canonicalProperty));

const canonicalComposition: JsonMapper = whenObject((composition) => mapMembers(withoutKeys(composition, (key) => key === "currentTime"), "layers", canonicalLayer));

/**
 * The reference form of the rules `graphFingerprint` applies while it serialises: the snapshot a fingerprint is of, with
 * what it ignores removed. The fields in `VOLATILE_SNAPSHOT_FIELDS`, each composition's current time, the layer selection
 * flag and the sampled values of keyframed or expression-driven properties never affect a plan precondition. Array order
 * is retained here; the fingerprint alone reads the compositions, items and sources as sets (`graph-hash.ts`), since
 * AE's order for those is not content, while layer and property order still is.
 */
export function canonicalSnapshot(input: SnapshotInput | ProjectSnapshot): JsonObject {
  const clone = jsonClone(input);
  if (!isJsonObject(clone)) throw new Error("A snapshot must be an object to be canonicalised.");
  return mapMembers(withoutKeys(clone, (key) => VOLATILE_SNAPSHOT_FIELDS.has(key)), "compositions", canonicalComposition);
}

/** A deterministic revision suitable for comparing two observed snapshots. */
export function snapshotRevision(input: SnapshotInput | ProjectSnapshot): string {
  return graphFingerprint(input);
}

/** The snapshot an input describes, completed with its freshness and its selection and content fingerprints; `memo` is passed on to the content hash. */
export function createSnapshot(input: SnapshotInput, memo?: FingerprintMemo): ProjectSnapshot {
  const snapshot = { ...input, schemaVersion: "0.1" as const };
  const freshness = snapshot.freshness ?? { revision: snapshot.revision, capturedAt: snapshot.capturedAt, receivedAt: null };
  return {
    ...snapshot,
    freshness,
    selectionFingerprint: selectionFingerprint(snapshot),
    fingerprint: graphFingerprint(snapshot, memo),
  };
}

const REQUIRED_STRING_FIELDS = ["fingerprint", "selectionFingerprint", "revision"] as const;

/** Whether `value` has the shape of a current snapshot: its schema version, its fingerprints and revision as strings, a freshness object and a composition list. The shape is checked, not every nested field. */
export function isProjectSnapshot(value: JsonValue | undefined): value is ProjectSnapshot {
  return isJsonObject(value) && value.schemaVersion === "0.1" &&
    REQUIRED_STRING_FIELDS.every((field) => typeof value[field] === "string") &&
    isJsonObject(value.freshness) && isJsonArray(value.compositions);
}
