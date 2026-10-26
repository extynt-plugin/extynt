// undo_plan on the plugin (plan undo): when the live stamp is still the one right after the plan's apply, one batch holds the stamp
// guard, the undo and the reads that show what it put back; otherwise a guard read comes first, and its stamp becomes the guard.
import type { BatchEntry, BatchResult, BatchItem, CallOutcome, WatchState } from "@extynt/host-native";
import { parseHostCallResult } from "@extynt/host-native";
import { decode, map } from "@extynt/decode";
import type { Decoder, JsonObject, JsonValue } from "@extynt/decode";
import { readApplyBreadcrumb } from "../native-snapshot/index.js";
import { freshStamp } from "../read-currency.js";
import type { PanelRead } from "../read-queue.js";
import { UNDO_CHANGED_TEXT } from "../verify/undo-outcome.js";
import { parseApplyHostResponse } from "../verify/host-response.js";
import type { HostErrorBody } from "../verify/apply-reply.js";
import type { HostApplyResult } from "../verify/host-types.js";
import { numberOf, objectOf, rowDecoder, textField } from "../verify/json-fields.js";
import { panelReadOf } from "./apply-input.js";
import { fingerprintOf, postReceipt } from "./apply-support.js";
import type { PostedReceipt } from "./apply-support.js";
import { pingOf } from "./call.js";
import { foldRead, postFolded } from "./fold-read.js";
import type { HostStamp } from "./facts.js";
import type { HostLaneContext, HostWorkData } from "./lane-types.js";
import { reserveMutation, settleNativeLease } from "./lease.js";
import type { NativeLease } from "./lease.js";
import { lostUndoReceipt, quarantineUnknownMutation, writeNotStarted } from "./outcome.js";
import { detailsOp, detailsRequestFor, hostBatches, packBatches, readOpsFor, readSetOf, stampOf, stampOp, STAMP_BEFORE_ID, STAMP_ID } from "./read-batch.js";
import type { LayerRef } from "./read-batch.js";
import { touchedBy } from "./touched.js";

interface UndoCommand {
  operation: "undo_plan";
  planId: string;
  undoGroup: JsonValue | undefined;
  times: number;
}

interface UndoWork {
  planId: string;
  command: UndoCommand;
  after: PanelRead;
  guard: PanelRead;
  expectedFingerprint: string | null;
  scopedUnsupported: boolean;
}

interface UndoRun extends UndoWork {
  ctx: HostLaneContext;
}

const STAMP_FRESH_TTL_MS = 2000;
const UNGUARDED = "Could not read the project to confirm it is still where the agent left it; nothing was undone.";
const SCOPED_UNSUPPORTED = "This kind of change can only be undone in After Effects (Edit > Undo) after checking recent edits.";
const WENT_AWAY = "After Effects went away before it took this undo, so nothing was undone.";

function undoWorkOf(item: JsonObject): UndoWork {
  const planId = textField(item, "planId") ?? "";
  const times = numberOf(item.times);
  const reads = objectOf(item.reads) ?? {};
  return {
    planId,
    command: { operation: "undo_plan", planId, undoGroup: item.undoGroup, times: times !== undefined && times >= 1 ? times : 1 },
    after: panelReadOf(reads.after, "undo-after"),
    guard: panelReadOf(reads.guard, "undo-guard"),
    expectedFingerprint: textField(item, "expectedFingerprint") ?? null,
    scopedUnsupported: item.scopedUndoUnsupported === true,
  };
}

const undoItemDecoder: Decoder<UndoWork> = map(rowDecoder, undoWorkOf);

function rejected(planId: string, code: string, message: string): PostedReceipt {
  return { planId, operation: "undo_plan", status: "rejected", executed: false, hostError: { code, message } };
}

function unknownReceipt(planId: string, error: HostErrorBody | null | undefined): PostedReceipt {
  const hostError = { ...error, code: error?.code ?? "HOST_DISPATCH_UNKNOWN", message: error?.message ?? "After Effects did not say what happened." };
  return { planId, operation: "undo_plan", status: "unknown", executed: false, mayHaveMutated: true, mutationState: "unknown", hostError };
}

