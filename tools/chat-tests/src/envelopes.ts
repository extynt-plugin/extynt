/** The envelopes the harness reads back from the sidecar's tools and status route, each decoded once where it arrives. */
import { array, decode, number, object, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { wireObject, wireValue } from "@extynt/fake-plugin";
import { lenient, skippingInvalid } from "./lenient.js";
import type { WireValue } from "./wire-types.js";

/** A tool answer whose `data` is an object (ae_inspect_layer). */
export const dataObjectEnvelope = object({ data: wireObject });

/** A plan tool's answer with the receipt under `data.receipt` (ae_get_receipt). */
export const receiptEnvelope = object({ data: object({ receipt: wireObject }) });

/** A tool answer whose `data` is a list of rows (ae_list_plans). */
export const rowsEnvelope = object({ data: array(wireObject) });

const planRow = object({ planId: lenient(string()), status: lenient(string()) });

/** The plans ae_list_plans lists, with the status each reports; a row that is not an object, or has no string plan id, is not a plan. */
export const planListEnvelope = object({ data: skippingInvalid(planRow) });

/** One page of a recalled plan (ae_recall_plan); an operations member that is not an array, or a cursor that is not a number, reads as absent. */
export const recallEnvelope = object({ data: object({ operations: lenient(array(wireValue)), nextCursor: lenient(number()) }) });

/** The latest work row of ae_status. */
export const latestWorkEnvelope = object({ data: object({ latestWork: wireObject }) });

/** The pipeline counters of ae_status. */
export const pipelineEnvelope = object({ data: object({ pipeline: wireObject }) });

/** The workflow status route's pause member, which is null when no pause is offered. */
export const workflowStatusEnvelope = object({ pause: wireValue });

/** Decodes `value` with `decoder`, or throws an error that names `what` and the failing path. */
export function readEnvelope<T>(decoder: Decoder<T>, value: WireValue, what: string): T {
  const result = decode(decoder, value);
  if (!result.ok) throw new Error(`${what}: ${result.error.message}`);
  return result.value;
}
