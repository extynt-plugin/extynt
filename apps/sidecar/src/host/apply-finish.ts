// The rest of an apply once its batch has answered (or has not): settle the native lease, build and verify the receipt against the
// reads that rode in the same batch, and post it. A write whose answer is missing is an unknown receipt and a quarantine, never a guess.
import type { JsonObject } from "@extynt/decode";
import { parseHostCallResult } from "@extynt/host-native";
import type { BatchItem, BatchResult, CallOutcome, WireError } from "@extynt/host-native";
import { queueSnapshotRefresh } from "../read-queue.js";
import { readApplyBreadcrumb } from "../native-snapshot/index.js";
import { createdApplyIds, makeApplyReceipt } from "../verify/receipt-build.js";
import { parseApplyHostResponse } from "../verify/host-response.js";
import { metadataReadbackSnapshot } from "../verify/metadata-readback.js";
import { verifyApply } from "../verify/verify-ops.js";
import type { ApplyCommand, ApplyContext, HostApplyResult, HostSnapshot, ReceiptDraft } from "../verify/host-types.js";
import type { VerificationOutcome } from "../verify/verify-ops.js";
import type { ProbeSnapshot } from "../server-types.js";
import type { ApplyRun } from "./run-apply.js";
import { isScopedReadSet } from "./apply-input.js";
import { fingerprintOf, hostSnapshotOf, instanceIdOf, planOperationsOf, postApplyReceipt, postSnapshot, reportNotRun } from "./apply-support.js";
import { foldRead, postFolded, withoutCompositionMarkers } from "./fold-read.js";
import type { Folded } from "./fold-read.js";
import { pingOf } from "./call.js";
import { lostApplyReceipt, quarantineUnknownMutation, writeNotStarted } from "./outcome.js";
import type { LostReason } from "./outcome.js";
import { settleNativeLease } from "./lease.js";
import type { NativeLease } from "./lease.js";
import { failedSnapshot, hostBatches, packBatches, readOpsFor, readSetOf, stampOf, stampOp, STAMP_ID } from "./read-batch.js";
import type { ReadSetResult } from "./read-batch.js";
import { markerCompositionsBy, touchedBy } from "./touched.js";
import { isLayerStylesInert, noteLayerStyles } from "./facts.js";

type Answered = Extract<CallOutcome<BatchResult>, { kind: "ok" }>;
type Lost = Extract<CallOutcome<BatchResult>, { kind: "lost" }>;

interface VerifiedRead {
  envelope: ProbeSnapshot | HostSnapshot | JsonObject;
  folded?: Folded;
}

interface Applied {
  batch: BatchResult;
  parsed: HostApplyResult;
  receipt: ReceiptDraft;
  rttMs: number;
}

const NOT_RUN_LOST = "After Effects went away before it took this plan, so nothing was applied.";
const METADATA_INCOMPLETE = "Targeted metadata readback was incomplete or mismatched.";
const MAX_DETAIL_LENGTH = 200;

async function lostApply(run: ApplyRun, lease: NativeLease, outcome: Lost): Promise<void> {
  const { ctx, input } = run;
  if (outcome.sent) { await unknownApply(run, outcome.reason); return; }
  await settleNativeLease(ctx, lease, "native-not-started");
  await reportNotRun(ctx, input.approved, "HOST_CONNECTION_LOST", NOT_RUN_LOST);
}

async function unknownApply(run: ApplyRun, reason: LostReason): Promise<void> {
  const { ctx, input } = run;
  const receipt = lostApplyReceipt({ planId: input.planId, approvalToken: input.approved.approval?.token, reason });
  await postApplyReceipt(ctx, receipt);
  quarantineUnknownMutation(ctx, receipt.hostError.code);
}

async function refusedWrite(run: ApplyRun, lease: NativeLease, error: WireError): Promise<void> {
  if (!writeNotStarted(error.code)) { await unknownApply(run, "protocol"); return; }
  await settleNativeLease(run.ctx, lease, "native-not-started");
  await reportNotRun(run.ctx, run.input.approved, error.code, error.message);
}