function sameStamp(left: HostStamp | undefined, right: HostStamp | null | undefined): boolean {
  return !!left && !!right && left.epoch === right.epoch && left.revision === right.revision;
}

function standingStamp(run: UndoRun): HostStamp | undefined {
  const recorded = run.ctx.state.hostFacts.afterStamps.get(run.planId);
  const live = freshStamp(run.ctx.state, STAMP_FRESH_TTL_MS);
  return sameStamp(recorded, live) ? recorded : undefined;
}

function stampFrom(state: WatchState | null): HostStamp | undefined {
  return state && state.revision !== null ? { epoch: state.epoch, revision: state.revision } : undefined;
}

async function currentFingerprint(run: UndoRun, spec: PanelRead): Promise<{ fingerprint: string | null; stamp: HostStamp | undefined }> {
  const { ctx } = run;
  const outcome = await hostBatches(ctx, packBatches([stampOp()], readOpsFor(spec.read)));
  const read = outcome.kind === "ok" ? readSetOf({ batch: outcome.result, read: spec.read, requestId: spec.readId, ping: pingOf(ctx) }) : undefined;
  if (!read?.ok) return { fingerprint: null, stamp: undefined };
  const folded = await foldRead({ ctx, hashes: ctx.hashes, read: read.set, touched: [], breadcrumb: readApplyBreadcrumb() });
  return { fingerprint: fingerprintOf(await postFolded(ctx, folded)), stamp: stampFrom(read.set.stamp) };
}

function guardHolds(fingerprint: string | null, expected: string | null): boolean {
  return fingerprint !== null && fingerprint !== "" && (expected === null || fingerprint === expected);
}

function guardRefusal(planId: string, changed: boolean): PostedReceipt {
  return changed ? rejected(planId, "UNDO_PROJECT_CHANGED", UNDO_CHANGED_TEXT) : rejected(planId, "UNDO_GUARD_FAILED", UNGUARDED);
}

async function guardRead(run: UndoRun): Promise<{ stamp: HostStamp | undefined } | "refused"> {
  const now = await currentFingerprint(run, run.guard);
  if (guardHolds(now.fingerprint, run.expectedFingerprint)) return { stamp: now.stamp };
  await postReceipt(run.ctx, guardRefusal(run.planId, now.fingerprint !== null));
  return "refused";
}

function touchedOf(run: UndoRun): LayerRef[] {
  return touchedBy(run.ctx.state.plans.get(run.planId)?.plan.operations);
}

function undoBatches(run: UndoRun, stamp: HostStamp | undefined): BatchEntry[][] {
  const args = stamp ? { ...run.command, expectedStamp: stamp } : run.command;
  const write: BatchEntry = { op: "host_call", id: "undo", entry: "aeUndoPlan", args: JSON.stringify(args) };
  const details = detailsRequestFor(touchedOf(run));
  return packBatches([stampOp(STAMP_BEFORE_ID), write, stampOp(STAMP_ID)], readOpsFor(run.after.read), details ? [detailsOp(details)] : []);
}

async function unknownUndo(run: UndoRun, receipt: PostedReceipt): Promise<void> {
  await postReceipt(run.ctx, receipt);
  quarantineUnknownMutation(run.ctx, receipt.hostError?.code ?? "HOST_DISPATCH_UNKNOWN");
}

async function settledUndo(run: UndoRun, batch: BatchResult, method: string): Promise<void> {
  const { ctx } = run;
  const read = readSetOf({ batch, read: run.after.read, requestId: run.after.readId, ping: pingOf(ctx) });
  if (read.ok) await postFolded(ctx, await foldRead({ ctx, hashes: ctx.hashes, read: read.set, touched: touchedOf(run), breadcrumb: readApplyBreadcrumb() }));
  await postReceipt(ctx, { planId: run.planId, operation: "undo_plan", status: "executed", executed: true, method });
  const stamp = stampFrom(stampOf(batch, STAMP_ID));
  if (stamp) ctx.state.hostFacts.afterStamps.set(run.planId, stamp);
  ctx.capturePlan?.(run.planId, "after");
}

