// The `preview_controls` runner: pictures of a variant card's options. One host call (`aePreviewControlValues`) sets each of the
// model's values on the one control, saves a frame of it and puts the original back exactly, so it is a native mutation and
// runs under the mutation lease like an apply. Only an exact restore is good news: anything else holds native access.
import { boolean, decode, decodeJson, fallback, literal, map, object, refine, skippingInvalid, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import type { Background } from "../capture/png-fit.js";
import { rowDecoder } from "../verify/json-fields.js";
import { leasedHostCall } from "./bridge-call.js";
import { frameBackground, readFrame, removeFrame } from "./frame-pipeline.js";
import { processFrame } from "./frame-worker-client.js";
import type { FrameStore, PreviewResult } from "./frame-store.js";
import type { HostLaneContext, HostRunner, HostWorkData } from "./lane-types.js";
import { releaseFlight } from "./runner-support.js";

const SET_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const CANDIDATE = /^c[0-9]$/;
const NONE: PreviewResult = { status: "none" };
const UNREADABLE: Answer = { kind: "unresolved", code: "UNREADABLE" };

interface HostFrame { index: number; captureId: string; localPath: string }
type Answer = { kind: "frames"; frames: ReadonlyArray<HostFrame> } | { kind: "none" } | { kind: "unresolved"; code: string };
type PreviewCommand = JsonObject & { readonly operation: "preview_control_values" };

const isPreviewCommand = (command: JsonObject): command is PreviewCommand => command.operation === "preview_control_values";

const hostFrame = map(object({ ok: literal(true), id: string({ pattern: CANDIDATE }), localPath: string(), captureId: string() }), (frame): HostFrame => ({ index: Number(frame.id.slice(1)), captureId: frame.captureId, localPath: frame.localPath }));
const previewReply = object({
  restored: fallback(boolean(), false),
  frames: fallback(skippingInvalid(hostFrame), []),
  mutationState: fallback(string(), ""),
  mayHaveMutated: fallback(boolean(), false),
  error: fallback(object({ code: string() }), { code: "" }),
});
const previewItem = object({ setId: string({ pattern: SET_ID }), command: refine(rowDecoder, isPreviewCommand, "a preview_control_values command"), background: frameBackground });

function answerOf(reply: Infer<typeof previewReply>): Answer {
  if (reply.restored) return { kind: "frames", frames: reply.frames };
  return reply.mutationState === "unknown" || reply.mayHaveMutated ? { kind: "unresolved", code: reply.error.code || "RESTORE_UNCONFIRMED" } : { kind: "none" };
}

function hostAnswerOf(text: string): Answer {
  const decoded = decodeJson(text, previewReply);
  return decoded.ok ? answerOf(decoded.value) : UNREADABLE;
}

async function discard(context: HostLaneContext, frame: HostFrame): Promise<void> {
  if (!(await removeFrame(frame.localPath))) await context.client.hostCall("aeDiscardCaptureFrame", { operation: "discard_capture_frame", captureId: frame.captureId });
}

async function picturesOf(context: HostLaneContext, frames: ReadonlyArray<HostFrame>, background: Background | null): Promise<Record<number, string>> {
  const pictures: Record<number, string> = {};
  for (const frame of frames) {
    const loaded = await readFrame(frame.localPath), made = loaded.ok ? await processFrame({ kind: "thumb", bytes: loaded.bytes, background }) : null;
    if (made && "thumb" in made) pictures[frame.index] = made.thumb.dataUrl;
    await discard(context, frame);
  }
  return pictures;
}

async function holdUnresolved(context: HostLaneContext, code: string): Promise<PreviewResult> {
  await context.receivers.acceptPanelEvent({ code: "PREVIEW_RESTORE_UNCONFIRMED", message: `A preview could not confirm it put the control back (${code}). No retry was dispatched.` });
  return { status: "unresolved", code };
}

function lostCode(outcome: { kind: string; reason?: string }): string {
  return outcome.kind === "lost" && outcome.reason === "timeout" ? "HOST_TIMEOUT" : "HOST_DISPATCH_UNKNOWN";
}

async function resultOf(answer: Answer, context: HostLaneContext, background: Background | null): Promise<PreviewResult> {
  if (answer.kind === "unresolved") return holdUnresolved(context, answer.code);
  return answer.kind === "none" ? NONE : { status: "ready", pictures: await picturesOf(context, answer.frames, background) };
}

async function preview(command: PreviewCommand, background: Background | null, context: HostLaneContext): Promise<PreviewResult> {
  const leased = await leasedHostCall(context, { kind: "mutation" }, () => context.client.hostCall("aePreviewControlValues", { ...command }));
  if (leased.status === "refused" || leased.status === "not-started") return NONE;
  if (leased.status === "unknown") return holdUnresolved(context, lostCode(leased.outcome));
  return leased.outcome.kind === "ok" ? resultOf(hostAnswerOf(leased.outcome.result.result), context, background) : NONE;
}

async function perform(raw: HostWorkData, context: HostLaneContext, frames: FrameStore): Promise<void> {
  const decoded = decode(previewItem, raw);
  if (!decoded.ok) { context.log("host.preview-invalid", {}); return; }
  const { setId, command, background } = decoded.value;
  const result = context.link.status().state === "online" ? await preview(command, background, context) : NONE;
  frames.putPreview(setId, result);
  context.log("host.preview", { status: result.status });
}

/** The runner for `preview_controls` items: the pictures of a variant card's options go to `frames`. */
export function createPreviewRunner(deps: { frames: FrameStore }): HostRunner {
  return async (item, context) => {
    try { await perform(item, context, deps.frames); }
    finally { releaseFlight(context.state, "preview_controls"); }
  };
}
