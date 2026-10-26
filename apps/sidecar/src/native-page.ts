// The facts the sidecar reads from a native collection page: stamp, rows, project and host identity, each decoded leniently from open JSON.
import { createHash } from "node:crypto";
import { decode, decodeOrThrow, fallback, isJsonObject, jsonValue, number, object, optional, string } from "@extynt/decode";
import type { Decoder, Infer, JsonObject, JsonValue } from "@extynt/decode";
import { integerFrom, ordinalList } from "./native-field-decoders.js";
import type { CollectionPage } from "./collection-job.js";
import { wireObject } from "./wire-object.js";

const TEXT_LIMIT = 4096;
const NO_ROW: JsonObject = {};
const sessionText = textOr("");

/** A string of at most 4096 characters, or the fallback. */
export function textOr<Otherwise>(otherwise: Otherwise): Decoder<string | Otherwise> {
  return fallback(string({ maxLength: TEXT_LIMIT }), otherwise);
}

/** A native count or ordinal that may be zero, or null. */
export const countOrNull: Decoder<number | null> = fallback(integerFrom(0), null);

/** A finite number, or null. */
export const numberOrNull: Decoder<number | null> = fallback(number(), null);

/** The native indices at one position: at most 16 ordinals, or empty when the list is malformed. */
export const indicesOrEmpty: Decoder<number[]> = fallback(ordinalList({ minLength: 0, maxLength: 16 }), []);

/** A page as the graph observes it: a collection page whose rows are known to be objects. */
export interface ObservedPage extends Omit<CollectionPage, "rows"> { rows: JsonObject[] }

function objectOrEmpty(field: JsonValue | undefined): JsonObject {
  return isJsonObject(field) ? field : NO_ROW;
}

function rowsOrUndefined(field: JsonValue | undefined): JsonObject[] | undefined {
  return Array.isArray(field) ? field.map(objectOrEmpty) : undefined;
}

interface PageFacts { rows: JsonObject[] | undefined; sessionId: string; stamp: { epoch: number | null; revision: number | null } }

/** Reads the rows, session id and stamp of a decoded page; a malformed field reads as undefined, empty or null. */
export function pageFactsOf(page: JsonObject): PageFacts {
  const stamp = objectOrEmpty(page.stamp);
  return {
    rows: rowsOrUndefined(page.rows), sessionId: decodeOrThrow(sessionText, page.sessionId),
    stamp: { epoch: decodeOrThrow(countOrNull, stamp.epoch), revision: decodeOrThrow(countOrNull, stamp.revision) },
  };
}

/** A page as the graph observes it, read leniently from open JSON; undefined when it has no row list or no epoch. */
export function observedPage(input: JsonValue): ObservedPage | undefined {
  const raw = decode(wireObject, input);
  if (!raw.ok) return undefined;
  const facts = pageFactsOf(raw.value);
  if (facts.stamp.epoch === null || facts.rows === undefined) return undefined;
  const stamp = objectOrEmpty(raw.value.stamp);
  return {
    raw: raw.value, sessionId: facts.sessionId, rows: facts.rows, nextCursor: null,
    stamp: { epoch: facts.stamp.epoch, revision: facts.stamp.revision, raw: stamp, key: JSON.stringify(stamp) },
    kind: undefined, totalItems: undefined, metadata: undefined, localCreation: undefined, localEffect: undefined,
  };
}

const projectInfo = fallback(object({ filePath: textOr(""), name: textOr("Untitled") }), { filePath: "", name: "Untitled" });
const hostRuntime = fallback(object({ application: textOr("After Effects"), appVersion: textOr("unknown"), platform: textOr("unknown") }), { application: "After Effects", appVersion: "unknown", platform: "unknown" });
const metadataParts = object({ project: optional(jsonValue), runtime: optional(jsonValue) });
const NO_METADATA: Infer<typeof metadataParts> = {};
const epochParts = object({ epoch: optional(jsonValue) });
const NO_EPOCH: Infer<typeof epochParts> = {};
const identityFacts = object({
  project: optional(jsonValue), runtime: optional(jsonValue), metadata: fallback(metadataParts, NO_METADATA),
  stamp: fallback(epochParts, NO_EPOCH),
});

/** The project a page describes: a saved file by path and host, an unsaved one by session and epoch. */
export interface GraphProject { id: string; path: string | null; name: string; version: string; platform: string }

/** Identifies the project a page describes without trusting any single field of it. */
export function pageProject(page: JsonObject, session: string): GraphProject {
  const facts = decodeOrThrow(identityFacts, page);
  const info = decodeOrThrow(projectInfo, facts.project ?? facts.metadata.project);
  const runtime = decodeOrThrow(hostRuntime, facts.runtime ?? facts.metadata.runtime);
  const path = info.filePath || null;
  const identity = path === null ? `unsaved\0${session}\0${String(facts.stamp.epoch)}` : `saved\0${runtime.platform}\0${runtime.appVersion}\0${path}`;
  return { id: createHash("sha256").update(identity).digest("hex"), path, name: info.name, version: runtime.appVersion, platform: runtime.platform };
}

/** The host a page was read from, as `application:version:platform`. */
export function pageHostKey(page: JsonObject): string {
  const facts = decodeOrThrow(identityFacts, page);
  const runtime = decodeOrThrow(hostRuntime, facts.runtime ?? facts.metadata.runtime);
  return `${runtime.application}:${runtime.appVersion}:${runtime.platform}`;
}
