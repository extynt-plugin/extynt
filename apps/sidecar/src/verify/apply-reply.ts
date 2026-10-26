// The decoders for the host's answer to an apply or an undo: a success that names the steps or method, or a failure that says whether the project may have changed.
import { array, boolean, fallback, jsonObject, jsonValue, literal, map, number, object, optional, skippingInvalid, string, union } from "@extynt/decode";
import type { Decoder, Infer, JsonObject, JsonValue } from "@extynt/decode";
import { hostFrameChecks } from "./frame-check.js";
import { textField } from "./json-fields.js";
import { hostStepRow } from "./step-reply.js";

/** What the host said went wrong: its code and message as text, and every other field it sent. */
export interface HostErrorBody {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly [field: string]: JsonValue | undefined;
}

function toErrorBody(row: JsonObject): HostErrorBody {
  return { ...row, code: textField(row, "code"), message: textField(row, "message") };
}

const errorBody: Decoder<HostErrorBody> = map(jsonObject, toErrorBody);

const outcomeFields = {
  mutationState: optional(fallback(string(), undefined)),
  phase: optional(fallback(string(), undefined)),
  failedOperationIndex: optional(fallback(number(), undefined)),
  failedOperation: optional(fallback(string(), undefined)),
  undoGroups: optional(fallback(number(), undefined)),
  changedUndoGroups: optional(fallback(number(), undefined)),
  batchSize: optional(fallback(number(), undefined)),
  receipt: optional(fallback(object({ rollback: optional(fallback(string(), undefined)) }), undefined)),
  creationEvidence: optional(fallback(jsonValue, undefined)),
  externalOutputs: optional(fallback(array(jsonValue), undefined)),
  managedSources: optional(fallback(array(jsonValue), undefined)),
  metadataReadback: optional(fallback(jsonValue, undefined)),
  frameChecks: optional(fallback(hostFrameChecks, undefined)),
  mayHaveMutated: optional(fallback(boolean(), undefined)),
};

const applySuccess = object({ ...outcomeFields, ok: literal(true), steps: array(hostStepRow, { minLength: 1 }) });
const undoSuccess = object({ ...outcomeFields, ok: literal(true), method: string() });
const failure = object({ ...outcomeFields, ok: literal(false), mayHaveMutated: boolean(), error: errorBody, steps: optional(fallback(skippingInvalid(jsonObject), undefined)) });

/** An apply that ran: the steps the host applied, at least one. */
export type HostApplySuccess = Infer<typeof applySuccess>;
/** An undo that ran: the method the host undid with. */
export type HostUndoSuccess = Infer<typeof undoSuccess>;
/** An apply or undo that did not complete: whether the project may have changed, and why. */
export type HostFailure = Infer<typeof failure>;

/** The host's answer to an apply: a success with steps, or a failure that says whether the project may have changed. */
export const applyReply: Decoder<HostApplySuccess | HostFailure> = union(applySuccess, failure);
/** The host's answer to an undo: a success with its method, or a failure that says whether the project may have changed. */
export const undoReply: Decoder<HostUndoSuccess | HostFailure> = union(undoSuccess, failure);
