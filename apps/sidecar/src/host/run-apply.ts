// apply_plan on the plugin (plan application): the precheck read when the sidecar could not prove the project unchanged, the claim,
// then ONE batch holding the stamp guard, the write, the stamp after and the verify reads, so nothing can change between them.
import { boolean, decode, fallback, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import type { BatchEntry } from "@extynt/host-native";
import { applyBeginDetail } from "../verify/host-response.js";
import { preApplyReadFailure } from "../verify/precheck-failure.js";
import { readApplyBreadcrumb } from "../native-snapshot/index.js";
import type { NativeReadSet } from "../native-snapshot/index.js";
import { metadataBeforeMatches } from "../verify/metadata-readback.js";
import { admissionRefusal, applyItemDecoder, isRefusal, isScopedReadSet } from "./apply-input.js";
import type { ApplyInput, InputRefusal } from "./apply-input.js";
import { finishApply } from "./apply-finish.js";
import { hostSnapshotOf, reportNotRun } from "./apply-support.js";
import type { HeldProject } from "./apply-support.js";
import { pingOf } from "./call.js";
import { foldRead, postFolded } from "./fold-read.js";
import type { HostLaneContext, HostWorkData } from "./lane-types.js";
import { reserveMutation } from "./lease.js";
import type { NativeLease } from "./lease.js";
import { detailsOp, detailsRequestFor, hostBatches, packBatches, readOpsFor, readSetOf, stampOp, STAMP_BEFORE_ID, STAMP_ID } from "./read-batch.js";
import { markerCompositionsBy, touchedBy } from "./touched.js";

/** Everything the stages of one apply share: what the project looked like before the write, the host's probe time and the stamp the precheck saw. */
export interface ApplyRun {
  ctx: HostLaneContext;
  input: ApplyInput;
  preApply: HeldProject;
  hostProbeMs?: number;
  precheckStamp?: { epoch: number; revision: number };
}

const beginReply = object({ ok: optional(fallback(boolean(), undefined)), alreadyExecuting: optional(fallback(boolean(), undefined)), error: optional(fallback(object({ message: optional(fallback(string(), undefined)) }), undefined)) });
const NOT_AN_ITEM: InputRefusal = { code: "NO_COMMAND", text: "The sidecar approved the plan but the queued item carried no apply command." };
const NOT_UNCHANGED = "A fresh snapshot could not be published immediately before applying, so nothing was run.";
const CLAIM_REFUSED = "The sidecar refused the host apply claim.";
const MAX_REFUSAL_LENGTH = 256;

function failureText(code: string, message: string): InputRefusal {
  const failure = preApplyReadFailure(null, { ok: false, error: { code, message } }, 1, null);
  return failure ? { code: failure.code, text: failure.message } : { code, text: message };
}

async function precheckRead(run: ApplyRun): Promise<NativeReadSet | null> {
  const { ctx, input } = run;
  const spec = input.reads.precheck;
  const outcome = await hostBatches(ctx, packBatches([stampOp()], readOpsFor(spec.read)));
  if (outcome.kind !== "ok") {
    const failed = failureText("HOST_READ_FAILED", outcome.kind === "refused" ? outcome.error.message : "After Effects did not answer the read before applying.");
    await reportNotRun(ctx, input.approved, failed.code, failed.text);
    return null;
  }
  run.hostProbeMs = Math.round(outcome.rttMs);
  const read = readSetOf({ batch: outcome.result, read: spec.read, requestId: spec.readId, ping: pingOf(ctx) });
  if (read.ok) return read.set;
  const failed = failureText(read.failure.code, read.failure.message);
  await reportNotRun(ctx, input.approved, failed.code, failed.text);
  return null;
}

async function admitPrecheck(run: ApplyRun, set: NativeReadSet): Promise<boolean> {
  const { ctx, input } = run;
  const folded = await foldRead({ ctx, hashes: ctx.hashes, read: set, touched: [], breadcrumb: readApplyBreadcrumb() });
  if (folded.failure) ctx.log("host.details-failed", { code: folded.failure.code });
  const answer = await postFolded(ctx, folded, { purpose: "precheck", ...(input.planId ? { planId: input.planId } : {}) });
  const refusal = answer.status < 300 ? admissionRefusal(answer.body) : { code: "PRECONDITION_UNREADABLE", text: NOT_UNCHANGED };
  if (refusal) { await reportNotRun(ctx, input.approved, refusal.code, refusal.text); return false; }
  run.preApply = folded.envelope;
  return true;
}

async function precheck(run: ApplyRun): Promise<boolean> {
  if (run.input.reads.skipPrecheck) { run.preApply = run.input.reads.preApply; return true; }
  const set = await precheckRead(run);
  if (!set) return false;
  if (set.stamp.revision !== null) run.precheckStamp = { epoch: set.stamp.epoch, revision: set.stamp.revision };
  return admitPrecheck(run, set);
}

async function claimApply(run: ApplyRun): Promise<boolean> {
  const { ctx, input } = run;
  const begun = await ctx.receivers.beginApply(applyBeginDetail(input.command));
  const decoded = decode(beginReply, begun.body);
  const reply: Infer<typeof beginReply> = decoded.ok ? decoded.value : {};
  if (begun.status >= 300 || reply.ok !== true) {
    await reportNotRun(ctx, input.approved, "WORKFLOW_APPLY_REFUSED", reply.error?.message?.slice(0, MAX_REFUSAL_LENGTH) ?? CLAIM_REFUSED);
    return false;
  }
  return reply.alreadyExecuting !== true;
}

async function admit(run: ApplyRun): Promise<NativeLease | null> {
  if (!(await claimApply(run))) return null;
  const reserved = await reserveMutation(run.ctx, "apply");
  if (reserved.ok) return reserved.lease;
  await reportNotRun(run.ctx, run.input.approved, reserved.code, reserved.message);
  return null;
}

function applyBatches(run: ApplyRun): BatchEntry[][] {
  const { input } = run;
  const command = run.precheckStamp && input.command.expectedStamp === undefined ? { ...input.command, expectedStamp: run.precheckStamp } : input.command;
  const write: BatchEntry = { op: "host_call", id: "apply", entry: "aeApplyPlan", args: JSON.stringify(command) };
  const head: BatchEntry[] = [stampOp(STAMP_BEFORE_ID), write, stampOp(STAMP_ID)];
  if (isScopedReadSet(input.command)) return [head];
  const spec = input.reads.verify;
  const details = detailsRequestFor(touchedBy(input.command.operations), markerCompositionsBy(input.command.operations));
  return packBatches(head, readOpsFor(spec.read), details ? [detailsOp(details)] : []);
}

async function mutate(run: ApplyRun): Promise<void> {
  const lease = await admit(run);
  if (!lease) return;
  const outcome = await hostBatches(run.ctx, applyBatches(run));
  await finishApply(run, lease, outcome);
}

async function runScoped(run: ApplyRun): Promise<void> {
  const { ctx, input } = run;
  const command = input.command;
  if (!isScopedReadSet(command)) return;
  const approval = input.approved.approval;
  if (!approval || approval.readSetDigest !== command.readSet.digest) { await reportNotRun(ctx, input.approved, "APPROVAL_MISMATCH", "Approval does not bind this exact read set."); return; }
  const held = ctx.state.latest?.snapshot;
  if (!metadataBeforeMatches(command, hostSnapshotOf(held))) { await reportNotRun(ctx, input.approved, "READ_SET_UNREADABLE", "The approved metadata observation is unavailable; collect the target again."); return; }
  run.preApply = held;
  await mutate(run);
}

/** Runs one claimed apply item against the plugin: the precheck, the claim, the write and its receipt. A refused item is recorded and nothing runs. */
export async function runApply(item: HostWorkData, ctx: HostLaneContext): Promise<void> {
  const decoded = decode(applyItemDecoder, item);
  const input = decoded.ok ? decoded.value : NOT_AN_ITEM;
  if (isRefusal(input)) { await reportNotRun(ctx, item, input.code, input.text); return; }
  const run: ApplyRun = { ctx, input, preApply: null };
  if (isScopedReadSet(input.command)) { await runScoped(run); return; }
  if (await precheck(run)) await mutate(run);
}
