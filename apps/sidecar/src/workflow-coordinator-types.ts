// The records, limits and identifier helpers the workflow coordinator shares across its modules.

import { createHash } from "node:crypto";
import { decode, type Decoder, fallback, jsonValue, object, optional, string } from "@extynt/decode";
import { MAX_WORKFLOW_GOAL_LENGTH, redactWorkflowText, type WorkflowId, type WorkflowJobConstraints, type WorkflowStore } from "@extynt/workflow";
import type { ActionPlan } from "@extynt/action-plan";

/** What the sidecar knows about the host and the verification it can offer for one admitted plan. */
export interface WorkflowAdmissionAuthority {
  readonly hostProfileId: string | null;
  readonly hostBasis: string;
  readonly hostSupported: boolean;
  readonly verificationBasis: string;
  readonly exactVerification: boolean;
  readonly schemaBasis?: string;
  readonly targetResolved?: boolean;
  readonly targetBasis?: string;
  readonly mutationBasis?: string;
  readonly recoveryBasis?: string;
  readonly policyApprovalId?: string;
}

/** The clock and durable store a coordinator runs against. */
export interface WorkflowCoordinatorOptions { readonly now?: () => Date; readonly store?: WorkflowStore }

/** An admitted plan and how many receipts and undo receipts it has settled. */
export interface WorkflowPlanRecord {
  readonly planId: string;
  readonly jobId: WorkflowId;
  readonly stageId: WorkflowId;
  readonly batchId: WorkflowId;
  readonly plan: ActionPlan;
  readonly receiptSequence: number;
  readonly undoSequence: number;
}

export interface ThrownFailure { readonly code: string; readonly message: string }

/** The shape of an identifier the workflow accepts in an event id. */
export const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** The most operations one batch carries. */
export const WORKFLOW_OPERATION_LIMIT = 256;

/** The limits every workflow job the coordinator opens carries. */
export const WORKFLOW_JOB_CONSTRAINTS: WorkflowJobConstraints = { maxStages: 128, maxBatches: 1024, maxOperations: 1024 * WORKFLOW_OPERATION_LIMIT };

const failureFields = object({ code: optional(fallback(jsonValue, undefined)), message: optional(fallback(string(), undefined)) });

/** A decoder that reads any caught value as a failure; the code falls back to `fallbackCode` when the value carries none. */
export function thrownFailure(fallbackCode: string): Decoder<ThrownFailure> {
  return {
    run(input) {
      const read = decode(failureFields, input);
      const code = read.ok && read.value.code !== undefined && read.value.code !== null ? String(read.value.code) : fallbackCode;
      return { code, message: input instanceof Error ? input.message : String(input) };
    },
  };
}

/** Reads a caught value as the failure a projection divergence records. */
export const DIVERGENCE_FAILURE: Decoder<ThrownFailure> = thrownFailure("WORKFLOW_PROJECTION_DIVERGENCE");

/** Redacts a diagnostic and bounds it to 256 characters. */
export function safeWorkflowDiagnostic(value: string): string { return redactWorkflowText(value, 256); }

/** The longest start of `value` that fits in `maxBytes` of UTF-8, never cutting a character in half. */
export function utf8Prefix(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

/** A job's goal as the workflow stores it: redacted line by line so its list structure survives, and cut to MAX_WORKFLOW_GOAL_LENGTH UTF-8 bytes; the first cycle still reads the whole message. */
export function workflowGoalText(value: string): string {
  return utf8Prefix(value.split("\n").map((line) => redactWorkflowText(line, MAX_WORKFLOW_GOAL_LENGTH)).filter(Boolean).join("\n"), MAX_WORKFLOW_GOAL_LENGTH);
}

/** A stable identifier derived from `value` under `prefix`. */
export function hashId(prefix: string, value: string): string { return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`; }

/** An event identifier `prefix:value`, hashed when `value` would break the identifier shape. */
export function eventId(prefix: string, value: string): string {
  const candidate = `${prefix}:${value}`;
  return EVENT_ID_RE.test(candidate) ? candidate : hashId(prefix, value);
}

/** The identifier of one operation of a batch. */
export function operationIdFor(batchId: WorkflowId, ordinal: number): WorkflowId {
  return `${batchId}:op:${ordinal}`;
}

/** The current time as a strict ISO timestamp; any other form is refused. */
export function iso(now: () => Date): string {
  const value = now().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new Error("Workflow coordinator requires strict ISO timestamps.");
  return value;
}