async function unverified(run: ApplyRun, receipt: ReceiptDraft, reason: string): Promise<void> {
  const detail = reason.slice(0, MAX_DETAIL_LENGTH);
  receipt.postcondition = "verification_unavailable";
  receipt.verification = undefined;
  receipt.metadataReadback = undefined;
  run.ctx.log("host.verify-threw", { detail });
  await run.ctx.receivers.acceptPanelEvent({ code: "VERIFY_THREW", message: `Verification failed after a successful apply: ${detail}` });
}

function verifyRequestId(run: ApplyRun): string {
  return run.input.reads.verify.readId;
}

async function verifyRead(run: ApplyRun, batch: BatchResult): Promise<ReadSetResult> {
  const { ctx, input } = run;
  const spec = input.reads.verify, set = (from: BatchResult) => readSetOf({ batch: from, read: spec.read, requestId: verifyRequestId(run), ping: pingOf(ctx) });
  const first = set(batch);
  if (first.ok) return first;
  ctx.log("host.verify-reread", { code: first.failure.code });
  const outcome = await hostBatches(ctx, packBatches([stampOp()], readOpsFor(spec.read)));
  const second = outcome.kind === "ok" ? set(outcome.result) : first;
  return second.ok ? second : first;
}

function scopedRead(run: ApplyRun, command: ApplyCommand, parsed: HostApplyResult): VerifiedRead | null {
  const envelope = metadataReadbackSnapshot(command, parsed.metadataReadback, hostSnapshotOf(run.preApply), verifyRequestId(run));
  return envelope ? { envelope } : null;
}

async function foldedRead(run: ApplyRun, batch: BatchResult, parsed: HostApplyResult): Promise<VerifiedRead> {
  const { ctx, input } = run;
  const read = await verifyRead(run, batch);
  if (!read.ok) return { envelope: failedSnapshot(read.failure, verifyRequestId(run)) };
  const created = createdApplyIds(parsed).ids;
  const markerCompositions = markerCompositionsBy(input.command.operations).map((id) => created[id] ?? id);
  const folded = await foldRead({ ctx, hashes: ctx.hashes, read: read.set, touched: touchedBy(input.command.operations), markerCompositions, breadcrumb: readApplyBreadcrumb() });
  if (folded.failure) ctx.log("host.details-failed", { code: folded.failure.code });
  return { envelope: folded.envelope, folded };
}

function verifyEnvelope(run: ApplyRun, batch: BatchResult, parsed: HostApplyResult): Promise<VerifiedRead | null> {
  const { command } = run.input;
  return isScopedReadSet(command) ? Promise.resolve(scopedRead(run, command, parsed)) : foldedRead(run, batch, parsed);
}

function verifyAgainst(run: ApplyRun, applied: Applied, envelope: VerifiedRead["envelope"]): VerificationOutcome {
  const { ctx, input } = run;
  const state = { receipt: applied.receipt, command: { operations: planOperationsOf(input.command) }, hostSteps: applied.parsed.steps ?? [], preApplySnapshot: run.preApply };
  return verifyApply(state, envelope, { verifyProbeMs: Math.round(applied.rttMs), log: (line) => ctx.log("host.verify", { line }) });
}

async function postVerified(ctx: ApplyRun["ctx"], verifying: VerifiedRead): Promise<string | null> {
  const posted = verifying.folded ? await postFolded(ctx, withoutCompositionMarkers(verifying.folded)) : await postSnapshot(ctx, verifying.envelope);
  return fingerprintOf(posted);
}

async function verifyAndPost(run: ApplyRun, applied: Applied): Promise<void> {
  const { receipt, parsed } = applied;
  const verifying = await verifyEnvelope(run, applied.batch, parsed);
  if (!verifying) { await unverified(run, receipt, METADATA_INCOMPLETE); return; }
  if (isScopedReadSet(run.input.command)) receipt.metadataReadback = parsed.metadataReadback;
  if (!verifyAgainst(run, applied, verifying.envelope).snapshotOk) return;
  const fingerprint = await postVerified(run.ctx, verifying);
  if (fingerprint) receipt.afterFingerprint = fingerprint;
}

async function verifyReceipt(run: ApplyRun, applied: Applied): Promise<void> {
  try {
    await verifyAndPost(run, applied);
  } catch (error) {
    await unverified(run, applied.receipt, error instanceof Error ? error.message : String(error));
  }
}

