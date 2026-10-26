// Validation of one native collection page and of the not-started acknowledgement; a page that does not fit throws its INVALID_COLLECTION_* code.
import { array, decode, decodeOrCode, fallback, jsonObject, jsonValue, literal, map, nullValue, number, object, optional, refine, string, union } from "@extynt/decode";
import type { Infer, JsonObject, JsonValue } from "@extynt/decode";
import { blurControls } from "./graph-control-observation.js";
import { boundedText, ordinal } from "./native-field-decoders.js";
import { collectionNativeDescriptor } from "./collection-types.js";
import { validateEffectContext } from "./effect-context.js";
import type { CollectionJob, CollectionPage, CollectionTicket, PageStamp } from "./collection-job.js";
import type { CollectionTarget } from "./collection-request.js";

const PAGE_CODE = "INVALID_COLLECTION_PAGE";
const STAMP_CODE = "INVALID_COLLECTION_STAMP";
const MAX_PAGE_CHARACTERS = 131072;
const FAILURE_CODE = /^[A-Z_]{1,64}$/;
const nativeFailure = object({ ok: literal(false), error: object({ code: refine(string(), (code): code is string => FAILURE_CODE.test(code), "failure code") }) });
const transportFailure = object({ error: object({ code: literal("HOST_TIMEOUT", "HOST_QUARANTINED", "HOST_DISPATCH_UNKNOWN") }) });
const optionalObject = fallback(jsonObject, undefined);
const pageHeader = object({
  ok: literal(true), requestId: string(), sessionId: boundedText(256), rows: map(array(jsonValue), (rows) => [...rows]),
  deepComplete: literal(false), nextCursor: union(nullValue, ordinal), stamp: fallback(jsonValue, undefined),
  kind: fallback(string(), undefined), totalItems: fallback(number(), undefined),
  metadata: optionalObject, localCreation: optionalObject, localEffect: optionalObject,
});
const stampParts = object({ epoch: ordinal, revision: union(nullValue, ordinal) });
const contextParts = object({ effectContext: optional(jsonValue), nativeDescriptor: optional(jsonValue) });
const notStarted = object({
  outcome: object({ schemaVersion: literal("collection-dispatch-outcome/1"), kind: literal("native-not-started"), requestId: string(), generation: number() }),
  page: optional(jsonValue),
});

function rejectNativePageFailure(page: JsonValue | undefined): void {
  const failure = decode(nativeFailure, page);
  if (failure.ok) throw Error(failure.value.error.code);
}

function pageStamp(value: JsonValue | undefined): PageStamp {
  const raw = decodeOrCode(jsonObject, value, STAMP_CODE);
  const parts = decodeOrCode(stampParts, raw, STAMP_CODE);
  return { epoch: parts.epoch, revision: parts.revision, raw, key: JSON.stringify(raw) };
}

function validateContext(raw: JsonObject, target: CollectionTarget): void {
  if (target.kind === "blur") { blurControls(raw); return; }
  if (target.kind !== "values") return;
  const context = decodeOrCode(contextParts, raw, PAGE_CODE);
  validateEffectContext(context.effectContext, target.propertyIndices);
  if (context.nativeDescriptor === undefined) return;
  collectionNativeDescriptor(decodeOrCode(jsonObject, context.nativeDescriptor, "INVALID_COLLECTION_DESCRIPTOR"));
}

function pageMismatch(header: Infer<typeof pageHeader>, raw: JsonObject, pending: CollectionTicket, job: CollectionJob): boolean {
  const wrongSession = job.sessionId !== undefined && job.sessionId !== "" && header.sessionId !== job.sessionId;
  const advances = header.nextCursor === null || header.nextCursor > pending.cursor;
  return header.requestId !== pending.id || wrongSession || header.rows.length > pending.maxRows || !advances || JSON.stringify(raw).length > MAX_PAGE_CHARACTERS;
}

/** Validates a page against its ticket, job and target; the page is returned only if every check passes. */
export function validateCollectionPage(input: JsonValue | undefined, pending: CollectionTicket, job: CollectionJob): CollectionPage {
  rejectNativePageFailure(input);
  const raw = decodeOrCode(jsonObject, input, PAGE_CODE);
  const header = decodeOrCode(pageHeader, raw, PAGE_CODE);
  if (pageMismatch(header, raw, pending, job)) throw Error(PAGE_CODE);
  const stamp = pageStamp(header.stamp);
  validateContext(raw, job.target);
  return {
    raw, sessionId: header.sessionId, rows: header.rows, nextCursor: header.nextCursor, stamp, kind: header.kind, totalItems: header.totalItems,
    metadata: header.metadata, localCreation: header.localCreation, localEffect: header.localEffect,
  };
}

/** The transport failure code a page reports, when the page says the native call timed out, was quarantined or may have run. */
export function collectionTransportFailure(page: JsonValue | undefined): string | undefined {
  const failure = decode(transportFailure, page);
  return failure.ok ? failure.value.error.code : undefined;
}

/** Checks that a not-started acknowledgement names this ticket and generation, carries no page and arrives outside quarantine. */
export function validateCollectionOutcome(input: JsonValue | undefined, pending: CollectionTicket, quarantined: boolean): void {
  const parsed = decode(notStarted, input);
  const valid = parsed.ok && parsed.value.page === undefined && parsed.value.outcome.requestId === pending.id && parsed.value.outcome.generation === pending.generation;
  if (!valid || quarantined) throw Error("INVALID_COLLECTION_DISPATCH_OUTCOME");
}
