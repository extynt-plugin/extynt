// The `capture_frame` runner. After Effects saves one frame as a PNG
// (`aeCaptureFrame`); the sidecar reads it from disk, fits it, and either answers the capture request with the bounded
// PNG or, for a plan's before/after thumbnail, keeps a 240 px PNG in the frame store.
import { boolean, decode, decodeJson, fallback, type Infer, type JsonObject, literal, map, number, object, refine, string } from "@extynt/decode";
import type { CallOutcome, HostCallResult } from "@extynt/host-native";
import { jsonOf } from "@extynt/mcp-server";
import { rowDecoder } from "../verify/json-fields.js";
import { dataUrlOf, frameBackground, readFrame, readPendingFrame, removeFrame, type FrameFailure } from "./frame-pipeline.js";
import { processFrame } from "./frame-worker-client.js";
import type { FrameStore } from "./frame-store.js";
import type { HostLaneContext, HostRunner, HostWorkData } from "./lane-types.js";
import { failureOf } from "./read-ops.js";
import { releaseFlight } from "./runner-support.js";

const DEFAULT_PREVIEW = { maxWidth: 1280, maxHeight: 720 }, DEFAULT_MAX_ENCODED_BYTES = 3_000_000;
const CAPTURE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const UNREADABLE_ANSWER: FrameFailure = { code: "CAPTURE_FAILED", message: "The host returned an unreadable capture answer." };

type CaptureCommand = JsonObject & { readonly captureId: string };
type Loaded = Awaited<ReturnType<typeof readFrame>>;
type Fetched = { ok: true; bytes: Uint8Array; scriptMs: number } | { ok: false; failure: FrameFailure; scriptMs: number | null };
interface HostFrame { localPath: string; pending: string[] | null }

const isCaptureCommand = (command: JsonObject): command is CaptureCommand => command.operation === "capture_frame" && typeof command.captureId === "string" && CAPTURE_ID.test(command.captureId);
const boundOr = (otherwise: number) => fallback(map(number({ min: 16 }), Math.floor), otherwise);

const captureItem = object({
  command: refine(rowDecoder, isCaptureCommand, "a capture_frame command"),
  preview: fallback(object({ maxWidth: boundOr(DEFAULT_PREVIEW.maxWidth), maxHeight: boundOr(DEFAULT_PREVIEW.maxHeight) }), DEFAULT_PREVIEW),
  maxEncodedBytes: boundOr(DEFAULT_MAX_ENCODED_BYTES),
  background: frameBackground,
  thumb: fallback(object({ planId: string(), side: literal("before", "after") }), null),
});
type CaptureItem = Infer<typeof captureItem>;
type ThumbItem = CaptureItem & { readonly thumb: NonNullable<CaptureItem["thumb"]> };

const hostAnswer = object({
  ok: fallback(boolean(), false),
  localPath: fallback(string(), null),
  pending: fallback(boolean(), false),
  alternatePath: fallback(string(), null),
  error: fallback(object({ code: fallback(string(), null), message: fallback(string(), null) }), { code: null, message: null }),
});

function frameOf(answer: Infer<typeof hostAnswer>): HostFrame | FrameFailure {
  const { localPath, error } = answer;
  if (answer.ok && localPath !== null) return { localPath, pending: answer.pending ? [localPath, ...(answer.alternatePath === null ? [] : [answer.alternatePath])] : null };
  return { code: error.code ?? "CAPTURE_FAILED", message: error.message?.slice(0, 256) ?? "No local capture was created." };
}

function hostFrameOf(text: string): HostFrame | FrameFailure {
  const decoded = decodeJson(text, hostAnswer);
  return decoded.ok ? frameOf(decoded.value) : UNREADABLE_ANSWER;
}

async function discardFrame(context: HostLaneContext, captureId: string, path: string): Promise<void> {
  if (await removeFrame(path)) return;
  await context.client.hostCall("aeDiscardCaptureFrame", { operation: "discard_capture_frame", captureId });
}

function failureReceipt(captureId: string, failure: FrameFailure): JsonObject {
  return { captureId, ok: false, providerShared: false, error: { code: failure.code, message: failure.message } };
}