async function rejectedUndo(run: UndoRun, error: HostErrorBody | null | undefined): Promise<void> {
  const code = error?.code ?? "UNDO_REFUSED";
  const message = code === "UNDO_PROJECT_CHANGED" ? UNDO_CHANGED_TEXT : error?.message ?? "After Effects refused without a reason.";
  await postReceipt(run.ctx, rejected(run.planId, code, message));
}

function parsedUndo(item: BatchItem): HostApplyResult {
  const call = parseHostCallResult(item.result);
  return parseApplyHostResponse(call ? call.result : null, true);
}

async function settleParsed(run: UndoRun, batch: BatchResult, parsed: HostApplyResult): Promise<void> {
  if (parsed.ok) await settledUndo(run, batch, parsed.method ?? "");
  else await rejectedUndo(run, parsed.error);
}

async function answeredUndo(run: UndoRun, lease: NativeLease, batch: BatchResult): Promise<void> {
  const item = batch.results.find((entry) => entry.id === "undo");
  if (!item || !item.ok) { await refusedUndo(run, lease, item?.error ?? { code: "HOST_ERROR", message: "The undo was not answered." }); return; }
  const parsed = parsedUndo(item);
  if (!parsed.ok && parsed.mayHaveMutated === true) { await unknownUndo(run, unknownReceipt(run.planId, parsed.error)); return; }
  await settleNativeLease(run.ctx, lease, "callback-received");
  await settleParsed(run, batch, parsed);
}

async function refusedUndo(run: UndoRun, lease: NativeLease, error: { code: string; message: string }): Promise<void> {
  if (!writeNotStarted(error.code)) { await unknownUndo(run, lostUndoReceipt(run.planId, "protocol")); return; }
  await settleNativeLease(run.ctx, lease, "native-not-started");
  await postReceipt(run.ctx, rejected(run.planId, error.code, error.message));
}

async function finishUndo(run: UndoRun, lease: NativeLease, outcome: CallOutcome<BatchResult>): Promise<void> {
  if (outcome.kind === "ok") { await answeredUndo(run, lease, outcome.result); return; }
  if (outcome.kind === "refused") { await refusedUndo(run, lease, outcome.error); return; }
  if (outcome.sent) { await unknownUndo(run, lostUndoReceipt(run.planId, outcome.reason)); return; }
  await settleNativeLease(run.ctx, lease, "native-not-started");
  await postReceipt(run.ctx, rejected(run.planId, "HOST_CONNECTION_LOST", WENT_AWAY));
}

async function guardedStamp(run: UndoRun): Promise<{ stamp: HostStamp | undefined } | "refused"> {
  const standing = standingStamp(run);
  return standing ? { stamp: standing } : guardRead(run);
}

/** Runs one claimed undo item against the plugin: the guard, the undo itself and its receipt. A refused undo is recorded and nothing is undone. */
export async function runUndo(item: HostWorkData, ctx: HostLaneContext): Promise<void> {
  const decoded = decode(undoItemDecoder, item);
  const work = decoded.ok ? decoded.value : undoWorkOf({});
  const run: UndoRun = { ...work, ctx };
  if (run.scopedUnsupported) { await postReceipt(ctx, rejected(run.planId, "SCOPED_UNDO_UNSUPPORTED", SCOPED_UNSUPPORTED)); return; }
  const guarded = await guardedStamp(run);
  if (guarded === "refused") return;
  const reserved = await reserveMutation(ctx, "undo");
  if (!reserved.ok) { await postReceipt(ctx, rejected(run.planId, reserved.code, reserved.message)); return; }
  await finishUndo(run, reserved.lease, await hostBatches(ctx, undoBatches(run, guarded.stamp)));
}
