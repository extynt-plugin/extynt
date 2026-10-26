// The evidence the host returned for one applied step: the fields the verifiers scan across steps, decoded once, and the raw row for the fields one kind reads.
import { boolean, decode, fallback, jsonValue, nullable, number, object, optional, skippingInvalid, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import { textField } from "./json-fields.js";

const text = optional(fallback(string(), undefined));

const specRow = object({ path: text, afterKeys: optional(fallback(number(), undefined)), value: optional(fallback(jsonValue, undefined)), keys: optional(fallback(jsonValue, undefined)) });

const stepFields = object({
  operation: text,
  compositionId: text,
  layerId: text,
  itemId: text,
  folderId: text,
  propertyPath: text,
  effectPath: text,
  requestedCompositionId: text,
  requestedNewCompositionId: text,
  newCompositionId: text,
  requestedLayerId: text,
  requestedFolderId: text,
  requestedItemId: text,
  requestedMaskId: text,
  requestedGroupId: text,
  carrierLayerId: text,
  verification: text,
  mode: text,
  file: text,
  bytes: optional(fallback(number(), undefined)),
  enabled: optional(fallback(boolean(), undefined)),
  observedEnabled: optional(fallback(boolean(), undefined)),
  observedValue: optional(fallback(jsonValue, undefined)),
  containerPath: text,
  name: text,
  parentFolderId: optional(fallback(nullable(string()), undefined)),
  created: optional(fallback(boolean(), undefined)),
  afterValue: optional(fallback(jsonValue, undefined)),
  afterKeys: optional(fallback(number(), undefined)),
  afterDigest: text,
  expressionKeysReferenced: text,
  writes: optional(fallback(skippingInvalid(specRow), undefined)),
  animations: optional(fallback(skippingInvalid(specRow), undefined)),
});

/** One property the host re-read after a structured write: where it is and what it held. */
export type SpecRow = Infer<typeof specRow>;

/** One applied step: the common evidence decoded, and the whole row for the evidence a single kind reads. */
export type HostStep = Infer<typeof stepFields> & { readonly row: JsonObject };

/** The evidence a step row carries; a row that cannot be decoded still names its operation so every step keeps its place. */
export function hostStepOf(row: JsonObject): HostStep {
  const decoded = decode(stepFields, row);
  return decoded.ok ? { ...decoded.value, row } : { operation: textField(row, "operation"), row };
}

const KEY_WRITERS: ReadonlySet<string | undefined> = new Set(["animate_property", "animate_control"]);

/** Whether the step wrote keyframes: an animate_property or animate_control. */
export function isKeyWriter(step: HostStep): boolean {
  return KEY_WRITERS.has(step.operation);
}

/** The step that stands in for an operation the host returned no evidence for. */
export const NO_STEP: HostStep = { row: {} };

/** The detail every host-evidence verdict carries: which check the host itself ran for this step. */
export function hostVerification(step: HostStep): { readonly hostVerification: string | null } {
  return { hostVerification: step.verification ?? null };
}