async function partialSnapshot(run: ApplyRun, batch: BatchResult, parsed: HostApplyResult): Promise<void> {
  const { ctx, input } = run;
  if (parsed.mutationState === "unknown" || parsed.mayHaveMutated !== true || isScopedReadSet(input.command)) return;
  const read = readSetOf({ batch, read: input.reads.verify.read, requestId: verifyRequestId(run), ping: pingOf(ctx) });
  if (read.ok) await postFolded(ctx, await foldRead({ ctx, hashes: ctx.hashes, read: read.set, touched: touchedBy(input.command.operations), breadcrumb: readApplyBreadcrumb() }));
}

function recordAfterStamp(run: ApplyRun, batch: BatchResult): void {
  const after = stampOf(batch, STAMP_ID);
  if (run.input.planId && after && after.revision !== null) run.ctx.state.hostFacts.afterStamps.set(run.input.planId, { epoch: after.epoch, revision: after.revision });
}

function writeItemOf(batch: BatchResult): BatchItem | undefined {
  return batch.results.find((item) => item.id === "apply");
}

function applyContextOf(run: ApplyRun): ApplyContext {
  const { input } = run;
  const hostProbe = run.hostProbeMs === undefined ? {} : { hostProbeMs: run.hostProbeMs };
  return { approvedData: input.approved, command: input.command, approval: input.approved.approval, ...hostProbe, preApplySnapshot: hostSnapshotOf(run.preApply) };
}

function parsedApply(run: ApplyRun, item: BatchItem): HostApplyResult {
  const call = parseHostCallResult(item.result);
  if (call) run.ctx.link.noteLibrary(call.libraryVersion);
  return parseApplyHostResponse(call ? call.result : null, false);
}

function needsFreshRead(parsed: HostApplyResult): boolean {
  return parsed.mutationState === "rolled-back" || parsed.error?.code === "STALE_STAMP";
}

function captureOrRefresh(run: ApplyRun, applied: Applied): void {
  const { ctx, input } = run;
  if (applied.receipt.postcondition === "passed" && input.planId) ctx.capturePlan?.(input.planId, "after");
  else if (needsFreshRead(applied.parsed)) queueSnapshotRefresh(ctx.state, { reason: "edit", read: input.reads.verify.read });
}

function afterReceipt(run: ApplyRun, applied: Applied, unknown: boolean): void {
  if (unknown) quarantineUnknownMutation(run.ctx, "HOST_DISPATCH_UNKNOWN");
  if (applied.parsed.ok === true) recordAfterStamp(run, applied.batch);
  captureOrRefresh(run, applied);
}

async function receiptOf(run: ApplyRun, applied: Applied): Promise<void> {
  const { ctx } = run;
  if (isLayerStylesInert(applied.parsed.error)) noteLayerStyles(ctx.state.hostFacts, false, ctx.now());
  if (applied.parsed.ok === true) await verifyReceipt(run, applied);
  else await partialSnapshot(run, applied.batch, applied.parsed);
}

async function answeredApply(run: ApplyRun, lease: NativeLease, outcome: Answered): Promise<void> {
  const { ctx } = run;
  const item = writeItemOf(outcome.result);
  if (!item || !item.ok) { await refusedWrite(run, lease, item?.error ?? { code: "HOST_ERROR", message: "The apply was not answered." }); return; }
  const parsed = parsedApply(run, item);
  const unknown = parsed.ok !== true && parsed.mutationState === "unknown";
  if (!unknown) await settleNativeLease(ctx, lease, "callback-received");
  const appliedOnInstance = instanceIdOf(ctx);
  const applied: Applied = { batch: outcome.result, parsed, receipt: makeApplyReceipt(applyContextOf(run), parsed, Math.round(outcome.rttMs)), rttMs: outcome.rttMs };
  await receiptOf(run, applied);
  await postApplyReceipt(ctx, appliedOnInstance === undefined ? applied.receipt : { ...applied.receipt, appliedOnInstance });
  afterReceipt(run, applied, unknown);
}

/** Settles the lease, builds the receipt from whatever answered and posts it. A write whose answer is missing becomes an unknown receipt and a quarantine. */
export async function finishApply(run: ApplyRun, lease: NativeLease, outcome: CallOutcome<BatchResult>): Promise<void> {
  if (outcome.kind === "lost") await lostApply(run, lease, outcome);
  else if (outcome.kind === "refused") await refusedWrite(run, lease, outcome.error);
  else await answeredApply(run, lease, outcome);
}
