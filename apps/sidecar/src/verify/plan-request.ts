// The plan operation as the verifiers read it: the fields every kind shares, decoded once, and the raw row for the fields only one kind reads.
import { array, boolean, decode, fallback, jsonObject, jsonValue, nullable, number, object, optional, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import { textField } from "./json-fields.js";

const text = optional(fallback(string(), undefined));
const link = optional(fallback(nullable(string()), undefined));
const count = optional(fallback(number(), undefined));
const flag = optional(fallback(boolean(), undefined));

const target = object({ compositionId: text, layerId: text, itemId: text, propertyPath: text, effectPath: text });

const requestFields = object({
  operation: string(),
  target: optional(fallback(target, undefined)),
  compositionId: text,
  layerId: text,
  itemId: text,
  propertyPath: text,
  effectPath: text,
  newCompositionId: text,
  newLayerId: text,
  newFolderId: text,
  newItemId: text,
  newMaskId: text,
  newGroupId: text,
  maskId: text,
  groupId: text,
  referenceLayerId: text,
  effectMatchName: text,
  role: text,
  name: text,
  layerType: text,
  placement: text,
  mode: text,
  style: text,
  styleMatchName: text,
  kind: text,
  field: text,
  setting: text,
  option: text,
  source: text,
  parentLayerId: link,
  matteLayerId: link,
  folderId: link,
  time: count,
  inPoint: count,
  outPoint: count,
  startTime: count,
  stretch: count,
  opacity: count,
  width: count,
  levelDb: count,
  enabled: flag,
  showMatteLayer: flag,
  relative: flag,
  value: optional(fallback(jsonValue, undefined)),
  expression: optional(fallback(jsonValue, undefined)),
  comment: optional(fallback(jsonValue, undefined)),
  duration: optional(fallback(jsonValue, undefined)),
  chapter: optional(fallback(jsonValue, undefined)),
  url: optional(fallback(jsonValue, undefined)),
  cuePointName: optional(fallback(jsonValue, undefined)),
  label: optional(fallback(jsonValue, undefined)),
  options: optional(fallback(jsonObject, undefined)),
  values: optional(fallback(jsonObject, undefined)),
  settings: optional(fallback(jsonObject, undefined)),
  layerIds: optional(fallback(array(string()), undefined)),
});

/** One plan operation: the common fields decoded, and the whole row for the fields a single kind reads. */
export type Request = Infer<typeof requestFields> & { readonly row: JsonObject };

/** The request a row makes; a row that cannot be decoded still names its operation so every step keeps its place. */
export function requestOf(row: JsonObject): Request {
  const decoded = decode(requestFields, row);
  return decoded.ok ? { ...decoded.value, row } : { operation: textField(row, "operation") ?? "", row };
}
