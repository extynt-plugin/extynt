// The on-disk event-log format: the envelope, its checksum and the decoding that turns stored text into trusted events or a named storage error.

import { createHash } from "node:crypto";
import { array, decode, decodeJson, decodeOrThrow, number, object, refine, string } from "@extynt/decode";
import type { DecodeError, Decoder, Infer } from "@extynt/decode";
import { boundedJson, signature } from "./canonical-json.js";
import { WorkflowStorageError } from "./errors.js";
import { PASSTHROUGH, WORKFLOW_EVENT } from "./event-decoders.js";
import type { WorkflowEvent } from "./events.js";
import { MAX_WORKFLOW_EVENT_LOG_BYTES, MAX_WORKFLOW_EVENT_SIGNATURES, WORKFLOW_SCHEMA_VERSION } from "./limits.js";

/** The format marker written into every storage file. */
export const WORKFLOW_STORAGE_FORMAT = "extynt.workflow.event-log" as const;

/** The envelope version this build reads and writes. */
export const WORKFLOW_STORAGE_VERSION = 1 as const;

/** The largest storage file, in UTF-8 bytes, that is parsed at all. */
export const MAX_WORKFLOW_STORAGE_BYTES = MAX_WORKFLOW_EVENT_LOG_BYTES + 1024 * 1024;

interface WorkflowStorageEnvelope {
  readonly format: typeof WORKFLOW_STORAGE_FORMAT;
  readonly storageVersion: typeof WORKFLOW_STORAGE_VERSION;
  readonly workflowSchemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  readonly generation: number;
  readonly events: readonly WorkflowEvent[];
  readonly checksum: string;
}

type ChecksummedFields = Omit<WorkflowStorageEnvelope, "checksum">;

const WITHIN_BOUNDS = "an event within structural bounds";
const INVALID_JSON = "valid JSON text";

function withinStructuralBounds(event: WorkflowEvent): event is WorkflowEvent {
  try {
    decodeOrThrow(boundedJson("stored workflow event"), event);
    return true;
  } catch {
    return false;
  }
}

function isGeneration(value: number): value is number {
  return Number.isSafeInteger(value) && value >= 0;
}

function isChecksum(value: string): value is string {
  return /^[a-f0-9]{64}$/.test(value);
}

const storedEvent: Decoder<WorkflowEvent> = refine(WORKFLOW_EVENT, withinStructuralBounds, WITHIN_BOUNDS);

const ENVELOPE_PARTS = object({ format: PASSTHROUGH, storageVersion: PASSTHROUGH, workflowSchemaVersion: PASSTHROUGH, generation: PASSTHROUGH, events: PASSTHROUGH, checksum: PASSTHROUGH });

const ENVELOPE_BODY = object({
  generation: refine(number(), isGeneration, "a non-negative safe integer"),
  events: array(storedEvent, { maxLength: MAX_WORKFLOW_EVENT_SIGNATURES }),
  checksum: refine(string(), isChecksum, "a sha256 hex digest"),
});

function digestFields(fields: ChecksummedFields): string {
  return createHash("sha256").update(signature(fields)).digest("hex");
}

/** Wraps the events in a versioned, checksummed envelope. */
export function createStorageEnvelope(events: readonly WorkflowEvent[], generation: number): WorkflowStorageEnvelope {
  const fields: ChecksummedFields = { format: WORKFLOW_STORAGE_FORMAT, storageVersion: WORKFLOW_STORAGE_VERSION, workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION, generation, events };
  return { ...fields, checksum: digestFields(fields) };
}

function incompatible(message: string): never {
  throw new WorkflowStorageError("INCOMPATIBLE_VERSION", message);
}

function corrupt(message: string, error?: DecodeError): never {
  throw new WorkflowStorageError("CORRUPT_STORAGE", message, error === undefined ? undefined : { cause: new Error(error.message) });
}

function bodyProblem(error: DecodeError): string {
  if (error.path.startsWith("$.generation")) return "Workflow storage generation is invalid.";
  if (error.path.startsWith("$.checksum")) return "Workflow storage checksum is invalid.";
  return error.expected === WITHIN_BOUNDS ? "A stored workflow event exceeds structural bounds." : "Workflow storage events are structurally invalid.";
}

function envelopeParts(serialized: string): Infer<typeof ENVELOPE_PARTS> {
  const result = decodeJson(serialized, ENVELOPE_PARTS);
  if (!result.ok) corrupt(result.error.expected === INVALID_JSON ? "Workflow storage is truncated or invalid JSON." : "Workflow storage must be an object.", result.error);
  return result.value;
}

function assertSupportedVersions(parts: Infer<typeof ENVELOPE_PARTS>): void {
  if (parts.format !== WORKFLOW_STORAGE_FORMAT) incompatible("Workflow storage format is not supported.");
  if (parts.storageVersion !== WORKFLOW_STORAGE_VERSION) incompatible("Workflow storage version is not supported.");
  if (parts.workflowSchemaVersion !== WORKFLOW_SCHEMA_VERSION) incompatible("Workflow schema version is not supported.");
}

/** Parses stored text into a verified envelope, or throws a named storage error for oversized, corrupt, incompatible or tampered files. */
export function parseStorageEnvelope(serialized: string): WorkflowStorageEnvelope {
  if (Buffer.byteLength(serialized, "utf8") > MAX_WORKFLOW_STORAGE_BYTES) corrupt("Workflow storage exceeds its bounded size.");
  const parts = envelopeParts(serialized);
  assertSupportedVersions(parts);
  const body = decode(ENVELOPE_BODY, parts);
  if (!body.ok) corrupt(bodyProblem(body.error), body.error);
  const fields: ChecksummedFields = { format: WORKFLOW_STORAGE_FORMAT, storageVersion: WORKFLOW_STORAGE_VERSION, workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION, generation: body.value.generation, events: body.value.events };
  if (body.value.checksum !== digestFields(fields)) corrupt("Workflow storage checksum does not match its contents.");
  return { ...fields, checksum: body.value.checksum };
}