async function successReceipt(item: CaptureItem, bytes: Uint8Array): Promise<JsonObject> {
  const { captureId } = item.command, made = await processFrame({ kind: "capture", bytes, preview: item.preview, background: item.background });
  if (!made.ok) return failureReceipt(captureId, made);
  if (!("capture" in made)) return failureReceipt(captureId, { code: "CAPTURE_FAILED", message: "The frame worker answered with something other than a capture." });
  const product = made.capture, dataUrl = dataUrlOf(product.png ?? bytes);
  if (dataUrl.length > item.maxEncodedBytes) return failureReceipt(captureId, { code: "CAPTURE_TOO_LARGE", message: "The bounded derivative PNG still exceeds the response budget." });
  return { captureId, ok: true, providerShared: false, dataUrl, originalWidth: product.originalWidth, originalHeight: product.originalHeight, previewWidth: product.previewWidth, previewHeight: product.previewHeight, resized: product.resized, backgroundFlattened: product.flattened, sampledPixels: jsonOf(product.sample) };
}

function hostCallFailed(outcome: Exclude<CallOutcome<HostCallResult>, { kind: "ok" }>): Fetched {
  const failure = failureOf(outcome);
  return { ok: false, scriptMs: null, failure: { code: failure.code === "HOST_TIMEOUT" ? "CAPTURE_TIMEOUT" : "CAPTURE_FAILED", message: failure.message } };
}

async function loadHostFrame(hosted: HostFrame): Promise<{ loaded: Loaded; path: string }> {
  if (!hosted.pending) return { loaded: await readFrame(hosted.localPath), path: hosted.localPath };
  const pending = await readPendingFrame(hosted.pending);
  return { loaded: pending, path: pending.ok ? pending.path : hosted.localPath };
}

async function fetchFrame(item: CaptureItem, context: HostLaneContext): Promise<Fetched> {
  const outcome = await context.client.hostCall("aeCaptureFrame", { ...item.command });
  if (outcome.kind !== "ok") return hostCallFailed(outcome);
  const scriptMs = Math.round(outcome.result.scriptUs / 1000), hosted = hostFrameOf(outcome.result.result);
  if (!("localPath" in hosted)) return { ok: false, failure: hosted, scriptMs };
  const { loaded, path } = await loadHostFrame(hosted);
  await discardFrame(context, item.command.captureId, path);
  return loaded.ok ? { ok: true, bytes: loaded.bytes, scriptMs } : { ok: false, failure: loaded, scriptMs };
}

async function keepThumb(item: ThumbItem, got: Fetched, context: HostLaneContext, frames: FrameStore): Promise<void> {
  const made = got.ok ? await processFrame({ kind: "thumb", bytes: got.bytes, background: item.background }) : got.failure;
  if ("thumb" in made) frames.putThumb(item.thumb.planId, item.thumb.side, made.thumb);
  else context.log("host.thumb-failed", { code: "code" in made ? made.code : "CAPTURE_FAILED" });
}

async function answerCapture(item: CaptureItem, got: Fetched, context: HostLaneContext, started: number): Promise<void> {
  const outcome = await context.receivers.acceptCapture(got.ok ? await successReceipt(item, got.bytes) : failureReceipt(item.command.captureId, got.failure));
  context.log("host.capture", { ok: got.ok, accepted: outcome.outcome === "succeeded", ms: Math.round(performance.now() - started), scriptMs: got.scriptMs });
}

function isThumb(item: CaptureItem): item is ThumbItem {
  return item.thumb !== null;
}

async function perform(raw: HostWorkData, context: HostLaneContext, frames: FrameStore): Promise<void> {
  const decoded = decode(captureItem, raw);
  if (!decoded.ok) { context.log("host.capture-invalid", {}); return; }
  const item = decoded.value, started = performance.now(), got = await fetchFrame(item, context);
  if (isThumb(item)) await keepThumb(item, got, context, frames);
  else await answerCapture(item, got, context, started);
}

/** The runner for `capture_frame` items: a request's frame goes to the capture receiver, a plan's thumbnail to `frames`. */
export function createCaptureRunner(deps: { frames: FrameStore }): HostRunner {
  return async (item, context) => {
    try { await perform(item, context, deps.frames); }
    finally { releaseFlight(context.state, "capture_frame"); }
  };
}
