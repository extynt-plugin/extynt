// Small pieces the apply and undo runners share: reporting a refusal, posting a snapshot or a receipt, and what the sidecar already holds.
import { jsonOf } from "@extynt/mcp-server";
import { approximateBytes } from "../approximate-bytes.js";
import type { ReceiverOutcome } from "../receiver-types.js";
import type { JsonObject } from "@extynt/decode";
import type { ProbeSnapshot } from "../server-types.js";
import { isRow } from "../snapshot-view.js";
import type { Opaque, Row } from "../snapshot-view.js";
import type { ApplyCommand, ApprovedData, HostSnapshot, ReceiptDraft } from "../verify/host-types.js";
import type { PlanOperation } from "../verify/verify-types.js";
import { notRunReceipt } from "../verify/not-run.js";
import type { HostLaneContext } from "./lane-types.js";

/** The project as a runner holds it before a write: a stored snapshot, a slim copy the sidecar proved current, or nothing. */
export type HeldProject = ProbeSnapshot | Row | null | undefined;

/** A receipt as the sidecar accepts it: the apply draft, plus what an undo adds. */
export type PostedReceipt = ReceiptDraft & { executed?: boolean; method?: string };

const MAX_TRIMMED_STEPS = 32;
const EVIDENCE_REFUSALS: ReadonlySet<string> = new Set(["WORKFLOW_SETTLEMENT_REFUSED", "CONTRADICTORY_RECEIPT", "INVALID_RECEIPT_OUTCOME", "INVALID_RECEIPT"]);
const BARE_FIELDS: ReadonlyArray<keyof ReceiptDraft> = ["planId", "operation", "approvalId", "status", "appliedOperations", "completedOperations", "externalOutputs", "managedSources", "mayHaveMutated", "mutationState", "rollback", "hostError", "failure", "error", "beforeFingerprint", "appliedOnInstance", "hostProbeMs", "hostApplyMs"];

/** The id of the After Effects instance the link is paired with, if any. */
export function instanceIdOf(ctx: HostLaneContext): string | undefined {
  return ctx.link.status().instanceId ?? undefined;
}

function isHostComposition(value: Opaque): boolean {
  return isRow(value) && typeof value.id === "string" && typeof value.width === "number" && typeof value.height === "number";
}

function hostRecord(value: Row): HostSnapshot {
  return { ...value };
}

/** A stored or built snapshot as the verify code reads it, or null when its compositions are not rows it can use. */
export function hostSnapshotOf(value: HeldProject): HostSnapshot | null {
  const held = value ? jsonOf(value) : undefined;
  if (!isRow(held) || !isRow(held.result)) return null;
  const compositions = held.result.compositions;
  return compositions === undefined || (Array.isArray(compositions) && compositions.every(isHostComposition)) ? hostRecord(held) : null;
}

/** Posts a snapshot the adapter built; the answer carries its fingerprint (and, for a precheck, the sidecar's verdict). */
export async function postSnapshot(ctx: HostLaneContext, envelope: ProbeSnapshot | HostSnapshot | JsonObject, meta: { purpose?: "precheck"; planId?: string } = {}): Promise<ReceiverOutcome> {
  const wire = jsonOf(envelope), bytes = approximateBytes(wire);
  return ctx.receivers.acceptSnapshot(wire, { bytes, ...meta });
}

/** The fingerprint the sidecar made of a snapshot it accepted, or null when it refused or gave none. */
export function fingerprintOf(answer: ReceiverOutcome): string | null {
  const fingerprint = answer.body.fingerprint;
  return answer.status < 300 && typeof fingerprint === "string" ? fingerprint : null;
}

function refusalCode(body: ReceiverOutcome["body"]): string | null {
  const error = body.error;
  return isRow(error) && typeof error.code === "string" ? error.code : null;
}

/** Records a refusal before After Effects was touched. A refusal the sidecar cannot record is logged: nothing was applied either way. */
export async function reportNotRun(ctx: HostLaneContext, approved: ApprovedData, code: string, text: string): Promise<void> {
  const answer = await ctx.receivers.acceptReceipt(jsonOf(notRunReceipt(approved, code, text)), instanceIdOf(ctx));
  if (answer.status >= 300) ctx.log("host.not-run-receipt-failed", { code, status: answer.status, refusal: refusalCode(answer.body) });
}

function trimmedReceipt(receipt: PostedReceipt): PostedReceipt | null {
  const { verification } = receipt;
  if (!verification || receipt.verificationTrimmed === true) return null;
  const steps = verification.steps.filter((step) => step.verificationState !== "exact").slice(0, MAX_TRIMMED_STEPS);
  return { ...receipt, verificationTrimmed: true, verification: { snapshotRequestId: verification.snapshotRequestId, targetFound: verification.targetFound, steps } };
}

/** Posts a receipt; one the sidecar finds too large is posted again with only its non-exact verification steps. */
export async function postReceipt(ctx: HostLaneContext, receipt: PostedReceipt): Promise<ReceiverOutcome> {
  const answer = await ctx.receivers.acceptReceipt(jsonOf(receipt), instanceIdOf(ctx));
  const trimmed = answer.status === 413 ? trimmedReceipt(receipt) : null;
  return trimmed ? ctx.receivers.acceptReceipt(jsonOf(trimmed), instanceIdOf(ctx)) : answer;
}

function bareReceipt(receipt: PostedReceipt): PostedReceipt {
  const kept = Object.fromEntries(BARE_FIELDS.flatMap((key) => (receipt[key] === undefined ? [] : [[key, receipt[key]]])));
  const postcondition = receipt.status === "executed" ? "verification_unavailable" : receipt.postcondition;
  return postcondition === undefined ? kept : { ...kept, postcondition };
}

/** Posts the receipt of an apply that ran. A receipt the sidecar refuses on its evidence is posted again as the bare outcome, so a plan that was applied is never left for the lost-receipt abandonment to call failed. */
export async function postApplyReceipt(ctx: HostLaneContext, receipt: PostedReceipt): Promise<ReceiverOutcome> {
  const answer = await postReceipt(ctx, receipt);
  const code = answer.status >= 300 ? refusalCode(answer.body) : null;
  if (!code || !EVIDENCE_REFUSALS.has(code)) return answer;
  ctx.log("host.receipt-refused", { code, status: answer.status });
  return postReceipt(ctx, bareReceipt(receipt));
}

function isPlanOperation(value: Opaque): value is PlanOperation {
  return isRow(value) && typeof value.operation === "string";
}

/** The operations of an apply command, as the verifier reads them: only those that name their kind. */
export function planOperationsOf(command: ApplyCommand): PlanOperation[] {
  return Array.isArray(command.operations) ? command.operations.filter(isPlanOperation) : [];
}
