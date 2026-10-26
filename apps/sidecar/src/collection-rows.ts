// Validation and staging of the rows of one native collection page: each row is checked for its kind and prepared for retention, none is kept until every row passes.
import { decodeOrCode, jsonObject, jsonValue, object, optional, type JsonValue } from "@extynt/decode";
import { collectionDescriptor, collectionValue } from "./collection-types.js";
import { boundedText } from "./native-field-decoders.js";
import { validateEffectContext } from "./effect-context.js";
import type { CollectionPage, RetainedCollectionRow } from "./collection-job.js";
import type { CollectionTarget } from "./collection-request.js";

const ROW_CODE = "INVALID_COLLECTION_ROW";
const MAX_ROW_BYTES = 16384;
const identity = object({ id: boundedText(4096), name: boundedText(4096) });
const contextOf = object({ effectContext: optional(jsonValue) });

function retainedKey(target: CollectionTarget, id: string): string {
  return JSON.stringify([target.kind, target.compositionId ?? null, target.layerId ?? null, target.propertyIndices ?? null, id]);
}

function stageRow(input: JsonValue, target: CollectionTarget, stamp: CollectionPage["stamp"]): RetainedCollectionRow {
  const source = decodeOrCode(jsonObject, input, ROW_CODE), { id } = decodeOrCode(identity, source, ROW_CODE);
  if (target.kind === "values") collectionValue(source);
  if (target.kind === "properties") validateEffectContext(decodeOrCode(contextOf, source, ROW_CODE).effectContext, collectionDescriptor(source).indices);
  const stored = { ...source, stamp: stamp.raw }, bytes = Buffer.byteLength(JSON.stringify(stored));
  if (bytes > MAX_ROW_BYTES) throw Error("COLLECTION_ROW_BYTE_LIMIT");
  return { key: retainedKey(target, id), source, stored, bytes };
}

/** Validates every row of a page against the target's kind and prepares it for retention; one bad row rejects the page. */
export function stageCollectionRows(page: CollectionPage, target: CollectionTarget): RetainedCollectionRow[] {
  return page.rows.map((row) => stageRow(row, target, page.stamp));
}
