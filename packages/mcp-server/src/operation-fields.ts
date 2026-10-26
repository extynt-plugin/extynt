// The editable copy of one operation that the composer's corrections and family handlers shape.
import { isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";

/** An operation's fields while a correction or a family handler edits its own copy. */
export interface OperationFields {
  [key: string]: JsonValue;
}

/** A fresh editable copy of a JSON object; the caller's own object is never edited. */
export function copyFields(source: JsonObject): OperationFields {
  return { ...source };
}

/** An editable copy of the value when it is a JSON object, otherwise `undefined`. */
export function fieldsOf(value: JsonValue | undefined): OperationFields | undefined {
  return isJsonObject(value) ? copyFields(value) : undefined;
}

/** After Effects stores a text document's line breaks as CR: normalizing before validation and the digest keeps the approved plan and the applied layer in agreement. */
export function normalizeTextLineBreaks(candidate: OperationFields): void {
  const type = candidate.type;
  const text = candidate.text;
  if ((type === "set_text_document" || type === "create_layer") && typeof text === "string") candidate.text = text.replace(/\r\n|\n/g, "\r");
}
