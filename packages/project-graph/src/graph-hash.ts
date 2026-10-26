/**
 * The project fingerprint is a Merkle hash: every layer has a digest of its own, a composition hashes its own fields with
 * its layers' digests standing in for the layers, and the project hashes its own fields with the compositions' digests and
 * the item and source lists' digests. A caller that reads the same project over and over passes a memo, and only the
 * layers it has not seen before are hashed again.
 *
 * The order of the compositions, items and sources is not content: After Effects keeps the project panel sorted by name and
 * lists a new item in a different place right after it is made than a read taken later does, so the same project would
 * otherwise have two fingerprints. Those three lists hash as sets; the order of layers and properties still counts.
 */
import { isJsonArray, isJsonObject } from "@extynt/decode";
import { digestList, encodeCompositionShell, encodeLayer, encodeValue, sha256Hex, VOLATILE_SNAPSHOT_FIELDS } from "./canonical.js";
import type { JsonArray, JsonObject, JsonValue } from "@extynt/decode";

/** The fingerprint format in force. A value in any other format is from an earlier version: it never equals a current one, so whatever carries it is stale. */
export const FINGERPRINT_PREFIX = "fp3-";
const CURRENT_FINGERPRINT = /^fp3-[0-9a-f]{32}$/;
const LEGACY_FINGERPRINT = /^(?:[0-9a-f]{8}|fp2-[0-9a-f]{32})$/;

/** Whether `value` is a fingerprint in the format in force. */
export function isCurrentFingerprint(value: JsonValue | undefined): value is string {
  return typeof value === "string" && CURRENT_FINGERPRINT.test(value);
}

/** Whether `value` is a fingerprint of an earlier version: the 8-hex-digit FNV-1a hash, or the `fp2-` Merkle hash that took the order of compositions and items as content. */
export function isLegacyFingerprint(value: JsonValue | undefined): value is string {
  return typeof value === "string" && LEGACY_FINGERPRINT.test(value);
}

/** The short, prefixed form of a digest. 128 bits: collisions are not a practical concern. */
export function fingerprintOf(text: string): string {
  return FINGERPRINT_PREFIX + sha256Hex(text).slice(0, 32);
}

/** Digests remembered per object. Only a deep-frozen object is ever remembered or served (`freezeDeep`): an object that can still change cannot vouch for a digest taken earlier, so it is always hashed again. */
export type FingerprintMemo = {
  readonly layers: WeakMap<JsonObject, string>;
  readonly groups: WeakMap<JsonObject | JsonArray, string>;
};

/** An empty memo for a caller that hashes the same project over and over. */
export function createFingerprintMemo(): FingerprintMemo {
  return { layers: new WeakMap(), groups: new WeakMap() };
}

/** Freezes `value` and everything reachable from it; an already-frozen object is taken as frozen all the way down. */
export function freezeDeep<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freezeDeep);
  return value;
}

function remembered<Key extends JsonObject | JsonArray>(table: WeakMap<Key, string> | undefined, key: Key, compute: () => string): string {
  if (!table || !Object.isFrozen(key)) return compute();
  let digest = table.get(key);
  if (digest === undefined) {
    digest = compute();
    table.set(key, digest);
  }
  return digest;
}

function textDigest(value: JsonValue | undefined): string {
  return sha256Hex(encodeValue(value) ?? "null");
}

function layerDigest(layer: JsonValue, memo: FingerprintMemo | undefined): string {
  return isJsonObject(layer) ? remembered(memo?.layers, layer, () => sha256Hex(encodeLayer(layer))) : textDigest(layer);
}

function compositionDigest(composition: JsonValue, memo: FingerprintMemo | undefined): string {
  if (!isJsonObject(composition)) return textDigest(composition);
  const layers = composition.layers;
  return sha256Hex(encodeCompositionShell(composition, isJsonArray(layers) ? layers.map((layer) => layerDigest(layer, memo)) : null));
}

function digestSet(digests: readonly string[]): string {
  return digestList([...digests].sort());
}

function groupDigest(value: JsonArray, memo: FingerprintMemo | undefined): string {
  return remembered(memo?.groups, value, () => sha256Hex(digestSet(value.map(textDigest))));
}

function projectField(snapshot: JsonObject, key: string, memo: FingerprintMemo | undefined): string | undefined {
  const value = snapshot[key];
  if (key === "compositions" && isJsonArray(value)) return digestSet(value.map((composition) => compositionDigest(composition, memo)));
  if ((key === "items" || key === "sources") && isJsonArray(value)) return `"${groupDigest(value, memo)}"`;
  return encodeValue(value);
}

function projectText(snapshot: JsonObject, memo: FingerprintMemo | undefined): string {
  let text = "{";
  let first = true;
  for (const key of Object.keys(snapshot).sort()) {
    if (VOLATILE_SNAPSHOT_FIELDS.has(key)) continue;
    const field = projectField(snapshot, key, memo);
    if (field === undefined) continue;
    text += `${first ? "" : ","}${JSON.stringify(key)}:${field}`;
    first = false;
  }
  return `${text}}`;
}

/**
 * The project's fingerprint: equal for equal content however its keys are ordered, different for any change to an
 * included field. The compositions, items and sources hash as sets.
 */
export function projectFingerprint(snapshot: JsonObject, memo?: FingerprintMemo): string {
  return fingerprintOf(projectText(snapshot, memo));
}
