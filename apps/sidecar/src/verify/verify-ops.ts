// The verification of an applied plan: each operation judged against the fresh read, the verdicts settled against each other, and the result written onto the receipt.
import type { JsonObject } from "@extynt/decode";
import { decode } from "@extynt/decode";
import { logExpressionLines } from "./expression-lines.js";
import type { ExpressionLine } from "./expression-lines.js";
import type { ProbeSnapshot } from "../server-types.js";
import type { Row } from "../snapshot-view.js";
import type { HostSnapshot, ReceiptDraft } from "./host-types.js";
import { COMPOSITION_KINDS, ITEM_KINDS, isCompositionMarker } from "./plan-kinds.js";
import { postconditionOf, repairPacket, summarizeVerification } from "./receipt-text.js";
import { snapshotAnswer } from "./snapshot-reply.js";
import type { SnapshotReply } from "./snapshot-reply.js";
import { supersededFailures } from "./superseded-failures.js";
import { supersedeFailedSteps } from "./superseded-writes.js";
import { unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";
import { makeVerifyContext } from "./verify-context.js";
import type { VerifyContext } from "./verify-context.js";
import { verifyCompositionOperation } from "./verify-composition.js";
import { verifyItemOperation } from "./verify-items.js";
import { verifyLayerOperation } from "./verify-layer.js";
import { wholeRead } from "./whole-read.js";


/** The timing and the log line writer an apply passes to its verification. */
export interface VerifyApplyOptions {
  readonly verifyProbeMs?: number | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

/** What the apply runner needs after verification: the receipt, whether the fresh read is usable, and whether it covers the whole project. */
export interface VerificationOutcome {
  readonly receipt: ReceiptDraft;
  readonly snapshotOk: boolean;
  readonly wholeRead: boolean;
  readonly snapshot: SnapshotReply;
}

type ReadInput = string | ProbeSnapshot | HostSnapshot | Row | JsonObject | null | undefined;

interface VerifyApplyState {
  readonly receipt: ReceiptDraft;
  readonly command: { readonly operations: ReadonlyArray<JsonObject> };
  readonly hostSteps: ReadonlyArray<JsonObject | undefined>;
  readonly preApplySnapshot: ReadInput;
}

function routedVerdict(ctx: VerifyContext, index: number): VerifiedStep | null {
  const request = ctx.requests[index];
  const kind = request?.operation ?? "";
  if (request && (COMPOSITION_KINDS.has(kind) || isCompositionMarker(request))) return verifyCompositionOperation(ctx, index);
  if (kind === "set_project_settings") return unverifiedStep(kind, "project-settings-host-read-back");
  return ITEM_KINDS.has(kind) ? verifyItemOperation(ctx, index) : verifyLayerOperation(ctx, index);
}

function verdictsOf(ctx: VerifyContext): ReadonlyArray<VerifiedStep> {
  const steps = ctx.requests.map((request, index) => routedVerdict(ctx, index) ?? unverifiedStep(request.operation, "no-verifier-result"));
  return supersedeFailedSteps(supersededFailures(ctx, steps), ctx.requests);
}

function verificationRecord(verification: SnapshotReply, steps: ReadonlyArray<VerifiedStep>, expressions: ReadonlyArray<ExpressionLine>): NonNullable<ReceiptDraft["verification"]> {
  const verdicts = { snapshotRequestId: verification.requestId || null, targetFound: steps.some((step) => step.observed), steps: [...steps] };
  return expressions.length > 0 ? { ...verdicts, expressions: [...expressions] } : verdicts;
}

function writeReceipt(receipt: ReceiptDraft, verification: SnapshotReply, steps: ReadonlyArray<VerifiedStep>, expressions: ReadonlyArray<ExpressionLine>): void {
  const summary = summarizeVerification(steps);
  const readOk = verification.ok === true;
  receipt.afterRevision = readOk && verification.result?.revision ? verification.result.revision : null;
  receipt.postcondition = postconditionOf(readOk, summary);
  const repair = readOk && summary.anyFailed ? repairPacket(steps) : null;
  if (repair) receipt.repair = repair;
  receipt.verification = verificationRecord(verification, steps, expressions);
}

/** Judges every operation of an applied plan against the fresh read, completes the receipt in place, and says whether the read can stand for the project. */
export function verifyApply(state: VerifyApplyState, envelope: ReadInput, options: VerifyApplyOptions = {}): VerificationOutcome {
  const verification = decode(snapshotAnswer, envelope);
  const reply: SnapshotReply = verification.ok ? verification.value : { ok: false };
  const before = decode(snapshotAnswer, state.preApplySnapshot);
  const { receipt, command } = state;
  receipt.verifyProbeMs = options.verifyProbeMs;
  const ctx = makeVerifyContext({ operations: command.operations, hostSteps: state.hostSteps, before: before.ok ? before.value : { ok: false } }, reply);
  const steps = verdictsOf(ctx);
  const expressions = logExpressionLines({ operations: [...command.operations] }, options.log ?? (() => undefined));
  writeReceipt(receipt, reply, steps, expressions);
  return { receipt, snapshotOk: reply.ok === true, wholeRead: reply.ok === true && wholeRead(reply), snapshot: reply };
}
